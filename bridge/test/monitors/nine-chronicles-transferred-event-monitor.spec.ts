import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { NineChroniclesTransferredEventMonitor } from "../../src/monitors/nine-chronicles-transferred-event-monitor";
import { IObserver } from "../../src/observers";
import { BlockHash } from "../../src/types/block-hash";
import { NCGTransferredEvent } from "../../src/types/ncg-transferred-event";
import { TransactionLocation } from "../../src/types/transaction-location";

jest.useFakeTimers();

async function existsAsync<T>(
    array: Array<T>,
    predicate: (value: T) => Promise<boolean>
): Promise<boolean> {
    for (const element of array) {
        if (await predicate(element)) {
            return true;
        }
    }

    return false;
}

describe("NineChroniclesTransferredEventMonitor", () => {
    const mockHeadlessGraphQLClient: jest.Mocked<IHeadlessGraphQLClient> = {
        endpoint: "http://localhost:23061/graphql",
        getBlockIndex: jest.fn((h) => Promise.resolve(parseInt(h))),
        getTipIndex: jest.fn(),
        getBlockHash: jest.fn((n) => Promise.resolve(n.toString())),
        getNCGTransferredEvents: jest
            .fn()
            .mockResolvedValue(Promise.resolve([])),
        getNextTxNonce: jest.fn(),
        getGenesisHash: jest.fn(),
        transfer: jest.fn(),
        attachSignature: jest.fn(),
        createUnsignedTx: jest.fn(),
        stageTx: jest.fn(),
    };

    const mockObserver: jest.Mocked<
        IObserver<{
            blockHash: BlockHash;
            events: (NCGTransferredEvent & TransactionLocation)[];
        }>
    > = {
        notify: jest.fn(),
    };

    describe("loop", () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });

        for (const yieldCase of [51, 101, 151]) {
            it(`should yield ${yieldCase} events`, async () => {
                const monitor = new NineChroniclesTransferredEventMonitor(
                    null,
                    mockHeadlessGraphQLClient,
                    ""
                );

                mockHeadlessGraphQLClient.getTipIndex.mockResolvedValueOnce(0);
                console.log(mockHeadlessGraphQLClient.getBlockHash(0));

                monitor.attach(mockObserver);
                monitor.run();

                for (let i = 1; i <= yieldCase; ++i) {
                    mockHeadlessGraphQLClient.getTipIndex.mockResolvedValueOnce(
                        i
                    );
                }

                while (
                    mockObserver.notify.mock.calls.length <
                    yieldCase - 1
                ) {
                    jest.runAllTimers();
                    await Promise.resolve();
                }

                expect(mockObserver.notify).toHaveBeenCalled();
                expect(mockObserver.notify.mock.calls.length).toEqual(
                    yieldCase - 1
                );
                expect(mockObserver.notify.mock.calls[0][0]).toEqual({
                    blockHash: expect.any(String),
                    events: expect.any(Array),
                });

                monitor.stop();
            });
        }

        for (const indexUnder50 of [1, 49, 32]) {
            if (indexUnder50 >= 50) {
                throw Error("Invalid testcase.");
            }

            it(`should not yield any events until ${indexUnder50}`, async () => {
                const monitor = new NineChroniclesTransferredEventMonitor(
                    null,
                    mockHeadlessGraphQLClient,
                    ""
                );

                mockHeadlessGraphQLClient.getTipIndex.mockResolvedValueOnce(0);
                console.log(mockHeadlessGraphQLClient.getBlockHash(0));

                monitor.attach(mockObserver);
                monitor.run();

                for (let i = 1; i <= indexUnder50; ++i) {
                    mockHeadlessGraphQLClient.getTipIndex.mockResolvedValueOnce(
                        i
                    );
                }

                while (
                    !(await existsAsync(
                        mockHeadlessGraphQLClient.getTipIndex.mock.results,
                        async (value) => (await value.value) === indexUnder50
                    ))
                ) {
                    jest.runAllTimers();
                    await Promise.resolve();
                }

                expect(
                    mockHeadlessGraphQLClient.getTipIndex
                ).toHaveReturnedWith(Promise.resolve(indexUnder50));
                expect(mockObserver.notify).not.toHaveBeenCalled();
                expect(mockObserver.notify.mock.calls.length).toEqual(0);

                monitor.stop();
            });
        }

        for (const { latestTxId, txIds, expectedTxIds } of [
            {
                latestTxId: "TX-A",
                txIds: ["TX-A", "TX-B", "TX-C"],
                expectedTxIds: ["TX-B", "TX-C"],
            },
            {
                latestTxId: "TX-B",
                txIds: ["TX-A", "TX-B", "TX-C"],
                expectedTxIds: ["TX-C"],
            },
            {
                latestTxId: "TX-C",
                txIds: ["TX-A", "TX-B", "TX-C"],
                expectedTxIds: [],
            },
        ]) {
            it(`should skip until ${latestTxId} transaction in ${txIds}`, async () => {
                function makeNcgTransferredEvent(txId: string) {
                    return {
                        txId,
                        blockHash: "",
                        amount: "",
                        memo: "",
                        recipient: "",
                        sender: "",
                    };
                }

                mockHeadlessGraphQLClient.getNCGTransferredEvents.mockResolvedValueOnce(
                    Promise.resolve(txIds.map(makeNcgTransferredEvent))
                );
                mockHeadlessGraphQLClient.getTipIndex
                    .mockResolvedValueOnce(0)
                    .mockResolvedValueOnce(1)
                    .mockResolvedValueOnce(2);

                const monitor = new NineChroniclesTransferredEventMonitor(
                    { blockHash: "0", txId: latestTxId },
                    mockHeadlessGraphQLClient,
                    ""
                );
                monitor.attach(mockObserver);
                monitor.run();

                while (mockObserver.notify.mock.calls.length < 1) {
                    jest.runAllTimers();
                    await Promise.resolve();
                }

                expect(mockObserver.notify).toHaveBeenCalled();
                expect(mockObserver.notify.mock.calls.length).toEqual(1);
                expect(mockObserver.notify.mock.calls[0][0]).toEqual({
                    blockHash: expect.any(String),
                    events: expectedTxIds.map((x) => {
                        return {
                            txId: x,
                            blockHash: expect.any(String),
                            memo: expect.any(String),
                            recipient: expect.any(String),
                            sender: expect.any(String),
                            amount: expect.any(String),
                        };
                    }),
                });

                monitor.stop();
            });
        }
    });
});
