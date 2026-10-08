import {
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

    it("never restarts once a broadcast happened", async () => {
        const { provider } = trackingProvider();
        const error = { code: "TIMEOUT" };
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
        expect(sleep).not.toHaveBeenCalled();
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
