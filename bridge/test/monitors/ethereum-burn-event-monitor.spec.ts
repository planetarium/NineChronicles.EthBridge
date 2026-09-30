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

    describe("getEvents - range-too-large adaptation", () => {
        // A provider that rejects any getLogs() call spanning more than
        // `maxRangeSize` blocks with a real-world "range too large" style
        // error, and otherwise resolves normally.
        function makeRangeLimitedMockProvider(
            tipIndex: number,
            maxRangeSize: number,
            logsByRange: ethers.providers.Log[]
        ) {
            const getLogs = jest.fn(
                async (filter: { fromBlock: number; toBlock: number }) => {
                    const rangeSize = filter.toBlock - filter.fromBlock + 1;
                    if (rangeSize > maxRangeSize) {
                        throw {
                            code: -32005,
                            message:
                                "query returned more than 10000 results. " +
                                "Try with this block range: " +
                                `[${filter.fromBlock}, ${
                                    filter.fromBlock + maxRangeSize - 1
                                }].`,
                        };
                    }

                    return logsByRange.filter(
                        (log) =>
                            log.blockNumber >= filter.fromBlock &&
                            log.blockNumber <= filter.toBlock
                    );
                }
            );
            const getBlockNumber = jest.fn(async () => tipIndex);
            const getBlock = jest.fn(async () => {
                throw new Error("not used in this test");
            });

            return {
                _isProvider: true,
                getLogs,
                getBlockNumber,
                getBlock,
            } as unknown as ethers.providers.BaseProvider;
        }

        it("shrinks the chunk size and retries when getLogs rejects the range as too large, instead of repeating the same request forever", async () => {
            const CONFIRMATIONS = 10;
            const MAX_RANGE_SIZE = 500;
            const tipIndex = 1_000_000;
            const provider = makeRangeLimitedMockProvider(
                tipIndex,
                MAX_RANGE_SIZE,
                [makeBurnLog(150, 42)]
            );

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000 // catchUpChunkSize - larger than MAX_RANGE_SIZE on purpose
            );

            await (monitor as any).getTipIndex();

            const events = await (monitor as any).getEvents(100);

            // It found the log at block 150 despite starting with an
            // oversized chunk request, by shrinking and retrying.
            expect(events).toEqual([]); // nothing at block 100 itself
            const eventsAt150 = await (monitor as any).getEvents(150);
            expect(eventsAt150.map((e: any) => e.returnValues.amount)).toEqual([
                "42",
            ]);

            const getLogsMock = provider.getLogs as jest.Mock;
            // 2000 (rejected) -> 1000 (rejected) -> 500 (accepted): 3 calls
            // for the first getEvents(100), then 0 more for getEvents(150)
            // since it was served from the now-cached 500-block chunk.
            expect(getLogsMock.mock.calls.length).toEqual(3);
            expect(
                getLogsMock.mock.calls.map(
                    ([filter]: [{ fromBlock: number; toBlock: number }]) =>
                        filter.toBlock - filter.fromBlock + 1
                )
            ).toEqual([2000, 1000, 500]);
        });

        it("remembers the shrunk chunk size for later calls, instead of re-discovering the same limit every time", async () => {
            const CONFIRMATIONS = 10;
            const MAX_RANGE_SIZE = 500;
            const tipIndex = 1_000_000;
            const provider = makeRangeLimitedMockProvider(
                tipIndex,
                MAX_RANGE_SIZE,
                []
            );

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000
            );

            await (monitor as any).getTipIndex();

            await (monitor as any).getEvents(100); // discovers the limit: 2000 -> 1000 -> 500
            const getLogsMock = provider.getLogs as jest.Mock;
            expect(getLogsMock.mock.calls.length).toEqual(3);

            await (monitor as any).getEvents(600); // next chunk, right after the previous one
            // Only one more call, straight at the already-learned 500-block
            // size - no repeated 2000/1000 attempts.
            expect(getLogsMock.mock.calls.length).toEqual(4);
            const lastRange = getLogsMock.mock.calls[3][0];
            expect(lastRange.toBlock - lastRange.fromBlock + 1).toEqual(500);
        });

        it("does not shrink the chunk size, and rethrows immediately, for an unrelated error", async () => {
            const CONFIRMATIONS = 10;
            const tipIndex = 1_000_000;
            const provider = makeRangeLimitedMockProvider(tipIndex, 500, []);
            (provider.getLogs as jest.Mock).mockReset();
            (provider.getLogs as jest.Mock).mockRejectedValue(
                new Error("connect ECONNREFUSED")
            );

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000
            );

            await (monitor as any).getTipIndex();

            await expect((monitor as any).getEvents(100)).rejects.toThrow(
                "connect ECONNREFUSED"
            );
            // A single attempt - no shrink-and-retry for an unrelated error.
            expect((provider.getLogs as jest.Mock).mock.calls.length).toEqual(
                1
            );
        });
    });

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

    describe("loop - per-position progress commit across a mid-batch failure", () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        // Mirrors the equivalent regression test in the BSC bridge fork: a
        // block-range batch is being caught up on (here, via the internal
        // getLogs() chunk cache added in this PR), and one block partway
        // through the batch fails once (a transient error) before
        // succeeding on retry. The resulting sequence of blocks actually
        // yielded to the observer, across that failure/retry boundary, must
        // be exactly contiguous - no block already yielded (and so already
        // handed to the observer for processing) is ever yielded again, and
        // none is skipped.
        it("never re-yields an already-yielded block, and never skips one, when a block fails partway through catching up", async () => {
            const CONFIRMATIONS = 0;
            const TIP = 8;

            let blockNumberCallCount = 0;
            const getBlockNumber = jest.fn(async () => {
                blockNumberCallCount += 1;
                // Starts already at block 3 (so the very first triggered
                // block is 4), then the tip is 8 for the rest of the run.
                return blockNumberCallCount === 1 ? 3 : TIP;
            });

            let block6Attempts = 0;
            const getBlock = jest.fn(async (blockIndex: number) => {
                if (blockIndex === 6) {
                    block6Attempts += 1;
                    if (block6Attempts === 1) {
                        // A transient failure partway through the batch
                        // (blocks 4-8), after 4 and 5 have already been
                        // yielded and (in the real bridge) processed/minted.
                        throw { code: "SERVER_ERROR", reason: "boom" };
                    }
                }
                return { number: blockIndex, hash: `0xblock${blockIndex}` };
            });

            const logs = [4, 5, 6, 7, 8].map((n) => makeBurnLog(n, n));
            const getLogs = jest.fn(
                async (filter: { fromBlock: number; toBlock: number }) =>
                    logs.filter(
                        (log) =>
                            log.blockNumber >= filter.fromBlock &&
                            log.blockNumber <= filter.toBlock
                    )
            );

            const provider = {
                _isProvider: true,
                getBlockNumber,
                getBlock,
                getLogs,
            } as unknown as ethers.providers.BaseProvider;

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS
            );

            const iterator = monitor.loop();

            async function nextYieldedBlockNumber(): Promise<number> {
                const promise = iterator.next();
                let settled = false;
                promise.then(() => {
                    settled = true;
                });
                while (!settled) {
                    jest.runAllTimers();
                    await Promise.resolve();
                }
                const result = await promise;
                if (result.done) {
                    throw new Error("loop() ended unexpectedly");
                }
                return parseInt(
                    result.value.blockHash.replace("0xblock", ""),
                    10
                );
            }

            const yieldedBlockNumbers: number[] = [];
            for (let i = 0; i < 5; ++i) {
                yieldedBlockNumbers.push(await nextYieldedBlockNumber());
            }

            // Exactly contiguous, in order, no repeats and no gaps - even
            // though block 6 failed once along the way.
            expect(yieldedBlockNumbers).toEqual([4, 5, 6, 7, 8]);
            expect(new Set(yieldedBlockNumbers).size).toEqual(
                yieldedBlockNumbers.length
            );
            expect(block6Attempts).toEqual(2);
        });
    });
});
