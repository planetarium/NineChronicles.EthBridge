import { ethers } from "ethers";
import { EthereumBurnEventMonitor } from "../../src/monitors/ethereum-burn-event-monitor";
import { NineChroniclesTransferredEventMonitor } from "../../src/monitors/nine-chronicles-transferred-event-monitor";
import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { wNCGTokenAbi } from "../../src/wrapped-ncg-token";

const contractAddress = "0x1111111111111111111111111111111111111111";
function burnLog(blockNumber: number, logIndex: number): ethers.providers.Log {
    return {
        blockNumber,
        blockHash: `block-${blockNumber}`,
        transactionHash: `tx-${blockNumber}-${logIndex}`,
        transactionIndex: logIndex,
        logIndex,
        removed: false,
        address: contractAddress,
        topics: [
            ethers.utils.id("Burn(address,bytes32,uint256)"),
            ethers.utils.hexZeroPad(contractAddress, 32),
            ethers.constants.HashZero,
        ],
        data: ethers.utils.defaultAbiCoder.encode(["uint256"], [logIndex + 1]),
    };
}

function ethereumProvider(logs: ethers.providers.Log[]) {
    return {
        _isProvider: true,
        getBlockNumber: jest.fn().mockResolvedValue(53),
        getBlock: jest.fn(async (indexOrHash: number | string) => {
            const number =
                typeof indexOrHash === "number"
                    ? indexOrHash
                    : Number(indexOrHash.replace("block-", ""));
            return { number, hash: `block-${number}` };
        }),
        getLogs: jest.fn(
            async ({
                fromBlock,
                toBlock,
            }: {
                fromBlock: number;
                toBlock: number;
            }) =>
                logs.filter(
                    (log) =>
                        log.blockNumber >= fromBlock &&
                        log.blockNumber <= toBlock
                )
        ),
    };
}

describe("monitor restart checkpoints", () => {
    it.each([0, 1, 2])(
        "resumes after saved Ethereum transaction %s, then advances with the confirmation offset",
        async (savedLogIndex) => {
            const provider = ethereumProvider([
                burnLog(42, 0),
                burnLog(42, 1),
                burnLog(42, 2),
                burnLog(43, 0),
            ]);
            const loop = new EthereumBurnEventMonitor(
                provider as unknown as ethers.providers.BaseProvider,
                { address: contractAddress, abi: wNCGTokenAbi },
                { blockHash: "block-42", txId: `tx-42-${savedLogIndex}` },
                10
            ).loop();
            try {
                const resumed = await loop.next();
                if (resumed.done) throw new Error("monitor ended unexpectedly");
                expect(resumed.value.blockHash).toBe("block-42");
                expect(resumed.value.events.map((event) => event.txId)).toEqual(
                    [0, 1, 2]
                        .filter((index) => index > savedLogIndex)
                        .map((index) => `tx-42-${index}`)
                );
                const next = await loop.next();
                if (next.done) throw new Error("monitor ended unexpectedly");
                expect(next.value.blockHash).toBe("block-43");
                expect(next.value.events.map((event) => event.txId)).toEqual([
                    "tx-43-0",
                ]);
                expect(provider.getBlock).toHaveBeenCalledWith("block-42");
                expect(
                    provider.getLogs.mock.calls.map(([filter]) => [
                        filter.fromBlock,
                        filter.toBlock,
                    ])
                ).toEqual([
                    [42, 42],
                    [43, 43],
                ]);
            } finally {
                await loop.return?.(undefined as never);
            }
        }
    );

    it("skips negative confirmed indexes and first yields genesis at the confirmation boundary", async () => {
        const provider = ethereumProvider([burnLog(0, 0), burnLog(1, 0)]);
        provider.getBlockNumber
            .mockReset()
            .mockResolvedValueOnce(0)
            .mockResolvedValue(10);
        const loop = new EthereumBurnEventMonitor(
            provider as unknown as ethers.providers.BaseProvider,
            { address: contractAddress, abi: wNCGTokenAbi },
            null,
            10
        ).loop();
        try {
            const first = await loop.next();
            if (first.done) throw new Error("monitor ended unexpectedly");
            expect(first.value.blockHash).toBe("block-0");
            expect(first.value.events.map((event) => event.txId)).toEqual([
                "tx-0-0",
            ]);
            expect(provider.getLogs).toHaveBeenCalledTimes(1);
            expect(provider.getLogs).toHaveBeenCalledWith(
                expect.objectContaining({ fromBlock: 0, toBlock: 0 })
            );
            expect(
                provider.getBlock.mock.calls.every(([index]) => index === 0)
            ).toBe(true);
        } finally {
            await loop.return?.(undefined as never);
        }
    });

    it("resumes the rest of an authorized NCG batch before entering the next batch", async () => {
        const event = (blockHash: string, suffix: string) => ({
            blockHash,
            txId: `tx-${blockHash}-${suffix}`,
            amount: "1",
            memo: "recipient",
            sender: "sender",
            recipient: "bridge",
        });
        const client: jest.Mocked<IHeadlessGraphQLClient> = {
            endpoint: "http://headless.invalid/graphql",
            getBlockIndex: jest.fn(async (hash: string) => Number(hash)),
            getTipIndex: jest.fn().mockResolvedValue(101),
            getBlockHash: jest.fn(async (index: number) => String(index)),
            getNCGTransferredEvents: jest.fn(
                async (hash: string, _recipient: string) =>
                    hash === "37"
                        ? [event(hash, "a"), event(hash, "b"), event(hash, "c")]
                        : [event(hash, "a")]
            ),
            getNextTxNonce: jest.fn(),
            getGenesisHash: jest.fn(),
            transfer: jest.fn(),
            attachSignature: jest.fn(),
            createUnsignedTx: jest.fn(),
            stageTx: jest.fn(),
        };
        const loop = new NineChroniclesTransferredEventMonitor(
            { blockHash: "37", txId: "tx-37-b" },
            client,
            "bridge"
        ).loop();
        const hashes: string[] = [];
        const transactionIds: (string | null)[] = [];
        try {
            for (let index = 37; index <= 51; index++) {
                const item = await loop.next();
                if (item.done) throw new Error("monitor ended unexpectedly");
                hashes.push(item.value.blockHash);
                transactionIds.push(
                    ...item.value.events.map((value) => value.txId)
                );
            }
            expect(hashes).toEqual(
                Array.from({ length: 15 }, (_, index) => String(index + 37))
            );
            expect(transactionIds).toEqual([
                "tx-37-c",
                ...Array.from(
                    { length: 14 },
                    (_, index) => `tx-${index + 38}-a`
                ),
            ]);
            expect(
                client.getNCGTransferredEvents.mock.calls.map(([hash]) => hash)
            ).toEqual(hashes);
            expect(client.getBlockIndex).toHaveBeenCalledWith("37");
        } finally {
            await loop.return?.(undefined as never);
        }
    });
});
