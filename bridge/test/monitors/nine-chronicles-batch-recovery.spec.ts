import { ethers } from "ethers";
import { EthereumBurnEventMonitor } from "../../src/monitors/ethereum-burn-event-monitor";
import { wNCGTokenAbi } from "../../src/wrapped-ncg-token";
import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { NineChroniclesTransferredEventMonitor } from "../../src/monitors/nine-chronicles-transferred-event-monitor";

async function nextWithTimers<T>(iterator: AsyncIterator<T>): Promise<T> {
    const promise = iterator.next();
    let settled = false;
    promise.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        }
    );
    for (let turn = 0; !settled && turn < 2000; turn++) {
        jest.runOnlyPendingTimers();
        await Promise.resolve();
    }
    expect(settled).toBe(true);
    const result = await promise;
    if (result.done) throw new Error("monitor ended unexpectedly");
    return result.value;
}

function makeClient(): jest.Mocked<IHeadlessGraphQLClient> {
    return {
        endpoint: "http://headless.invalid/graphql",
        getBlockIndex: jest.fn(async (hash: string) => Number(hash)),
        getTipIndex: jest.fn().mockResolvedValueOnce(0).mockResolvedValue(101),
        getBlockHash: jest.fn(async (index: number) => String(index)),
        getNCGTransferredEvents: jest.fn(
            async (hash: string, _recipient: string) => [
                {
                    blockHash: hash,
                    txId: `tx-${hash}`,
                    sender: "sender",
                    recipient: "bridge",
                    amount: "1",
                    memo: "recipient",
                },
            ]
        ),
        getNextTxNonce: jest.fn(),
        getGenesisHash: jest.fn(),
        transfer: jest.fn(),
        attachSignature: jest.fn(),
        createUnsignedTx: jest.fn(),
        stageTx: jest.fn(),
    };
}

describe("Nine Chronicles authorized batch recovery", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it.each(["hash", "events", "events-then-tip"] as const)(
        "does not replay the consumed prefix after block 37 %s fails",
        async (failureAt) => {
            const client = makeClient();
            let failed = false;
            if (failureAt === "hash") {
                client.getBlockHash.mockImplementation(async (index) => {
                    if (index === 37 && !failed) {
                        failed = true;
                        throw new Error("transient block hash failure");
                    }
                    return String(index);
                });
            } else {
                const readEvents =
                    client.getNCGTransferredEvents.getMockImplementation()!;
                client.getNCGTransferredEvents.mockImplementation(
                    async (hash) => {
                        if (hash === "37" && !failed) {
                            failed = true;
                            if (failureAt === "events-then-tip") {
                                client.getTipIndex.mockRejectedValueOnce(
                                    new Error(
                                        "tip unavailable during batch retry"
                                    )
                                );
                            }
                            throw new Error("transient GraphQL events failure");
                        }
                        return readEvents(hash, "bridge");
                    }
                );
            }
            const monitor = new NineChroniclesTransferredEventMonitor(
                null,
                client,
                "bridge"
            );
            const iterator = monitor.loop();
            const yielded = [];
            for (let index = 0; index < 100; index++) {
                yielded.push(await nextWithTimers(iterator));
            }
            await iterator.return?.(undefined as never);
            expect(failed).toBe(true);
            expect(yielded.map((block) => Number(block.blockHash))).toEqual(
                Array.from({ length: 100 }, (_, index) => index + 1)
            );
            expect(yielded.map((block) => block.events[0].txId)).toEqual(
                Array.from({ length: 100 }, (_, index) => `tx-${index + 1}`)
            );
            expect(
                client.getNCGTransferredEvents.mock.calls.filter(
                    ([hash]) => hash === "1"
                )
            ).toHaveLength(1);
            expect(
                client.getNCGTransferredEvents.mock.calls.filter(
                    ([hash]) => hash === "37"
                )
            ).toHaveLength(failureAt === "hash" ? 1 : 2);
        }
    );

    it("still waits for the authorized boundary plus the tip interval after recovering a batch", async () => {
        const client = makeClient();
        client.getTipIndex
            .mockReset()
            .mockResolvedValueOnce(0)
            .mockResolvedValue(100);
        const readEvents =
            client.getNCGTransferredEvents.getMockImplementation()!;
        let failures = 2;
        client.getNCGTransferredEvents.mockImplementation(async (hash) => {
            if (hash === "37" && failures-- > 0)
                throw new Error("temporary outage");
            return readEvents(hash, "bridge");
        });
        const iterator = new NineChroniclesTransferredEventMonitor(
            null,
            client,
            "bridge"
        ).loop();
        const hashes = [];
        for (let index = 0; index < 50; index++)
            hashes.push((await nextWithTimers(iterator)).blockHash);
        expect(hashes).toEqual(
            Array.from({ length: 50 }, (_, index) => String(index + 1))
        );
        const next = iterator.next();
        let nextSettled = false;
        next.then(() => {
            nextSettled = true;
        });
        for (let turn = 0; turn < 500; turn++) {
            jest.runOnlyPendingTimers();
            await Promise.resolve();
        }
        expect(nextSettled).toBe(false);
        expect(
            client.getNCGTransferredEvents.mock.calls.some(
                ([hash]) => hash === "51"
            )
        ).toBe(false);
        client.getTipIndex.mockResolvedValue(101);
        for (let turn = 0; !nextSettled && turn < 2000; turn++) {
            jest.runOnlyPendingTimers();
            await Promise.resolve();
        }
        expect(nextSettled).toBe(true);
        expect((await next).value.blockHash).toBe("51");
        await iterator.return?.(undefined as never);
    });
    it("preserves Ethereum confirmation-offset scan positions after a read failure", async () => {
        let failed = false;
        const provider = {
            _isProvider: true,
            getBlockNumber: jest
                .fn()
                .mockResolvedValueOnce(10)
                .mockResolvedValue(15),
            getBlock: jest.fn(async (index: number) => {
                if (index === 2 && !failed) {
                    failed = true;
                    throw new Error("temporary Ethereum RPC outage");
                }
                return { number: index, hash: `hash-${index}` };
            }),
            getLogs: jest.fn().mockResolvedValue([]),
        };
        const monitor = new EthereumBurnEventMonitor(
            provider as unknown as ethers.providers.BaseProvider,
            {
                address: "0x1111111111111111111111111111111111111111",
                abi: wNCGTokenAbi,
            },
            null,
            10
        );
        const iterator = monitor.loop();
        const hashes = [];
        for (let index = 0; index < 5; index++)
            hashes.push((await nextWithTimers(iterator)).blockHash);
        await iterator.return?.(undefined as never);
        expect(failed).toBe(true);
        expect(hashes).toEqual([
            "hash-1",
            "hash-2",
            "hash-3",
            "hash-4",
            "hash-5",
        ]);
    });
});
