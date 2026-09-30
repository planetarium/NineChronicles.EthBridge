import { ethers } from "ethers";
import {
    EthereumBurnEventMonitor,
    isBlockRangeTooLargeError,
} from "../../src/monitors/ethereum-burn-event-monitor";
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

    describe("cached range consistency", () => {
        it("reuses the loop's block hash as the single-block range anchor", async () => {
            const provider = makeMockProvider(12, [makeBurnLog(2, 9)]);
            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                10
            );
            await (monitor as any).getTipIndex();
            await (monitor as any).getBlockHash(2);
            const events = await (monitor as any).getEvents(2);
            expect(events).toHaveLength(1);
            // One read by the loop, one post-getLogs consistency check.
            expect(provider.getBlock).toHaveBeenCalledTimes(2);
            expect(provider.getLogs).toHaveBeenCalledTimes(1);
        });

        it.each([false, true])(
            "rejects a single-block branch change during getLogs (empty: %s)",
            async (empty) => {
                const provider = makeMockProvider(12, []);
                const monitor = new EthereumBurnEventMonitor(
                    provider,
                    contractDescription,
                    null,
                    10
                );
                await (monitor as any).getTipIndex();
                await (monitor as any).getBlockHash(2);
                (provider.getLogs as jest.Mock).mockImplementationOnce(
                    async () => {
                        (provider.getBlock as jest.Mock).mockResolvedValue({
                            number: 2,
                            hash: "0xnew2",
                        });
                        return empty
                            ? []
                            : [{ ...makeBurnLog(2, 9), blockHash: "0xnew2" }];
                    }
                );
                await expect((monitor as any).getEvents(2)).rejects.toThrow(
                    "Chain changed"
                );
                expect(provider.getBlock).toHaveBeenCalledTimes(2);
            }
        );

        it.each([false, true])(
            "invalidates changed ranges before consuming cached logs (initially empty: %s)",
            async (initiallyEmpty) => {
                const original = makeBurnLog(2, 1);
                const replacement = {
                    ...makeBurnLog(2, 9),
                    blockHash: "0xnew2",
                };
                const provider = makeMockProvider(
                    15,
                    initiallyEmpty ? [] : [original]
                );
                const monitor = new EthereumBurnEventMonitor(
                    provider,
                    contractDescription,
                    null,
                    10,
                    5
                );
                await (monitor as any).getTipIndex();
                await (monitor as any).getEvents(1);

                (provider.getBlock as jest.Mock).mockImplementation(
                    async (index: number) => ({
                        number: index,
                        hash: `0xnew${index}`,
                    })
                );
                (provider.getLogs as jest.Mock).mockResolvedValue([
                    replacement,
                ]);
                await (monitor as any).getBlockHash(2);
                await expect((monitor as any).getEvents(2)).rejects.toThrow(
                    initiallyEmpty ? "Chain changed" : "Burn logs disagree"
                );
                const events = await (monitor as any).getEvents(2);
                expect(
                    events.map((event: any) => event.returnValues.amount)
                ).toEqual(["9"]);
                expect(events[0].blockHash).toEqual("0xnew2");
                expect(provider.getLogs).toHaveBeenCalledTimes(2);
            }
        );

        it("discards empty results if the range changes during getLogs", async () => {
            const provider = makeMockProvider(15, []);
            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                10,
                5
            );
            await (monitor as any).getTipIndex();
            (provider.getLogs as jest.Mock).mockImplementationOnce(async () => {
                (provider.getBlock as jest.Mock).mockImplementation(
                    async (index: number) => ({
                        number: index,
                        hash: `0xnew${index}`,
                    })
                );
                return [];
            });
            await expect((monitor as any).getEvents(1)).rejects.toThrow(
                "Chain changed"
            );
            const replacement = { ...makeBurnLog(2, 9), blockHash: "0xnew2" };
            (provider.getLogs as jest.Mock).mockResolvedValue([replacement]);
            await (monitor as any).getEvents(1);
            expect(await (monitor as any).getEvents(2)).toHaveLength(1);
            expect(provider.getLogs).toHaveBeenCalledTimes(2);
        });

        it("rejects mismatched logs even when a different RPC reports a stable range anchor", async () => {
            const provider = makeMockProvider(15, [makeBurnLog(2, 1)]);
            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                10,
                5
            );
            await (monitor as any).getTipIndex();
            await (monitor as any).getEvents(1);
            (provider.getBlock as jest.Mock).mockImplementation(
                async (index: number) => ({
                    number: index,
                    hash: index === 2 ? "0xnew2" : `0xblock${index}`,
                })
            );
            await (monitor as any).getBlockHash(2);
            await expect((monitor as any).getEvents(2)).rejects.toThrow(
                "Burn logs disagree"
            );
        });

        it("rejects a block change after the loop read its block hash", async () => {
            const provider = makeMockProvider(15, []);
            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                10,
                5
            );
            await (monitor as any).getTipIndex();
            await (monitor as any).getBlockHash(1);
            (provider.getBlock as jest.Mock).mockImplementation(
                async (index: number) => ({
                    number: index,
                    hash: `0xnew${index}`,
                })
            );
            await expect((monitor as any).getEvents(1)).rejects.toThrow(
                "Chain changed"
            );
        });
    });

    describe("range error classification", () => {
        const rangeError = { code: -32005, message: "block range is too wide" };
        it("recognizes structured FallbackProvider quorum errors", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    message: "failed to meet quorum",
                    results: [
                        { error: rangeError },
                        { error: { error: rangeError } },
                    ],
                })
            ).toBe(true);
        });
        it("can shrink the healthy provider's range while another provider is offline", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    message: "failed to meet quorum",
                    results: [
                        { error: rangeError },
                        {
                            error: {
                                code: "SERVER_ERROR",
                                message: "missing response",
                            },
                        },
                    ],
                })
            ).toBe(true);
        });
        it("does not split when every provider only timed out", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    message: "failed to meet quorum",
                    results: [
                        { error: { code: "TIMEOUT", message: "timeout" } },
                    ],
                })
            ).toBe(false);
        });
        it("does not split on a quorum error containing an unrelated failure", () => {
            expect(
                isBlockRangeTooLargeError({
                    message: "failed to meet quorum: block range is too wide",
                    results: [
                        { error: rangeError },
                        { error: new Error("invalid API key") },
                    ],
                })
            ).toBe(false);
        });
        it.each([
            "invalid block range",
            "request is limited to a rate of 5 per second",
            "timeout",
        ])("does not classify unrelated errors: %s", (message) => {
            expect(isBlockRangeTooLargeError(new Error(message))).toBe(false);
        });

        it("recognizes a range error nested inside a JSON-encoded HTTP body", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    body: JSON.stringify({
                        error: {
                            code: -32005,
                            message: "query returned more than 10000 results",
                        },
                    }),
                })
            ).toBe(true);
        });

        it("does not treat a non-JSON HTTP body as a range error", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    body: "<html>502 Bad Gateway</html>",
                })
            ).toBe(false);
        });

        it("falls through to the message check when the JSON body has no nested error", () => {
            expect(
                isBlockRangeTooLargeError({
                    code: "SERVER_ERROR",
                    message: "unrelated failure",
                    body: JSON.stringify({ result: "ok" }),
                })
            ).toBe(false);
        });

        it("stops descending into arbitrarily deep nested errors instead of recursing forever", () => {
            // Wraps a genuine range-error message under 15 levels of nested
            // `.error` - well past the recursion depth cutoff - to prove the
            // cutoff actually bounds the recursion rather than the function
            // eventually reaching (and matching) the innermost message.
            function nestError(depth: number): unknown {
                if (depth === 0) {
                    return { message: "block range is too wide" };
                }
                return { error: nestError(depth - 1) };
            }

            expect(isBlockRangeTooLargeError(nestError(15))).toBe(false);
        });
    });

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
            const getBlock = jest.fn(async (index: number) => ({
                number: index,
                hash: `0xblock${index}`,
            }));

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

        it("recovers from a range rejection with a second fallback provider offline", async () => {
            const provider = makeRangeLimitedMockProvider(1000, 500, []);
            (provider.getLogs as jest.Mock).mockImplementation(
                async (filter) => {
                    if (filter.toBlock - filter.fromBlock + 1 > 500) {
                        throw {
                            code: "SERVER_ERROR",
                            message: "failed to meet quorum",
                            results: [
                                {
                                    error: {
                                        code: -32005,
                                        message:
                                            "query returned more than 10000 results",
                                    },
                                },
                                {
                                    error: {
                                        code: "SERVER_ERROR",
                                        message: "missing response",
                                    },
                                },
                            ],
                        };
                    }
                    return [makeBurnLog(100, 9)];
                }
            );
            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                10,
                1000
            );
            await (monitor as any).getTipIndex();
            const events = await (monitor as any).getEvents(100);
            expect(events[0].returnValues.amount).toEqual("9");
            expect(provider.getLogs).toHaveBeenCalledTimes(2);
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

        it("never batches beyond the confirmed tip", async () => {
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

        it("throws clearly when the wide-range anchor block is missing (e.g. reorged away)", async () => {
            const CONFIRMATIONS = 10;
            const tipIndex = 5000; // confirmed tip = 4990
            const getLogs = jest.fn().mockResolvedValue([]);
            const getBlockNumber = jest.fn(async () => tipIndex);
            // Every block resolves normally except the wide-range chunk's
            // end anchor (2009, per catchUpChunkSize=2000 starting at 10),
            // which is missing entirely - as if it were reorged away between
            // being selected as the anchor and being read.
            const getBlock = jest.fn(
                async (blockHashOrIndex: number | string) => {
                    if (blockHashOrIndex === 2009) return null;
                    if (typeof blockHashOrIndex === "number") {
                        return {
                            number: blockHashOrIndex,
                            hash: `0xblock${blockHashOrIndex}`,
                        };
                    }
                    return { number: 10, hash: blockHashOrIndex };
                }
            );
            const provider = {
                _isProvider: true,
                getLogs,
                getBlockNumber,
                getBlock,
            } as unknown as ethers.providers.BaseProvider;

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS,
                2000 // catchUpChunkSize
            );

            await (monitor as any).getTipIndex();

            await expect((monitor as any).getEvents(10)).rejects.toThrow(
                "Missing range anchor block 2009"
            );
        });

        // Both real call sites of `validateEvents` (within getEvents itself)
        // always pass `recheckBlock` explicitly, so this default only
        // matters for a future/direct caller - proving it defaults to the
        // safer "also recheck" behavior, rather than that it's exercised by
        // any current code path.
        it("validateEvents rechecks the block hash by default when recheckBlock is omitted", async () => {
            const CONFIRMATIONS = 10;
            const provider = makeMockProvider(1000, []);

            const monitor = new EthereumBurnEventMonitor(
                provider,
                contractDescription,
                null,
                CONFIRMATIONS
            );

            const events = [
                { blockHash: "0xblock500", blockNumber: 500 },
            ] as any;

            await expect(
                (monitor as any).validateEvents(500, events)
            ).resolves.toBeUndefined();

            // Once to look up the block hash to validate `events` against,
            // and - only because `recheckBlock` defaulted to true - a second
            // time for the post-read recheck inside `assertBlockHash`.
            const getBlockCallsFor500 = (
                provider.getBlock as jest.Mock
            ).mock.calls.filter(([arg]: [number | string]) => arg === 500);
            expect(getBlockCallsFor500).toHaveLength(2);
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
