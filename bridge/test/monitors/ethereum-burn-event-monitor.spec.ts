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

    describe("loop - per-position progress commit across a mid-batch failure", () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        // Mirrors the equivalent regression test in the BSC bridge fork: a
        // block-range batch is being caught up on, and one event block partway
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
