import { isRetryableEthereumError, retryEthereumRpc } from "../src/rpc-retry";

describe(isRetryableEthereumError.name, () => {
    it("returns true for ethers SERVER_ERROR", () => {
        expect(
            isRetryableEthereumError({
                code: "SERVER_ERROR",
                reason: "bad response",
            })
        ).toBe(true);
    });

    it("returns true for ethers TIMEOUT", () => {
        expect(isRetryableEthereumError({ code: "TIMEOUT" })).toBe(true);
    });

    it("returns true for ethers NETWORK_ERROR", () => {
        expect(isRetryableEthereumError({ code: "NETWORK_ERROR" })).toBe(true);
    });

    it("returns true for a JSON-RPC -326xx internal error code (number)", () => {
        expect(isRetryableEthereumError({ code: -32603 })).toBe(true);
    });

    it("returns true for a bare JSON-RPC Internal error (-32603) nested under `.error`", () => {
        expect(
            isRetryableEthereumError({
                code: "SERVER_ERROR",
                error: { code: -32603 },
            })
        ).toBe(true);
    });

    it("returns false for a plain Error with no code", () => {
        expect(isRetryableEthereumError(new Error("boom"))).toBe(false);
    });

    it("returns false for a revert-like execution error (-32000)", () => {
        expect(
            isRetryableEthereumError({
                code: -32000,
                message: "execution reverted",
            })
        ).toBe(false);
    });

    it("returns false for CALL_EXCEPTION (indicates a real contract-level problem)", () => {
        expect(isRetryableEthereumError({ code: "CALL_EXCEPTION" })).toBe(
            false
        );
    });

    it("returns false for null/undefined/primitives", () => {
        expect(isRetryableEthereumError(null)).toBe(false);
        expect(isRetryableEthereumError(undefined)).toBe(false);
        expect(isRetryableEthereumError("some string error")).toBe(false);
    });

    // P2 regression: not every -326xx code is safe to retry. -32600/-32601/
    // -32602 are deterministic client-side problems (bad request, unknown
    // method, bad params) that will never succeed no matter how many times
    // they're retried.
    for (const deterministicCode of [-32700, -32600, -32601, -32602]) {
        it(`returns false for the deterministic bare JSON-RPC code ${deterministicCode}`, () => {
            expect(isRetryableEthereumError({ code: deterministicCode })).toBe(
                false
            );
        });

        it(
            `returns false for the deterministic JSON-RPC code ${deterministicCode} even ` +
                "when nested inside an outer SERVER_ERROR-looking wrapper",
            () => {
                expect(
                    isRetryableEthereumError({
                        code: "SERVER_ERROR",
                        error: {
                            code: deterministicCode,
                            message: "bad request",
                        },
                    })
                ).toBe(false);
            }
        );
    }

    it(
        "returns true for a plain SERVER_ERROR with no inner JSON-RPC error " +
            "code to contradict it (e.g. a malformed/empty response)",
        () => {
            expect(
                isRetryableEthereumError({
                    code: "SERVER_ERROR",
                    reason: "bad response",
                })
            ).toBe(true);
        }
    );
});

describe(retryEthereumRpc.name, () => {
    // Uses a tiny real delay (rather than jest fake timers, which this repo's
    // jest version doesn't support for chained async retries) so these stay fast.
    const FAST_DELAY_MS = 1;

    it("returns the result immediately when fn succeeds on the first try", async () => {
        const fn = jest.fn().mockResolvedValue("OK");

        const result = await retryEthereumRpc(fn, {
            maxRetry: 3,
            delayMs: FAST_DELAY_MS,
        });

        expect(result).toBe("OK");
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("retries on a transient error and eventually succeeds", async () => {
        const fn = jest
            .fn()
            .mockRejectedValueOnce({ code: "SERVER_ERROR" })
            .mockRejectedValueOnce({ code: "TIMEOUT" })
            .mockResolvedValueOnce("OK");
        const onRetryableError = jest.fn();

        const result = await retryEthereumRpc(fn, {
            maxRetry: 3,
            delayMs: FAST_DELAY_MS,
            onRetryableError,
        });

        expect(result).toBe("OK");
        expect(fn).toHaveBeenCalledTimes(3);
        expect(onRetryableError).toHaveBeenCalledTimes(2);
    });

    it("throws immediately without retrying on a non-transient error", async () => {
        const error = new Error("nonce too low");
        const fn = jest.fn().mockRejectedValue(error);

        await expect(
            retryEthereumRpc(fn, { maxRetry: 3, delayMs: FAST_DELAY_MS })
        ).rejects.toBe(error);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("gives up and throws once retries are exhausted", async () => {
        const error = { code: "SERVER_ERROR" };
        const fn = jest.fn().mockRejectedValue(error);

        await expect(
            retryEthereumRpc(fn, { maxRetry: 2, delayMs: FAST_DELAY_MS })
        ).rejects.toBe(error);

        // 1 initial attempt + 2 retries = 3 calls
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it("never retries more than maxRetry times", async () => {
        const fn = jest.fn().mockRejectedValue({ code: "NETWORK_ERROR" });

        await expect(
            retryEthereumRpc(fn, { maxRetry: 0, delayMs: FAST_DELAY_MS })
        ).rejects.toEqual({ code: "NETWORK_ERROR" });
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
