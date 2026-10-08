import { ethers } from "ethers";
import {
    assertSafeMinted,
    waitForMintReceiptByHash,
    DEFAULT_RECEIPT_TIMEOUT_MS,
    MintOutcomeUnknownError,
    pinnedUntilBroadcast,
    waitForMintReceipt,
} from "../src/mint-safety";

const HASH = `0x${"ab".repeat(32)}`;

function trackingProvider() {
    const releases: jest.Mock[] = [];
    const provider = {
        broadcastAttempts: 0,
        beginReadSession: jest.fn(async () => {
            const release = jest.fn();
            releases.push(release);
            return release;
        }),
    };
    return { provider, releases };
}

describe(pinnedUntilBroadcast.name, () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    beforeEach(() => sleep.mockClear());
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    it("runs once without pinning when the provider cannot track broadcasts", async () => {
        const attempt = jest.fn().mockRejectedValue({ code: "TIMEOUT" });
        await expect(
            pinnedUntilBroadcast({}, attempt, { attempts: 3, delayMs: 1 })
        ).rejects.toMatchObject({ code: "TIMEOUT" });
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("pins each attempt and releases it, including on success", async () => {
        const { provider, releases } = trackingProvider();
        await expect(
            pinnedUntilBroadcast(provider, async () => "tx", {
                attempts: 3,
                delayMs: 1,
                sleep,
            })
        ).resolves.toBe("tx");
        expect(releases).toHaveLength(1);
        expect(releases[0]).toHaveBeenCalledTimes(1);
    });

    it("restarts with a fresh session after a transient pre-broadcast failure", async () => {
        const { provider, releases } = trackingProvider();
        const attempt = jest
            .fn()
            .mockRejectedValueOnce({ code: "SERVER_ERROR", status: 503 })
            .mockResolvedValueOnce("tx");
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 3,
                delayMs: 7,
                sleep,
            })
        ).resolves.toBe("tx");
        expect(attempt).toHaveBeenCalledTimes(2);
        expect(releases.map((release) => release.mock.calls.length)).toEqual([
            1, 1,
        ]);
        expect(sleep).toHaveBeenCalledWith(7);
    });

    it("restarts when acquiring the session itself fails transiently", async () => {
        const { provider } = trackingProvider();
        provider.beginReadSession.mockRejectedValueOnce({ code: "TIMEOUT" });
        const attempt = jest.fn().mockResolvedValue("tx");
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 2,
                delayMs: 1,
                sleep,
            })
        ).resolves.toBe("tx");
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("never restarts once a broadcast happened; an unclear error is an unknown outcome", async () => {
        const { provider } = trackingProvider();
        const error = { code: "UNKNOWN_ERROR", transactionHash: HASH };
        const attempt = jest.fn(async () => {
            provider.broadcastAttempts += 1;
            throw error;
        });
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toMatchObject({
            name: "MintOutcomeUnknownError",
            transactionHash: HASH,
            cause: error,
        });
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it("reports an unknown hash when the post-broadcast error carries none", async () => {
        const { provider } = trackingProvider();
        const attempt = jest.fn(async () => {
            provider.broadcastAttempts += 1;
            throw null;
        });
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toMatchObject({ transactionHash: "unknown" });
    });

    it("uses the provider's record when a caller replaced the error", async () => {
        const { provider } = trackingProvider();
        const tracked = provider as typeof provider & {
            lastBroadcast?: { hash: string; rejected: boolean };
        };
        const unwrapped = { code: -32000, message: "nonce too low" };
        const rejectAttempt = jest.fn(async () => {
            provider.broadcastAttempts += 1;
            tracked.lastBroadcast = { hash: HASH, rejected: true };
            throw unwrapped;
        });
        await expect(
            pinnedUntilBroadcast(provider, rejectAttempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toBe(unwrapped);

        const ambiguousAttempt = jest.fn(async () => {
            provider.broadcastAttempts += 1;
            tracked.lastBroadcast = { hash: HASH, rejected: false };
            throw new Error("Web3 replaced this error");
        });
        await expect(
            pinnedUntilBroadcast(provider, ambiguousAttempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toMatchObject({
            name: "MintOutcomeUnknownError",
            transactionHash: HASH,
        });
    });

    it("propagates a definitive broadcast rejection without restarting", async () => {
        const { provider } = trackingProvider();
        const error = { code: "NONCE_EXPIRED", broadcastRejected: true };
        const attempt = jest.fn(async () => {
            provider.broadcastAttempts += 1;
            throw error;
        });
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toBe(error);
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("does not restart a deterministic failure", async () => {
        const { provider } = trackingProvider();
        const error = new Error("Not enough signatures");
        const attempt = jest.fn().mockRejectedValue(error);
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 5,
                delayMs: 1,
                sleep,
            })
        ).rejects.toBe(error);
        expect(attempt).toHaveBeenCalledTimes(1);
    });

    it("gives up after the configured attempts", async () => {
        const { provider } = trackingProvider();
        const attempt = jest.fn().mockRejectedValue({ code: "TIMEOUT" });
        await expect(
            pinnedUntilBroadcast(provider, attempt, {
                attempts: 3,
                delayMs: 1,
                sleep,
            })
        ).rejects.toMatchObject({ code: "TIMEOUT" });
        expect(attempt).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("waits with a real timer by default", async () => {
        const { provider } = trackingProvider();
        const attempt = jest
            .fn()
            .mockRejectedValueOnce({ code: "TIMEOUT" })
            .mockResolvedValueOnce("tx");
        await expect(
            pinnedUntilBroadcast(provider, attempt, { attempts: 2, delayMs: 1 })
        ).resolves.toBe("tx");
    });
});

describe(waitForMintReceipt.name, () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    beforeEach(() => sleep.mockClear());
    afterEach(() => jest.restoreAllMocks());

    it("passes one confirmation and the remaining deadline to wait()", async () => {
        jest.spyOn(Date, "now").mockReturnValue(1000);
        const wait = jest.fn().mockResolvedValue("receipt");
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 0, delayMs: 1, timeoutMs: 500 }
            )
        ).resolves.toBe("receipt");
        expect(wait).toHaveBeenCalledWith(1, 500);
    });

    it("defaults to a 30-minute deadline", async () => {
        jest.spyOn(Date, "now").mockReturnValue(0);
        const wait = jest.fn().mockResolvedValue("receipt");
        await waitForMintReceipt(
            { hash: HASH, wait },
            { maxRetry: 0, delayMs: 1 }
        );
        expect(wait).toHaveBeenCalledWith(1, DEFAULT_RECEIPT_TIMEOUT_MS);
    });

    it("retries an error only the routing provider classifies as transient", async () => {
        const wait = jest
            .fn()
            .mockRejectedValueOnce({ code: "ECONNRESET" })
            .mockResolvedValueOnce({ status: 1 });
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 1, delayMs: 1, sleep }
            )
        ).resolves.toEqual({ status: 1 });
    });

    it("reports a non-definitive, non-transient error as unknown at once", async () => {
        const error = { status: 403 };
        const wait = jest.fn().mockRejectedValue(error);
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 5, delayMs: 1, sleep }
            )
        ).rejects.toMatchObject({ transactionHash: HASH, cause: error });
        expect(wait).toHaveBeenCalledTimes(1);
    });

    it.each([
        { code: "CALL_EXCEPTION" },
        { code: "TRANSACTION_REPLACED", cancelled: true, reason: "replaced" },
    ])("propagates the definitive outcome %j", async (error) => {
        const wait = jest.fn().mockRejectedValue(error);
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 5, delayMs: 1, sleep }
            )
        ).rejects.toBe(error);
    });

    it("does not treat a repriced replacement (same mint) as a failure", async () => {
        const error = {
            code: "TRANSACTION_REPLACED",
            cancelled: false,
            reason: "repriced",
        };
        const wait = jest.fn().mockRejectedValue(error);
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 5, delayMs: 1, sleep }
            )
        ).rejects.toMatchObject({
            name: "MintOutcomeUnknownError",
            cause: error,
        });
    });

    it("fails definitively when the awaited receipt is a mined revert", async () => {
        const receipt = { status: 0 };
        const wait = jest.fn().mockResolvedValue(receipt);
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 5, delayMs: 1, sleep }
            )
        ).rejects.toMatchObject({ code: "CALL_EXCEPTION", receipt });
    });

    it("propagates definitive outcomes such as a revert", async () => {
        const error = { code: "CALL_EXCEPTION" };
        const wait = jest.fn().mockRejectedValue(error);
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 5, delayMs: 1, sleep }
            )
        ).rejects.toBe(error);
        expect(wait).toHaveBeenCalledTimes(1);
    });

    it("retries transient errors and then reports an unknown outcome", async () => {
        const cause = { code: "SERVER_ERROR", status: 503 };
        const wait = jest.fn().mockRejectedValue(cause);
        const error = (await waitForMintReceipt(
            { hash: HASH, wait },
            { maxRetry: 2, delayMs: 3, sleep }
        ).catch((e: unknown) => e)) as MintOutcomeUnknownError;
        expect(error).toBeInstanceOf(MintOutcomeUnknownError);
        expect(error).toMatchObject({ transactionHash: HASH, cause });
        expect(error.message).toContain(HASH);
        expect(error.message).toContain("do not re-mint");
        expect(wait).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
    });

    it("reports an unknown outcome once the deadline passes, even with retries left", async () => {
        let now = 0;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        const wait = jest.fn(async () => {
            now = 100;
            throw { code: "TIMEOUT" };
        });
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 10, delayMs: 1, timeoutMs: 100, sleep }
            )
        ).rejects.toBeInstanceOf(MintOutcomeUnknownError);
        expect(wait).toHaveBeenCalledTimes(1);
    });

    it("waits with a real timer by default", async () => {
        const wait = jest
            .fn()
            .mockRejectedValueOnce({ code: "TIMEOUT" })
            .mockResolvedValueOnce("receipt");
        await expect(
            waitForMintReceipt(
                { hash: HASH, wait },
                { maxRetry: 1, delayMs: 1 }
            )
        ).resolves.toBe("receipt");
    });
});

describe(MintOutcomeUnknownError.name, () => {
    it.each([
        [new Error("boom"), "boom"],
        [{ code: "TIMEOUT" }, '{"code":"TIMEOUT"}'],
    ])("describes its cause %j", (cause, text) => {
        expect(new MintOutcomeUnknownError(HASH, cause).message).toContain(
            text
        );
    });

    it("falls back to String() for an unserializable cause", () => {
        const cause: { self?: unknown } = {};
        cause.self = cause;
        expect(new MintOutcomeUnknownError(HASH, cause).message).toContain(
            "[object Object]"
        );
    });
});

describe(assertSafeMinted.name, () => {
    const SAFE = "0x1111111111111111111111111111111111111111";
    const TOKEN = "0x2222222222222222222222222222222222222222";
    const transfer = (address: string, from: string) => ({
        address,
        topics: [
            ethers.utils.id("Transfer(address,address,uint256)"),
            ethers.utils.hexZeroPad(from, 32),
            ethers.utils.hexZeroPad("0x01", 32),
        ],
    });
    const executionFailure = {
        address: SAFE.toUpperCase().replace("0X", "0x"),
        topics: [ethers.utils.id("ExecutionFailure(bytes32,uint256)")],
    };

    it("accepts a mint Transfer from the token, case-insensitively", () => {
        expect(() =>
            assertSafeMinted(
                {
                    transactionHash: HASH,
                    logs: [
                        transfer(
                            TOKEN.toUpperCase().replace("0X", "0x"),
                            "0x00"
                        ),
                    ],
                },
                SAFE,
                TOKEN
            )
        ).not.toThrow();
    });

    it("fails definitively when the Safe reports ExecutionFailure", () => {
        expect(() =>
            assertSafeMinted(
                { transactionHash: HASH, logs: [executionFailure] },
                SAFE,
                TOKEN
            )
        ).toThrow(
            expect.objectContaining({
                code: "CALL_EXCEPTION",
                message: expect.stringContaining("inner wNCG mint failed"),
            })
        );
    });

    it.each([
        ["no logs", undefined],
        ["a non-mint transfer", [transfer(TOKEN, "0x05")]],
        ["a mint from another contract", [transfer(SAFE, "0x00")]],
    ])("reports an unknown outcome for %s", (_name, logs) => {
        expect(() =>
            assertSafeMinted({ transactionHash: HASH, logs }, SAFE, TOKEN)
        ).toThrow(MintOutcomeUnknownError);
    });
});

describe(waitForMintReceiptByHash.name, () => {
    it("waits through the provider with one confirmation and a deadline", async () => {
        const provider = {
            waitForTransaction: jest.fn().mockResolvedValue({ status: 1 }),
        };
        await expect(
            waitForMintReceiptByHash(provider, HASH, {
                maxRetry: 0,
                delayMs: 1,
                timeoutMs: 1000,
            })
        ).resolves.toEqual({ status: 1 });
        expect(provider.waitForTransaction).toHaveBeenCalledWith(
            HASH,
            1,
            expect.any(Number)
        );
    });

    it("reports an unknown outcome when no receipt comes back", async () => {
        const provider = {
            waitForTransaction: jest.fn().mockResolvedValue(null),
        };
        await expect(
            waitForMintReceiptByHash(provider, HASH, {
                maxRetry: 0,
                delayMs: 1,
            })
        ).rejects.toBeInstanceOf(MintOutcomeUnknownError);
    });
});
