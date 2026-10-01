import { ethers } from "ethers";
import {
    PrimaryRpcProvider,
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
    const create = (cooldownMs?: number) =>
        new PrimaryRpcProvider(PRIMARY, SECONDARY, {
            expectedChainId: 1,
            cooldownMs,
        });

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
    it("does not retry an ambiguously submitted transaction", async () => {
        const error = { code: "TIMEOUT" };
        primary.failures.eth_sendRawTransaction = error;
        await expect(
            create().perform("sendTransaction", { signedTransaction: "0x1234" })
        ).rejects.toBe(error);
        expect(
            primary.calls.filter(
                (method) => method === "eth_sendRawTransaction"
            )
        ).toHaveLength(1);
        expect(secondary.calls).toEqual([]);
    });
    it("does not retry an unknown method", async () => {
        await expect(
            create().perform("unknownWrite", {})
        ).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
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
    it.each(["eth_sendRawTransaction", "eth_sendTransaction", "custom_write"])(
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
    ])("rejects invalid options before any RPC: %j", (options) => {
        expect(
            () => new PrimaryRpcProvider(PRIMARY, SECONDARY, options)
        ).toThrow();
        expect(primary.calls).toEqual([]);
        expect(secondary.calls).toEqual([]);
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
        { error: { code: -32602 }, code: "SERVER_ERROR", status: 500 },
    ])("preserves deterministic or unrecognized errors: %j", (error) =>
        expect(isPrimaryRpcTransientError(error)).toBe(false)
    );
});
