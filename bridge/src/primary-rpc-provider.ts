import { ethers } from "ethers";
import { isRpcQuotaExceededError } from "./rpc-retry";

const READ_METHODS = new Set([
    "getBlockNumber",
    "getGasPrice",
    "getBalance",
    "getTransactionCount",
    "getCode",
    "getStorageAt",
    "getBlock",
    "getTransaction",
    "getTransactionReceipt",
    "call",
    "estimateGas",
    "getLogs",
]);

const RAW_READ_METHODS = new Set([
    "eth_chainId",
    "net_version",
    "eth_blockNumber",
    "eth_gasPrice",
    "eth_maxPriorityFeePerGas",
    "eth_feeHistory",
    "eth_getBalance",
    "eth_getTransactionCount",
    "eth_getCode",
    "eth_getStorageAt",
    "eth_getBlockByHash",
    "eth_getBlockByNumber",
    "eth_getTransactionByHash",
    "eth_getTransactionReceipt",
    "eth_getLogs",
    "eth_call",
    "eth_estimateGas",
]);

/** Only outages and exhausted request quotas warrant another endpoint. */
export function isPrimaryRpcTransientError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const err = error as {
        code?: unknown;
        event?: unknown;
        status?: number;
        message?: string;
        reason?: string;
        data?: unknown;
        error?: unknown;
        serverError?: unknown;
    };
    if (err.code === "CALL_EXCEPTION") {
        // ethers v5 also wraps transport failures from eth_call in this synthetic
        // exception. Its nested cause still distinguishes outages from real reverts.
        if (
            err.reason ===
                "missing revert data in call exception; Transaction reverted without a reason string" &&
            err.data === "0x" &&
            err.error !== undefined
        )
            return isPrimaryRpcTransientError(err.error);
        return false;
    }
    // Some nodes use the generic internal-error code (-32603) for a revert.
    // Preserve execution failures even when an HTTP/server wrapper looks transient.
    if (
        /\bexecution revert(?:ed)?\b|\bVM Exception while processing transaction: revert\b/i.test(
            `${err.message ?? ""} ${err.reason ?? ""}`
        )
    )
        return false;
    if (err.error !== undefined) return isPrimaryRpcTransientError(err.error);
    if (err.status !== undefined) {
        return err.status === 402 || err.status === 429 || err.status >= 500;
    }
    if (err.serverError !== undefined)
        return isPrimaryRpcTransientError(err.serverError);
    if (err.code === "NETWORK_ERROR") {
        return err.event !== "changed" && err.event !== "invalidNetwork";
    }
    if (
        [
            "TIMEOUT",
            "SERVER_ERROR",
            "ECONNREFUSED",
            "ECONNRESET",
            "ETIMEDOUT",
            "ENOTFOUND",
            "EAI_AGAIN",
        ].includes(String(err.code))
    )
        return true;
    if (Number(err.code) === -32603) return true;
    return isRpcQuotaExceededError(err.code, err.message);
}

export interface PrimaryRpcProviderOptions {
    expectedChainId: number;
    requestTimeoutMs?: number;
    cooldownMs?: number;
    /** How long a successful eth_chainId check vouches for an endpoint. */
    chainCheckIntervalMs?: number;
}

/** Sequential failover: a healthy primary never causes secondary RPC traffic. */
export class PrimaryRpcProvider extends ethers.providers.BaseProvider {
    private readonly primary: ethers.providers.JsonRpcProvider;
    private readonly secondary: ethers.providers.JsonRpcProvider | undefined;
    private readonly cooldownMs: number;
    private readonly chainCheckIntervalMs: number;
    private readonly chainCheckedUntil = new Map<
        ethers.providers.JsonRpcProvider,
        number
    >();
    private primaryUnavailableUntil = 0;
    private lastDispatchProvider: ethers.providers.JsonRpcProvider | undefined;
    private endpointEpoch = 0;
    private readSession:
        | { provider: ethers.providers.JsonRpcProvider; users: number }
        | undefined;
    private readSessionProbe:
        | Promise<{
              provider: ethers.providers.JsonRpcProvider;
              users: number;
          }>
        | undefined;

    /** Monotonic endpoint changes for dispatched operations, excluding probes. */
    public get readEpoch(): number {
        return this.endpointEpoch;
    }
    private primaryProbe: Promise<ethers.providers.JsonRpcProvider> | undefined;

    constructor(
        private readonly primaryUrl: string,
        private readonly secondaryUrl: string | undefined,
        private readonly options: PrimaryRpcProviderOptions
    ) {
        const {
            expectedChainId,
            requestTimeoutMs = 10000,
            cooldownMs = 30000,
            chainCheckIntervalMs = 60000,
        } = options;
        if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0)
            throw new Error("expectedChainId must be a positive safe integer");
        if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)
            throw new Error("requestTimeoutMs must be positive and finite");
        if (!Number.isFinite(cooldownMs) || cooldownMs < 0)
            throw new Error("cooldownMs must be nonnegative and finite");
        if (!Number.isFinite(chainCheckIntervalMs) || chainCheckIntervalMs < 0)
            throw new Error(
                "chainCheckIntervalMs must be nonnegative and finite"
            );
        if (
            !primaryUrl.trim() ||
            (secondaryUrl !== undefined && !secondaryUrl.trim())
        )
            throw new Error("RPC URLs must not be empty");
        super(expectedChainId);
        const connect = (url: string) =>
            new ethers.providers.JsonRpcProvider(
                { url, timeout: requestTimeoutMs, throttleLimit: 1 },
                expectedChainId
            );
        this.primary = connect(primaryUrl);
        this.secondary =
            secondaryUrl === undefined ? undefined : connect(secondaryUrl);
        this.cooldownMs = cooldownMs;
        this.chainCheckIntervalMs = chainCheckIntervalMs;
    }

    /** Independent routing/session state for a monitor sharing a signer provider. */
    public createReadProvider(): PrimaryRpcProvider {
        return new PrimaryRpcProvider(
            this.primaryUrl,
            this.secondaryUrl,
            this.options
        );
    }

    private async validate(
        provider: ethers.providers.JsonRpcProvider
    ): Promise<ethers.providers.JsonRpcProvider> {
        // getNetwork() and dispatch() both select an endpoint for every read, so
        // re-check the chain only after an interval or an endpoint failure.
        if (Date.now() < (this.chainCheckedUntil.get(provider) ?? 0))
            return provider;
        // Preserve deterministic probe errors: JsonRpcProvider.getNetwork()
        // otherwise turns these into NETWORK_ERROR/noNetwork.
        this.assertChainId(await provider.send("eth_chainId", []));
        this.chainCheckedUntil.set(
            provider,
            Date.now() + this.chainCheckIntervalMs
        );
        return provider;
    }

    private assertChainId(chainId: ethers.BigNumberish): void {
        if (
            ethers.BigNumber.from(chainId).toNumber() !== this.network.chainId
        ) {
            throw Object.assign(
                new Error("RPC returned an unexpected chain ID"),
                {
                    code: "NETWORK_ERROR",
                    event: "changed",
                }
            );
        }
    }

    private async probePrimary(): Promise<ethers.providers.JsonRpcProvider> {
        try {
            return await this.validate(this.primary);
        } catch (error) {
            if (!this.secondary || !isPrimaryRpcTransientError(error))
                throw error;
            this.primaryUnavailableUntil = Date.now() + this.cooldownMs;
            return this.validate(this.secondary);
        }
    }

    private async selectProvider(): Promise<ethers.providers.JsonRpcProvider> {
        if (this.readSession) {
            const provider = this.readSession.provider;
            try {
                return await this.validate(provider);
            } catch (error) {
                if (
                    provider === this.primary &&
                    this.secondary &&
                    isPrimaryRpcTransientError(error)
                )
                    this.primaryUnavailableUntil = Date.now() + this.cooldownMs;
                throw error;
            }
        }
        if (this.secondary && Date.now() < this.primaryUnavailableUntil)
            return this.validate(this.secondary);
        if (this.primaryProbe) return this.primaryProbe;
        this.primaryProbe = this.probePrimary();
        try {
            return await this.primaryProbe;
        } finally {
            this.primaryProbe = undefined;
        }
    }

    /** Pin related reads until every overlapping session has been released. */
    public async beginReadSession(): Promise<() => void> {
        let session = this.readSession;
        if (!session) {
            if (!this.readSessionProbe) {
                this.readSessionProbe = this.selectProvider().then(
                    (provider) => {
                        const selected = { provider, users: 0 };
                        this.readSession = selected;
                        return selected;
                    }
                );
            }
            const pending = this.readSessionProbe;
            try {
                session = await pending;
            } finally {
                if (this.readSessionProbe === pending)
                    this.readSessionProbe = undefined;
            }
        }
        session.users += 1;
        const selected = session;
        let released = false;
        return () => {
            if (released) return;
            released = true;
            selected.users -= 1;
            if (selected.users === 0 && this.readSession === selected)
                this.readSession = undefined;
        };
    }

    public async getBlockNumber(): Promise<number> {
        // BaseProvider keeps a monotonic maximum across reads. A fallback may lag,
        // so confirmation checks need the currently selected endpoint's real tip.
        return this.formatter.number(await this.perform("getBlockNumber", {}));
    }

    async detectNetwork(): Promise<ethers.providers.Network> {
        const provider = await this.selectProvider();
        return provider.network;
    }

    private recordDispatch(provider: ethers.providers.JsonRpcProvider): void {
        if (this.lastDispatchProvider && this.lastDispatchProvider !== provider)
            this.endpointEpoch += 1;
        this.lastDispatchProvider = provider;
    }

    private async dispatch<T>(
        operation: (provider: ethers.providers.JsonRpcProvider) => Promise<T>,
        retryable: boolean
    ): Promise<T> {
        const provider = await this.selectProvider();
        // Record before each operation, not its completion: concurrent requests and
        // A -> B -> A recovery must retain every intervening endpoint transition.
        this.recordDispatch(provider);
        try {
            return await operation(provider);
        } catch (error) {
            // A failing endpoint may come back on another chain or node.
            if (isPrimaryRpcTransientError(error))
                this.chainCheckedUntil.delete(provider);
            // Sending a signed transaction is never repeated: a timeout can
            // mean it was accepted. Unknown methods also fail closed.
            if (
                provider !== this.primary ||
                !this.secondary ||
                !retryable ||
                !isPrimaryRpcTransientError(error)
            )
                throw error;
            this.primaryUnavailableUntil = Date.now() + this.cooldownMs;
            // A session must restart from its anchor after failure; crossing endpoints
            // here could mix branches or continually invalidate a long-running range.
            if (this.readSession) throw error;
            const secondary = await this.validate(this.secondary);
            this.recordDispatch(secondary);
            return operation(secondary);
        }
    }

    async perform(method: string, params: any): Promise<any> {
        return this.dispatch(
            (provider) => provider.perform(method, params),
            READ_METHODS.has(method)
        );
    }

    async send(method: string, params: any[]): Promise<any> {
        return this.dispatch(async (provider) => {
            const result = await provider.send(method, params);
            if (method === "eth_chainId" || method === "net_version") {
                this.assertChainId(result);
            }
            return result;
        }, RAW_READ_METHODS.has(method));
    }
}
