import { ethers } from "ethers";
import {
    PrimaryRpcProvider,
    isAlreadyKnownError,
    isDefinitiveRejection,
    isBroadcastRejection,
    isPrimaryRpcTransientError,
} from "../src/primary-rpc-provider";

type Endpoint = {
    chainId: string;
    down?: boolean;
    failures: Record<string, unknown>;
    calls: string[];
};
const PRIMARY = "http://primary.invalid";
const SECONDARY = "http://secondary.invalid";
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("sequential primary RPC provider", () => {
    let primary: Endpoint;
    let secondary: Endpoint;
    let now: number;
    beforeEach(() => {
        primary = { chainId: "0x1", failures: {}, calls: [] };
        secondary = { chainId: "0x1", failures: {}, calls: [] };
        now = 1000000;
        jest.spyOn(Date, "now").mockImplementation(() => now);
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider,
            method: string
        ) {
            const state = this.connection.url === PRIMARY ? primary : secondary;
            state.calls.push(method);
            if (state.down) throw { code: "SERVER_ERROR", status: 503 };
            if (state.failures[method]) throw state.failures[method];
            if (method === "eth_chainId") return state.chainId;
            if (method === "net_version")
                return String(parseInt(state.chainId, 16));
            if (method === "eth_getLogs") return [];
            return "0x2a";
        });
    });
    afterEach(() => jest.restoreAllMocks());
    const create = (cooldownMs?: number, chainCheckIntervalMs?: number) =>
        new PrimaryRpcProvider(PRIMARY, SECONDARY, {
            expectedChainId: 1,
            cooldownMs,
            chainCheckIntervalMs,
        });

    it("isolates monitor read leases from concurrent mint/receipt traffic", async () => {
        const shared = create();
        const scanner = shared.createReadProvider();
        const release = await scanner.beginReadSession();
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        // A mint's independent read can fall back while the monitor stays pinned.
        await expect(shared.send("eth_gasPrice", [])).resolves.toBe("0x2a");
        await expect(scanner.send("eth_gasPrice", [])).rejects.toMatchObject({
            code: "TIMEOUT",
        });
        expect(
            secondary.calls.filter((x) => x === "eth_gasPrice")
        ).toHaveLength(1);
        release();
        const retry = await scanner.beginReadSession();
        await expect(scanner.send("eth_gasPrice", [])).resolves.toBe("0x2a");
        retry();
    });
    it("re-sends the same signed bytes past a pinned session after an ambiguous failure", async () => {
        const provider = create();
        const release = await provider.beginReadSession();
        primary.failures.eth_sendRawTransaction = { code: "TIMEOUT" };
        await expect(
            provider.send("eth_sendRawTransaction", ["0x1234"])
        ).resolves.toBe("0x2a");
        expect(
            primary.calls.filter((x) => x === "eth_sendRawTransaction")
        ).toHaveLength(1);
        expect(
            secondary.calls.filter((x) => x === "eth_sendRawTransaction")
        ).toHaveLength(1);
        expect(provider.broadcastAttempts).toBe(1);
        release();
    });
    it("shares a nested lease acquired after the first lease has settled", async () => {
        const provider = create();
        const first = await provider.beginReadSession();
        const second = await provider.beginReadSession();
        first();
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        await expect(provider.send("eth_gasPrice", [])).rejects.toMatchObject({
            code: "TIMEOUT",
        });
        expect(secondary.calls).toEqual([]);
        second();
        await expect(provider.send("eth_gasPrice", [])).resolves.toBe("0x2a");
    });
    it.each(["secondary", "deterministic", "single"])(
        "preserves a pinned %s probe failure without switching endpoints",
        async (variant) => {
            // Probe every read so the pinned session's probe itself fails.
            const provider =
                variant === "single"
                    ? new PrimaryRpcProvider(PRIMARY, undefined, {
                          expectedChainId: 1,
                          chainCheckIntervalMs: 0,
                      })
                    : create(undefined, 0);
            if (variant === "secondary") primary.down = true;
            const release = await provider.beginReadSession();
            const state = variant === "secondary" ? secondary : primary;
            const failure =
                variant === "deterministic"
                    ? { status: 401 }
                    : { code: "TIMEOUT" };
            state.failures.eth_chainId = failure;
            await expect(provider.send("eth_gasPrice", [])).rejects.toBe(
                failure
            );
            expect(primary.calls).not.toContain("eth_gasPrice");
            expect(secondary.calls).not.toContain("eth_gasPrice");
            release();
        }
    );
    it("constructs without RPC and keeps an unused secondary completely idle", async () => {
        const provider = create();
        expect(primary.calls).toEqual([]);
        expect(secondary.calls).toEqual([]);
        expect((await provider.getNetwork()).chainId).toBe(1);
        expect((await provider.getGasPrice()).toNumber()).toBe(42);
        await tick();
        expect((await provider.getGasPrice()).toNumber()).toBe(42);
        expect(secondary.calls).toEqual([]);
    });
    it("counts A -> B -> A dispatches without counting discovery probes", async () => {
        const provider = create();
        expect(provider.readEpoch).toBe(0);
        await provider.detectNetwork();
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(0);
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(1);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(1);

        delete primary.failures.eth_gasPrice;
        now += 30000;
        await provider.detectNetwork();
        expect(provider.readEpoch).toBe(1);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(2);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(2);
    });
    it("does not count probe failover before the first data dispatch", async () => {
        const provider = create();
        primary.down = true;
        await provider.detectNetwork();
        expect(provider.readEpoch).toBe(0);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(0);
        primary.down = false;
        now += 30000;
        await provider.detectNetwork();
        expect(provider.readEpoch).toBe(0);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(1);
    });
    it("keeps concurrent completion from undoing a dispatch epoch", async () => {
        const provider = create();
        const transport = (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).getMockImplementation()!;
        let release!: (value: string) => void;
        let started!: () => void;
        const pendingStarted = new Promise<void>((resolve) => {
            started = resolve;
        });
        (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).mockImplementation(function (
            this: ethers.providers.JsonRpcProvider,
            method: string,
            params: any[]
        ) {
            if (
                this.connection.url === PRIMARY &&
                method === "eth_blockNumber"
            ) {
                started();
                return new Promise<string>((resolve) => {
                    release = resolve;
                });
            }
            return transport.call(this, method, params);
        });
        const pending = provider.send("eth_blockNumber", []);
        await pendingStarted;
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(1);
        delete primary.failures.eth_gasPrice;
        now += 30000;
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(2);
        release("0x2a");
        await pending;
        expect(provider.readEpoch).toBe(2);
    });
    it("pins overlapping sessions past cooldown until the final release", async () => {
        primary.down = true;
        const provider = create();
        const [releaseFirst, releaseSecond] = await Promise.all([
            provider.beginReadSession(),
            provider.beginReadSession(),
        ]);
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(0);
        const calls = primary.calls.length;
        primary.down = false;
        now += 32000;
        await provider.detectNetwork();
        await provider.send("eth_gasPrice", []);
        expect(primary.calls).toHaveLength(calls);
        releaseFirst();
        releaseFirst();
        await provider.send("eth_gasPrice", []);
        expect(primary.calls).toHaveLength(calls);
        releaseSecond();
        await provider.send("eth_gasPrice", []);
        expect(primary.calls).toHaveLength(calls + 2);
        expect(provider.readEpoch).toBe(1);
    });
    it("aborts a pinned primary read then starts the next session on secondary", async () => {
        const provider = create();
        const release = await provider.beginReadSession();
        await provider.send("eth_gasPrice", []);
        const error = { code: "TIMEOUT" };
        primary.failures.eth_gasPrice = error;
        await expect(provider.send("eth_gasPrice", [])).rejects.toBe(error);
        expect(secondary.calls).toEqual([]);
        expect(provider.readEpoch).toBe(0);
        release();
        const releaseSecondary = await provider.beginReadSession();
        await provider.send("eth_gasPrice", []);
        expect(provider.readEpoch).toBe(1);
        const calls = primary.calls.length;
        now += 32000;
        await provider.send("eth_gasPrice", []);
        expect(primary.calls).toHaveLength(calls);
        releaseSecondary();
    });
    it("starts the next session on secondary when a pinned primary probe fails", async () => {
        const provider = create(undefined, 0);
        const release = await provider.beginReadSession();
        const error = { code: "SERVER_ERROR", status: 429 };
        primary.failures.eth_chainId = error;
        await expect(provider.send("eth_gasPrice", [])).rejects.toBe(error);
        expect(secondary.calls).toEqual([]);
        expect(primary.calls).not.toContain("eth_gasPrice");
        release();
        delete primary.failures.eth_chainId;
        const primaryCalls = primary.calls.length;
        const releaseSecondary = await provider.beginReadSession();
        await expect(provider.send("eth_gasPrice", [])).resolves.toBe("0x2a");
        expect(primary.calls).toHaveLength(primaryCalls);
        expect(secondary.calls).toContain("eth_gasPrice");
        releaseSecondary();
    });
    it("clears failed session acquisition so a later session can recover", async () => {
        const provider = create();
        primary.down = secondary.down = true;
        await expect(provider.beginReadSession()).rejects.toMatchObject({
            status: 503,
        });
        secondary.down = false;
        const release = await provider.beginReadSession();
        await provider.send("eth_gasPrice", []);
        release();
    });
    it("returns the fallback's lower real tip instead of a cached primary maximum", async () => {
        const provider = create();
        const transport = (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).getMockImplementation()!;
        (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider,
            method: string,
            params: any[]
        ) {
            const result = await transport.call(this, method, params);
            if (method === "eth_blockNumber")
                return this.connection.url === PRIMARY ? "0x3f2" : "0x3e8";
            return result;
        });
        expect(await provider.getBlockNumber()).toBe(1010);
        primary.failures.eth_blockNumber = { code: "TIMEOUT" };
        expect(await provider.getBlockNumber()).toBe(1000);
        expect(await provider.getBlockNumber()).toBe(1000);
    });
    it("does not contact an unavailable secondary while the primary is healthy", async () => {
        secondary.down = true;
        expect((await create().getGasPrice()).toNumber()).toBe(42);
        expect(secondary.calls).toEqual([]);
    });
    it("starts on secondary when primary network discovery fails", async () => {
        primary.down = true;
        const provider = create();
        expect((await provider.getNetwork()).chainId).toBe(1);
        expect((await provider.getGasPrice()).toNumber()).toBe(42);
        expect(secondary.calls).toContain("eth_chainId");
        expect(secondary.calls).toContain("eth_gasPrice");
        const primaryAttempts = primary.calls.length;
        await tick();
        await provider.getGasPrice();
        expect(primary.calls).toHaveLength(primaryAttempts);
    });
    it.each([
        { code: "TIMEOUT" },
        { code: "SERVER_ERROR", status: 429 },
        { code: "SERVER_ERROR", status: 402 },
        {
            code: "SERVER_ERROR",
            error: { code: -32005, message: "monthly quota exceeded" },
        },
    ])(
        "falls back sequentially after a primary read failure: %j",
        async (error) => {
            primary.failures.eth_gasPrice = error;
            const provider = create();
            expect((await provider.getGasPrice()).toNumber()).toBe(42);
            expect(
                primary.calls.filter((method) => method === "eth_gasPrice")
            ).toHaveLength(1);
            expect(secondary.calls).toContain("eth_chainId");
            expect(
                secondary.calls.filter((method) => method === "eth_gasPrice")
            ).toHaveLength(1);
            const calls = primary.calls.length;
            await tick();
            await provider.getGasPrice();
            expect(primary.calls).toHaveLength(calls);
        }
    );
    it("waits for the primary request to fail before making any secondary request", async () => {
        let rejectPrimary!: (error: unknown) => void;
        let notifyStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            notifyStarted = resolve;
        });
        const transport = (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).getMockImplementation()!;
        (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).mockImplementation(function (
            this: ethers.providers.JsonRpcProvider,
            method: string,
            params: any[]
        ) {
            if (this.connection.url === PRIMARY && method === "eth_gasPrice") {
                return new Promise((_, reject) => {
                    rejectPrimary = reject;
                    notifyStarted();
                });
            }
            return transport.call(this, method, params);
        });
        const request = create().getGasPrice();
        await started;
        expect(secondary.calls).toEqual([]);
        rejectPrimary({ code: "TIMEOUT" });
        expect((await request).toNumber()).toBe(42);
        expect(secondary.calls).toContain("eth_gasPrice");
    });
    it("propagates failure when both endpoint network probes fail", async () => {
        primary.down = secondary.down = true;
        await expect(create().getNetwork()).rejects.toMatchObject({
            code: "SERVER_ERROR",
            status: 503,
        });
    });
    it.each([
        { code: "SERVER_ERROR", status: 401 },
        {
            code: "SERVER_ERROR",
            error: { code: -32602, message: "invalid params" },
        },
    ])(
        "does not hide a deterministic network-probe error: %j",
        async (error) => {
            primary.failures.eth_chainId = error;
            await expect(create().getNetwork()).rejects.toBe(error);
            expect(secondary.calls).toEqual([]);
        }
    );
    it("rejects a malformed network response without trying secondary", async () => {
        primary.chainId = "not-a-chain-id";
        await expect(create().getNetwork()).rejects.toMatchObject({
            code: "INVALID_ARGUMENT",
        });
        expect(secondary.calls).toEqual([]);
    });
    it("renews cooldown when primary network probes recover but its reads still fail", async () => {
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        const provider = create(100);
        await provider.getGasPrice();
        now += 100;
        await tick();
        await provider.getGasPrice();
        expect(
            primary.calls.filter((method) => method === "eth_gasPrice")
        ).toHaveLength(2);
        const calls = primary.calls.length;
        now += 99;
        await tick();
        await provider.getGasPrice();
        expect(primary.calls).toHaveLength(calls);
    });
    it("never bounces a secondary read failure back to primary", async () => {
        const primaryError = { code: "TIMEOUT" };
        const secondaryError = { code: "SERVER_ERROR", status: 503 };
        primary.failures.eth_gasPrice = primaryError;
        secondary.failures.eth_gasPrice = secondaryError;
        const provider = create();
        await expect(provider.getGasPrice()).rejects.toBe(secondaryError);
        const calls = primary.calls.length;
        await tick();
        await expect(provider.getGasPrice()).rejects.toBe(secondaryError);
        expect(primary.calls).toHaveLength(calls);
    });
    it("returns to recovered primary after cooldown, sharing its network probe across concurrent reads", async () => {
        primary.down = true;
        const provider = create(100);
        await provider.getGasPrice();
        const oldCalls = primary.calls.length;
        primary.down = false;
        now += 99;
        await tick();
        await provider.getGasPrice();
        expect(primary.calls).toHaveLength(oldCalls);
        const secondaryCalls = secondary.calls.length;
        now += 1;
        await tick();
        await Promise.all(
            Array.from({ length: 8 }, () => provider.perform("getGasPrice", {}))
        );
        const recoveryCalls = primary.calls.slice(oldCalls);
        expect(
            recoveryCalls.filter((method) => method === "eth_chainId")
        ).toHaveLength(1);
        expect(
            recoveryCalls.filter((method) => method === "eth_gasPrice")
        ).toHaveLength(8);
        expect(secondary.calls).toHaveLength(secondaryCalls);
    });
    it("fails closed if the primary is on an unexpected chain", async () => {
        primary.chainId = "0x38";
        await expect(create().getNetwork()).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(secondary.calls).toEqual([]);
    });
    it("validates a secondary's chain before sending it any read", async () => {
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        secondary.chainId = "0x38";
        await expect(create().getGasPrice()).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(secondary.calls).not.toContain("eth_gasPrice");
    });
    it("fails closed if a recovering primary changes chain", async () => {
        primary.down = true;
        const provider = create(100);
        await provider.getGasPrice();
        primary.down = false;
        primary.chainId = "0x38";
        now += 100;
        await tick();
        const secondaryCalls = secondary.calls.length;
        await expect(provider.getGasPrice()).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(secondary.calls).toHaveLength(secondaryCalls);
    });
    it.each([
        {
            code: "SERVER_ERROR",
            error: { code: -32602, message: "invalid params" },
        },
        { code: -32005, message: "query returned more than 10000 results" },
        { code: "CALL_EXCEPTION", reason: "execution reverted" },
        { code: -32603, message: "execution reverted" },
        {
            code: "SERVER_ERROR",
            error: { code: -32603, message: "execution reverted" },
        },
    ])(
        "preserves deterministic read errors for the caller: %j",
        async (error) => {
            primary.failures.eth_getLogs = error;
            await expect(
                create().getLogs({ fromBlock: 1, toBlock: 2 })
            ).rejects.toBe(error);
            expect(secondary.calls).toEqual([]);
        }
    );
    it.each([
        { code: "TIMEOUT", message: "request timed out" },
        { code: "SERVER_ERROR", status: 429, message: "bad response" },
        {
            code: "SERVER_ERROR",
            error: { code: -32005, message: "limit exceeded" },
        },
    ])(
        "retries an eth_call transport failure wrapped by ethers: %j",
        async (error) => {
            primary.failures.eth_call = error;
            await expect(
                create().perform("call", {
                    transaction: {
                        to: "0x0000000000000000000000000000000000000001",
                    },
                    blockTag: "latest",
                })
            ).resolves.toBe("0x2a");
            expect(primary.calls).toEqual(["eth_chainId", "eth_call"]);
            expect(secondary.calls).toEqual(["eth_chainId", "eth_call"]);
        }
    );
    it("preserves an actual eth_call execution revert inside ethers' missing-data wrapper", async () => {
        primary.failures.eth_call = {
            code: -32603,
            message: "execution reverted: not authorized",
        };
        await expect(
            create().perform("call", {
                transaction: {
                    to: "0x0000000000000000000000000000000000000001",
                },
                blockTag: "latest",
            })
        ).rejects.toMatchObject({
            code: "CALL_EXCEPTION",
            data: "0x",
            error: {
                code: -32603,
                message: "execution reverted: not authorized",
            },
        });
        expect(primary.calls).toEqual(["eth_chainId", "eth_call"]);
        expect(secondary.calls).toEqual([]);
    });
    describe("idempotent broadcast", () => {
        const SIGNED = "0x1234";
        const HASH = ethers.utils.keccak256(SIGNED);
        const sends = (endpoint: Endpoint) =>
            endpoint.calls.filter(
                (method) => method === "eth_sendRawTransaction"
            ).length;
        const broadcast = (provider: PrimaryRpcProvider) =>
            provider.perform("sendTransaction", { signedTransaction: SIGNED });

        it("sends once to a healthy primary and counts the broadcast", async () => {
            const provider = create();
            expect(provider.broadcastAttempts).toBe(0);
            expect(provider.lastBroadcast).toBeUndefined();
            await expect(broadcast(provider)).resolves.toBe("0x2a");
            expect(provider.lastBroadcast).toEqual({
                hash: HASH,
                rejected: false,
            });
            expect(sends(primary)).toBe(1);
            expect(secondary.calls).toEqual([]);
            expect(provider.broadcastAttempts).toBe(1);
        });
        it("fails a definitive first rejection, tagged, without trying another endpoint", async () => {
            primary.failures.eth_sendRawTransaction = {
                code: -32000,
                message: "insufficient funds for gas * price + value",
            };
            const provider = create();
            await expect(broadcast(provider)).rejects.toMatchObject({
                code: "INSUFFICIENT_FUNDS",
                broadcastRejected: true,
            });
            expect(provider.lastBroadcast).toEqual({
                hash: HASH,
                rejected: true,
            });
            expect(secondary.calls).toEqual([]);
            expect(provider.broadcastAttempts).toBe(1);
        });
        it("treats a first 'nonce too low' as a definitive rejection", async () => {
            primary.failures.eth_sendRawTransaction = {
                code: -32000,
                message: "nonce too low",
            };
            await expect(broadcast(create())).rejects.toMatchObject({
                code: "NONCE_EXPIRED",
                broadcastRejected: true,
            });
            expect(secondary.calls).toEqual([]);
        });
        it("returns the hash when the first endpoint already knows the bytes", async () => {
            primary.failures.eth_sendRawTransaction = {
                code: -32000,
                message: "already known",
            };
            await expect(broadcast(create())).resolves.toBe(HASH);
            expect(secondary.calls).toEqual([]);
        });
        it("treats an unrecognized gateway error as possibly accepted", async () => {
            primary.failures.eth_sendRawTransaction = {
                code: -32000,
                message: "upstream error",
            };
            const provider = create();
            await expect(broadcast(provider)).resolves.toBe("0x2a");
            expect(sends(secondary)).toBe(1);
            // A non-transient error does not start the primary cooldown.
            await provider.getGasPrice();
            expect(primary.calls).toContain("eth_gasPrice");
        });
        it("sends to the pinned session's endpoint first", async () => {
            const provider = create();
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            await provider.getGasPrice();
            delete primary.failures.eth_gasPrice;
            const release = await provider.beginReadSession();
            now += 30000;
            await tick();
            await expect(broadcast(provider)).resolves.toBe("0x2a");
            expect(sends(primary)).toBe(0);
            expect(sends(secondary)).toBe(1);
            release();
        });
        it.each([
            { code: -32000, message: "already known" },
            { code: -32000, message: "nonce too low" },
            { code: -32000, message: "replacement transaction underpriced" },
            { code: -32000, message: "insufficient funds for gas" },
        ])(
            "returns the hash when a later endpoint answers %j after an ambiguous attempt",
            async (answer) => {
                primary.failures.eth_sendRawTransaction = { code: "TIMEOUT" };
                secondary.failures.eth_sendRawTransaction = answer;
                await expect(broadcast(create())).resolves.toBe(HASH);
                expect(sends(primary)).toBe(1);
                expect(sends(secondary)).toBe(1);
            }
        );
        it("prefers the secondary during primary cooldown", async () => {
            const provider = create();
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            await provider.getGasPrice();
            await expect(broadcast(provider)).resolves.toBe("0x2a");
            expect(sends(primary)).toBe(0);
            expect(sends(secondary)).toBe(1);
        });
        it("backs off and repeats rounds, then returns the hash while still ambiguous", async () => {
            const sleep = jest.fn().mockResolvedValue(undefined);
            const provider = new PrimaryRpcProvider(PRIMARY, SECONDARY, {
                expectedChainId: 1,
                retryRounds: 3,
                sleep,
            });
            primary.failures.eth_sendRawTransaction = { code: "TIMEOUT" };
            secondary.failures.eth_sendRawTransaction = {
                code: "SERVER_ERROR",
                status: 503,
            };
            await expect(broadcast(provider)).resolves.toBe(HASH);
            expect(sleep).toHaveBeenCalledTimes(2);
            expect(sends(primary) + sends(secondary)).toBe(6);
            expect(provider.broadcastAttempts).toBe(1);
        });
        it("accepts a later round's success after an ambiguous round", async () => {
            const sleep = jest.fn(async () => {
                delete primary.failures.eth_sendRawTransaction;
            });
            const provider = new PrimaryRpcProvider(PRIMARY, undefined, {
                expectedChainId: 1,
                retryRounds: 2,
                sleep,
            });
            primary.failures.eth_sendRawTransaction = { code: "TIMEOUT" };
            await expect(broadcast(provider)).resolves.toBe("0x2a");
            expect(sends(primary)).toBe(2);
        });
        it("throws untagged, without counting a broadcast, when no endpoint was reachable", async () => {
            primary.down = true;
            secondary.down = true;
            const provider = create();
            const error = await broadcast(provider).catch((e: unknown) => e);
            expect(error).toMatchObject({
                code: "SERVER_ERROR",
                transactionHash: HASH,
            });
            expect(isBroadcastRejection(error)).toBe(false);
            expect(sends(primary) + sends(secondary)).toBe(0);
            expect(provider.broadcastAttempts).toBe(0);
        });
        it("never sends to a wrong-chain endpoint before any ambiguity", async () => {
            primary.chainId = "0x38";
            await expect(broadcast(create())).rejects.toMatchObject({
                code: "NETWORK_ERROR",
                event: "changed",
            });
            expect(sends(primary) + sends(secondary)).toBe(0);
        });
        it("returns the hash when the fallback is on a wrong chain after an ambiguous attempt", async () => {
            primary.failures.eth_sendRawTransaction = { code: "TIMEOUT" };
            secondary.chainId = "0x38";
            await expect(broadcast(create())).resolves.toBe(HASH);
            expect(sends(secondary)).toBe(0);
        });
    });
    it("does not retry an unknown method", async () => {
        await expect(
            create().perform("unknownWrite", {})
        ).rejects.toMatchObject({
            code: "NOT_IMPLEMENTED",
        });
        expect(secondary.calls).toEqual([]);
    });
    it("works without a secondary but never hides its primary errors", async () => {
        const provider = new PrimaryRpcProvider(PRIMARY, undefined, {
            expectedChainId: 1,
        });
        expect((await provider.getGasPrice()).toNumber()).toBe(42);
        const error = { code: "TIMEOUT" };
        primary.failures.eth_gasPrice = error;
        await expect(provider.getGasPrice()).rejects.toBe(error);
        primary.down = true;
        await tick();
        await expect(provider.getNetwork()).rejects.toMatchObject({
            code: "SERVER_ERROR",
            status: 503,
        });
    });
    it("uses the configured chain, transport timeout and throttle limit", async () => {
        primary.chainId = "0x38";
        const connections: ethers.utils.ConnectionInfo[] = [];
        const send = (
            ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
        ).getMockImplementation()!;
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(function (
            this: ethers.providers.JsonRpcProvider,
            method,
            params
        ) {
            connections.push(this.connection);
            return send.call(this, method, params);
        });
        const provider = new PrimaryRpcProvider(PRIMARY, SECONDARY, {
            expectedChainId: 56,
            requestTimeoutMs: 123,
            cooldownMs: 0,
        });
        expect((await provider.getNetwork()).chainId).toBe(56);
        expect(connections[0]).toMatchObject({
            timeout: 123,
            throttleLimit: 1,
        });
        expect(secondary.calls).toEqual([]);
    });
    it("routes raw idempotent reads through the same cooldown as ethers reads", async () => {
        primary.failures.eth_getLogs = { code: "TIMEOUT" };
        const provider = create();
        await expect(provider.send("eth_getLogs", [{}])).resolves.toEqual([]);
        const primaryCalls = primary.calls.length;
        await tick();
        await expect(provider.send("eth_getLogs", [{}])).resolves.toEqual([]);
        expect(primary.calls).toHaveLength(primaryCalls);
        expect(
            secondary.calls.filter((method) => method === "eth_getLogs")
        ).toHaveLength(2);
    });
    it.each(["eth_sendTransaction", "custom_write"])(
        "never retries a raw write or unknown method: %s",
        async (method) => {
            const error = { code: "TIMEOUT" };
            primary.failures[method] = error;
            await expect(create().send(method, ["0x1234"])).rejects.toBe(error);
            expect(
                primary.calls.filter((entry) => entry === method)
            ).toHaveLength(1);
            expect(secondary.calls).toEqual([]);
        }
    );
    it.each(["eth_chainId", "net_version"])(
        "validates the raw %s response even if discovery just succeeded",
        async (method) => {
            let calls = 0;
            const transport = (
                ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
            ).getMockImplementation()!;
            (
                ethers.providers.JsonRpcProvider.prototype.send as jest.Mock
            ).mockImplementation(async function (
                this: ethers.providers.JsonRpcProvider,
                rpcMethod: string,
                params: any[]
            ) {
                if (
                    rpcMethod === method &&
                    ++calls === (method === "eth_chainId" ? 2 : 1)
                )
                    return method === "eth_chainId" ? "0x38" : "56";
                return transport.call(this, rpcMethod, params);
            });
            await expect(create().send(method, [])).rejects.toMatchObject({
                code: "NETWORK_ERROR",
                event: "changed",
            });
            expect(secondary.calls).toEqual([]);
        }
    );
    it.each(["eth_chainId", "net_version"])(
        "returns a raw matching %s response",
        async (method) => {
            await expect(create().send(method, [])).resolves.toBe(
                method === "eth_chainId" ? "0x1" : "1"
            );
            expect(secondary.calls).toEqual([]);
        }
    );

    it.each([
        { expectedChainId: 0 },
        { expectedChainId: -1 },
        { expectedChainId: 1.5 },
        { expectedChainId: NaN },
        { expectedChainId: 1, requestTimeoutMs: 0 },
        { expectedChainId: 1, requestTimeoutMs: Infinity },
        { expectedChainId: 1, cooldownMs: -1 },
        { expectedChainId: 1, cooldownMs: NaN },
        { expectedChainId: 1, chainCheckIntervalMs: -1 },
        { expectedChainId: 1, chainCheckIntervalMs: Infinity },
        { expectedChainId: 1, retryRounds: 0 },
        { expectedChainId: 1, retryRounds: 1.5 },
        { expectedChainId: 1, retryBaseDelayMs: -1 },
        { expectedChainId: 1, retryBaseDelayMs: NaN },
        { expectedChainId: 1, retryMaxDelayMs: Infinity },
        { expectedChainId: 1, retryBaseDelayMs: 10, retryMaxDelayMs: 5 },
    ])("rejects invalid options before any RPC: %j", (options) => {
        expect(
            () => new PrimaryRpcProvider(PRIMARY, SECONDARY, options)
        ).toThrow();
        expect(primary.calls).toEqual([]);
        expect(secondary.calls).toEqual([]);
    });
    describe("read retry rounds", () => {
        const make = (sleep: jest.Mock, retryRounds = 3) =>
            new PrimaryRpcProvider(PRIMARY, SECONDARY, {
                expectedChainId: 1,
                retryRounds,
                retryBaseDelayMs: 100,
                retryMaxDelayMs: 300,
                sleep,
            });
        it("backs off with capped, jittered delays until a round succeeds", async () => {
            jest.spyOn(Math, "random").mockReturnValue(1);
            let failures = 3;
            const sleep = jest.fn(async () => {
                if (--failures === 0) {
                    delete primary.failures.eth_gasPrice;
                    delete secondary.failures.eth_gasPrice;
                }
            });
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            secondary.failures.eth_gasPrice = { code: "TIMEOUT" };
            const provider = make(sleep, 4);
            await expect(provider.getGasPrice()).resolves.toEqual(
                ethers.BigNumber.from(42)
            );
            expect(sleep.mock.calls).toEqual([[100], [200], [300]]);
        });
        it("surfaces the last error once rounds are exhausted", async () => {
            const sleep = jest.fn().mockResolvedValue(undefined);
            const error = { code: "SERVER_ERROR", status: 503 };
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            secondary.failures.eth_gasPrice = error;
            await expect(make(sleep).getGasPrice()).rejects.toBe(error);
            expect(sleep).toHaveBeenCalledTimes(2);
        });
        it("never retries a deterministic read error", async () => {
            const sleep = jest.fn().mockResolvedValue(undefined);
            const error = { code: -32602, message: "invalid params" };
            primary.failures.eth_gasPrice = error;
            await expect(make(sleep).getGasPrice()).rejects.toBe(error);
            expect(sleep).not.toHaveBeenCalled();
        });
        it("leaves a pinned session's failure to the session owner", async () => {
            const sleep = jest.fn().mockResolvedValue(undefined);
            const provider = make(sleep);
            const release = await provider.beginReadSession();
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            await expect(provider.getGasPrice()).rejects.toMatchObject({
                code: "TIMEOUT",
            });
            expect(sleep).not.toHaveBeenCalled();
            release();
        });
        it("uses jittered real timers by default", async () => {
            jest.spyOn(Math, "random").mockReturnValue(0);
            primary.failures.eth_gasPrice = { code: "TIMEOUT" };
            secondary.failures.eth_gasPrice = { code: "TIMEOUT" };
            const provider = new PrimaryRpcProvider(PRIMARY, SECONDARY, {
                expectedChainId: 1,
                retryRounds: 2,
                retryBaseDelayMs: 2,
                retryMaxDelayMs: 2,
            });
            await expect(provider.getGasPrice()).rejects.toMatchObject({
                code: "TIMEOUT",
            });
        });
    });
    it("retries network discovery outside a session", async () => {
        const sleep = jest.fn(async () => {
            primary.down = false;
        });
        primary.down = true;
        const provider = new PrimaryRpcProvider(PRIMARY, undefined, {
            expectedChainId: 1,
            retryRounds: 2,
            sleep,
        });
        await expect(provider.getNetwork()).resolves.toMatchObject({
            chainId: 1,
        });
        expect(sleep).toHaveBeenCalledTimes(1);
    });
    it("offers a single failover round without backoff for self-polling callers", async () => {
        const sleep = jest.fn().mockResolvedValue(undefined);
        const provider = new PrimaryRpcProvider(PRIMARY, SECONDARY, {
            expectedChainId: 1,
            retryRounds: 5,
            sleep,
        });
        primary.failures.eth_getTransactionReceipt = { code: "TIMEOUT" };
        secondary.failures.eth_getTransactionReceipt = { code: "TIMEOUT" };
        await expect(
            provider.sendWithoutRetry("eth_getTransactionReceipt", ["0x1"])
        ).rejects.toMatchObject({ code: "TIMEOUT" });
        expect(sleep).not.toHaveBeenCalled();
        await expect(
            provider.sendWithoutRetry("eth_chainId", [])
        ).resolves.toBe("0x1");
        await expect(
            provider.sendWithoutRetry("eth_sendRawTransaction", ["0x1234"])
        ).resolves.toBe("0x2a");
        expect(provider.broadcastAttempts).toBe(1);
    });
    it("checks a healthy endpoint's chain once per interval, not per read", async () => {
        const provider = create(undefined, 1000);
        for (let i = 0; i < 5; i++) await provider.getGasPrice();
        const chainChecks = () =>
            primary.calls.filter((method) => method === "eth_chainId").length;
        expect(chainChecks()).toBe(1);
        expect(
            primary.calls.filter((method) => method === "eth_gasPrice")
        ).toHaveLength(5);
        now += 999;
        await tick();
        await provider.getGasPrice();
        expect(chainChecks()).toBe(1);
        now += 1;
        await tick();
        primary.chainId = "0x38";
        await expect(provider.getGasPrice()).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(secondary.calls).toEqual([]);
    });
    it("re-checks the fallback's chain after it also fails a read", async () => {
        const provider = create(0);
        await provider.getGasPrice();
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        secondary.failures.eth_gasPrice = { code: "TIMEOUT" };
        await expect(provider.getGasPrice()).rejects.toMatchObject({
            code: "TIMEOUT",
        });
        const secondaryChecks = () =>
            secondary.calls.filter((method) => method === "eth_chainId").length;
        const before = secondaryChecks();
        primary.down = true;
        delete secondary.failures.eth_gasPrice;
        await tick();
        await provider.getGasPrice();
        expect(secondaryChecks()).toBe(before + 1);
    });
    it("passes a fallback's deterministic error through without re-checking", async () => {
        const provider = create(0);
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        const error = { code: -32602, message: "invalid params" };
        secondary.failures.eth_gasPrice = error;
        await expect(provider.getGasPrice()).rejects.toBe(error);
    });
    it("re-checks an endpoint's chain after it fails a read", async () => {
        const provider = create(0);
        await provider.getGasPrice();
        primary.failures.eth_gasPrice = { code: "TIMEOUT" };
        await provider.getGasPrice();
        delete primary.failures.eth_gasPrice;
        primary.chainId = "0x38";
        await tick();
        await expect(provider.getGasPrice()).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
    });
    it.each([
        ["", SECONDARY],
        [PRIMARY, ""],
    ])("rejects empty URLs", (main, backup) => {
        expect(
            () => new PrimaryRpcProvider(main, backup, { expectedChainId: 1 })
        ).toThrow("RPC URLs must not be empty");
    });
});

describe("primary RPC transient classification", () => {
    it.each([
        { code: "ECONNREFUSED" },
        { code: "ECONNRESET" },
        { code: "ETIMEDOUT" },
        { code: "ENOTFOUND" },
        { code: "EAI_AGAIN" },
        { code: "SERVER_ERROR" },
        { code: "NETWORK_ERROR", event: "noNetwork" },
        { code: "TIMEOUT" },
        { code: -32603 },
        { code: "-32603" },
        { status: 500 },
        { status: 402 },
        { status: 429 },
        { serverError: { code: "ECONNRESET" } },
        { code: -32005, message: "rate limit exceeded" },
        { code: -32005, message: "limit exceeded" },
        {
            code: -32005,
            message:
                "You have reached the maximum API usage limit. If you need higher throughput, please check out https://meganode.nodereal.io/",
        },
    ])("recognizes a transient failure: %j", (error) =>
        expect(isPrimaryRpcTransientError(error)).toBe(true)
    );
    it.each([
        null,
        undefined,
        "timeout",
        {},
        { code: "UNKNOWN_ERROR" },
        { code: "NETWORK_ERROR", event: "changed" },
        { code: "NETWORK_ERROR", event: "invalidNetwork" },
        { status: 401 },
        { status: 403 },
        { code: -32602 },
        { code: -32005 },
        { code: -32005, message: "block range too wide" },
        { code: -32005, message: "request limit exceeded for block range" },
        { code: -32005, message: "rate limit exceeded: too many logs" },
        { code: -32005, message: "response size limit exceeded" },
        { code: -32603, message: "execution reverted: not allowed" },
        { code: "CALL_EXCEPTION" },
        {
            code: "CALL_EXCEPTION",
            reason: "execution reverted",
            data: "0x",
            error: { code: "TIMEOUT" },
        },
        {
            code: "CALL_EXCEPTION",
            reason: "missing revert data in call exception; Transaction reverted without a reason string",
            data: "0x1234",
            error: { code: "TIMEOUT" },
        },
        {
            code: "CALL_EXCEPTION",
            reason: "missing revert data in call exception; Transaction reverted without a reason string",
            data: "0x",
            error: { code: -32603, message: "execution reverted" },
        },
        {
            code: "SERVER_ERROR",
            status: 503,
            error: { code: -32603, message: "execution reverted" },
        },
        { code: -32603, reason: "execution reverted" },
        {
            code: -32603,
            message: "VM Exception while processing transaction: revert",
        },
        { error: { code: -32602 }, code: "SERVER_ERROR", status: 500 },
    ])("preserves deterministic or unrecognized errors: %j", (error) =>
        expect(isPrimaryRpcTransientError(error)).toBe(false)
    );
});

describe("broadcast error classification", () => {
    it.each([
        [{ message: "already known" }, true],
        [{ message: "Known transaction: 0xabc" }, true],
        [{ message: "transaction already imported" }, true],
        [{ code: "SERVER_ERROR", error: { message: "already exists" } }, true],
        [{ code: "NONCE_EXPIRED" }, false],
        [null, false],
        ["already known", false],
    ])("already known: %j -> %s", (error, expected) => {
        expect(isAlreadyKnownError(error)).toBe(expected);
    });
    it.each([
        [{ code: "NONCE_EXPIRED" }, true],
        [{ code: "REPLACEMENT_UNDERPRICED" }, true],
        [{ code: "INSUFFICIENT_FUNDS" }, true],
        [{ code: -32602 }, true],
        [{ code: "-32602" }, true],
        [{ code: "SERVER_ERROR", error: { code: -32601 } }, true],
        [{ message: "intrinsic gas too low" }, true],
        [{ message: "max fee per gas less than block base fee" }, true],
        [{ code: -32000, message: "upstream error" }, false],
        [{ code: "TIMEOUT" }, false],
        [null, false],
        ["nonce too low", false],
    ])("definitive: %j -> %s", (error, expected) => {
        expect(isDefinitiveRejection(error)).toBe(expected);
    });
    it.each([
        [{ broadcastRejected: true }, true],
        [{ broadcastRejected: "yes" }, false],
        [{}, false],
        [null, false],
    ])("tagged rejection: %j -> %s", (error, expected) => {
        expect(isBroadcastRejection(error)).toBe(expected);
    });
});
