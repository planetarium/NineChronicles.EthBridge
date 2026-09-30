import { ethers } from "ethers";
import { EthereumBurnEventMonitor } from "../../src/monitors/ethereum-burn-event-monitor";
import { wNCGTokenAbi } from "../../src/wrapped-ncg-token";
import { ContractDescription } from "../../src/types/contract-description";

const CONTRACT_ADDRESS = "0x9093dd96c4bb6b44A9E0A522e2DE49641F146223";
const SENDER_ADDRESS = "0x47D082a115c63E7b58B1532d20E631538eaFADde";
const RECIPIENT_ADDRESS =
    "0x0000000000000000000000000000000000000000000000000000000000000001";

const contractDescription: ContractDescription = {
    abi: wNCGTokenAbi,
    address: CONTRACT_ADDRESS,
};

const BURN_EVENT_TOPIC = ethers.utils.id("Burn(address,bytes32,uint256)");

function makeBurnLog(
    blockNumber: number,
    amount: number
): ethers.providers.Log {
    return {
        blockNumber,
        blockHash: `0xblock${blockNumber}`,
        transactionIndex: 0,
        removed: false,
        address: CONTRACT_ADDRESS,
        data: ethers.utils.defaultAbiCoder.encode(["uint256"], [amount]),
        topics: [
            BURN_EVENT_TOPIC,
            ethers.utils.hexZeroPad(SENDER_ADDRESS, 32),
            RECIPIENT_ADDRESS,
        ],
        transactionHash: `0xtx${blockNumber}`,
        logIndex: 0,
    };
}

describe(EthereumBurnEventMonitor.name, () => {
    function makeMockProvider(
        tipIndex: number,
        logsByRange: ethers.providers.Log[]
    ) {
        const getLogs = jest.fn(
            async (filter: { fromBlock: number; toBlock: number }) =>
                logsByRange.filter(
                    (log) =>
                        log.blockNumber >= filter.fromBlock &&
                        log.blockNumber <= filter.toBlock
                )
        );
        const getBlockNumber = jest.fn(async () => tipIndex);
        const getBlock = jest.fn(async (blockHashOrIndex: number | string) => {
            if (typeof blockHashOrIndex === "number") {
                return {
                    number: blockHashOrIndex,
                    hash: `0xblock${blockHashOrIndex}`,
                };
            }
            const number = parseInt(
                blockHashOrIndex.replace("0xblock", ""),
                10
            );
            return { number, hash: blockHashOrIndex };
        });

        return {
            _isProvider: true,
            getLogs,
            getBlockNumber,
            getBlock,
        } as unknown as ethers.providers.BaseProvider;
    }

    describe("getEvents", () => {
        it("fetches one block at a time when caught up (small gap to tip)", async () => {
            const CONFIRMATIONS = 10;
            const tipIndex = 100;
            const logs = [makeBurnLog(89, 1), makeBurnLog(90, 2)];
            const provider = makeMockProvider(tipIndex, logs);

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS
            );

            // Simulate the base loop: it calls getTipIndex() once per
            // iteration before getEvents().
            await (monitor as any).getTipIndex();

            const eventsAt90 = await (monitor as any).getEvents(90);
            expect(eventsAt90).toHaveLength(1);
            expect(eventsAt90[0].returnValues.amount).toEqual("2");

            // Confirmed tip is 100 - 10 = 90, i.e. exactly this block, so
            // there's nothing ahead to batch: only one getLogs() call, for
            // exactly this one block.
            expect((provider.getLogs as jest.Mock).mock.calls).toHaveLength(1);
            expect((provider.getLogs as jest.Mock).mock.calls[0][0]).toEqual(
                expect.objectContaining({ fromBlock: 90, toBlock: 90 })
            );
        });

        it("batches many blocks into one getLogs() call when far behind tip, then serves the rest from cache", async () => {
            const CONFIRMATIONS = 10;
            const tipIndex = 5000; // confirmed tip = 4990, far ahead of block 10
            const logs = [
                makeBurnLog(10, 1),
                makeBurnLog(15, 2),
                makeBurnLog(2000, 3),
            ];
            const provider = makeMockProvider(tipIndex, logs);

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000 // catchUpChunkSize
            );

            await (monitor as any).getTipIndex();

            const eventsAt10 = await (monitor as any).getEvents(10);
            expect(eventsAt10.map((e: any) => e.returnValues.amount)).toEqual([
                "1",
            ]);

            // A single wide-range call should have covered [10, 2009].
            expect((provider.getLogs as jest.Mock).mock.calls).toHaveLength(1);
            expect((provider.getLogs as jest.Mock).mock.calls[0][0]).toEqual(
                expect.objectContaining({ fromBlock: 10, toBlock: 2009 })
            );

            // Subsequent, sequential single-block requests within that
            // range are served from cache with no further getLogs() calls.
            const eventsAt11 = await (monitor as any).getEvents(11);
            expect(eventsAt11).toEqual([]);

            const eventsAt15 = await (monitor as any).getEvents(15);
            expect(eventsAt15.map((e: any) => e.returnValues.amount)).toEqual([
                "2",
            ]);

            expect((provider.getLogs as jest.Mock).mock.calls).toHaveLength(1);
        });

        it("never batches beyond the confirmed tip, so it can't serve stale near-head data across a reorg window", async () => {
            const CONFIRMATIONS = 10;
            const tipIndex = 1000; // confirmed tip = 990
            const provider = makeMockProvider(tipIndex, []);

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000 // catchUpChunkSize, much wider than the confirmed gap
            );

            await (monitor as any).getTipIndex();
            await (monitor as any).getEvents(500);

            // Even though catchUpChunkSize would allow up to block 2499, the
            // call must be capped at confirmed tip (990), never reaching
            // into the unconfirmed head (991-1000).
            expect((provider.getLogs as jest.Mock).mock.calls[0][0]).toEqual(
                expect.objectContaining({ fromBlock: 500, toBlock: 990 })
            );
        });

        it("falls back to a single-block fetch when the tip isn't known yet (e.g. processRemains)", async () => {
            const CONFIRMATIONS = 10;
            const provider = makeMockProvider(1000, [makeBurnLog(42, 7)]);

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS
            );

            // No getTipIndex() call yet, so _lastKnownTipIndex is undefined.
            const events = await (monitor as any).getEvents(42);
            expect(events.map((e: any) => e.returnValues.amount)).toEqual([
                "7",
            ]);
            expect((provider.getLogs as jest.Mock).mock.calls[0][0]).toEqual(
                expect.objectContaining({ fromBlock: 42, toBlock: 42 })
            );
        });
    });
});
