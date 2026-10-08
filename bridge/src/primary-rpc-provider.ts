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
    /**
     * Rounds for idempotent reads outside a pinned session and for re-sending
     * a signed transaction. Each round tries the preferred endpoint, then the
     * other one. 1 (the default) disables backoff retries.
     */
    retryRounds?: number;
    retryBaseDelayMs?: number;
    retryMaxDelayMs?: number;
    /** Test hook for backoff waits. */
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A node already holding (or having mined) this exact signed transaction.
 * ethers maps "nonce too low" to NONCE_EXPIRED and "replacement transaction
 * underpriced" to REPLACEMENT_UNDERPRICED; "already known" stays a raw message.
 */
export function isAlreadySubmittedError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const err = error as { code?: unknown; message?: unknown; error?: unknown };
    if (
        err.code === ethers.errors.NONCE_EXPIRED ||
        err.code === ethers.errors.REPLACEMENT_UNDERPRICED
    )
        return true;
    if (
        typeof err.message === "string" &&
        /already known|known transaction|already imported|already exists|nonce (is )?too low/i.test(
            err.message
        )
    )
        return true;
    return err.error !== undefined && isAlreadySubmittedError(err.error);
}

/** Sequential failover: a healthy primary never causes secondary RPC traffic. */
export class PrimaryRpcProvider extends ethers.providers.BaseProvider {
    private readonly primary: ethers.providers.JsonRpcProvider;
    private readonly secondary: ethers.providers.JsonRpcProvider | undefined;
    private readonly cooldownMs: number;
    private readonly chainCheckIntervalMs: number;
    private readonly retryRounds: number;
    private readonly retryBaseDelayMs: number;
    private readonly retryMaxDelayMs: number;
    private readonly sleep: (ms: number) => Promise<void>;
    private broadcasts = 0;
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

    /** Signed transactions handed to the network; lets a caller tell "nothing
     * was sent" (safe to re-sign) from "sent, outcome pending" (never re-sign). */
    public get broadcastAttempts(): number {
        return this.broadcasts;
    }

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
            retryRounds = 1,
            retryBaseDelayMs = 1000,
            retryMaxDelayMs = 30000,
            sleep = defaultSleep,
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
        if (!Number.isSafeInteger(retryRounds) || retryRounds < 1)
            throw new Error("retryRounds must be a positive integer");
        if (
            !Number.isFinite(retryBaseDelayMs) ||
            retryBaseDelayMs < 0 ||
            !Number.isFinite(retryMaxDelayMs) ||
            retryMaxDelayMs < retryBaseDelayMs
        )
            throw new Error("retry delays must be finite and ordered");
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
        this.retryRounds = retryRounds;
        this.retryBaseDelayMs = retryBaseDelayMs;
        this.retryMaxDelayMs = retryMaxDelayMs;
        this.sleep = sleep;
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

    /** Exponential backoff with jitter, so retries do not deepen a quota outage. */
    private backoff(round: number): Promise<void> {
        const ceiling = Math.min(
            this.retryMaxDelayMs,
            this.retryBaseDelayMs * 2 ** (round - 1)
        );
        return this.sleep(ceiling / 2 + (Math.random() * ceiling) / 2);
    }

    private async dispatch<T>(
        operation: (provider: ethers.providers.JsonRpcProvider) => Promise<T>,
        retryable: boolean
    ): Promise<T> {
        for (let round = 1; ; round++) {
            try {
                return await this.dispatchOnce(operation, retryable);
            } catch (error) {
                // A pinned session restarts from its own anchor instead.
                if (
                    !retryable ||
                    this.readSession ||
                    round >= this.retryRounds ||
                    !isPrimaryRpcTransientError(error)
                )
                    throw error;
                await this.backoff(round);
            }
        }
    }

    private async dispatchOnce<T>(
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
            // Unknown (possibly state-changing) methods fail closed.
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

    /**
     * Re-sending identical signed bytes cannot pay twice: they carry one hash
     * and one nonce. A clean first rejection means nothing was accepted. After
     * any ambiguous attempt, the hash is returned and the receipt wait decides
     * between mined, replaced and unconfirmed. Ignores read-session pins.
     */
    private async broadcast(signedTransaction: string): Promise<string> {
        const hash = ethers.utils.keccak256(signedTransaction);
        this.broadcasts += 1;
        let ambiguous = false;
        for (let round = 1; ; round++) {
            const coolingDown =
                this.secondary !== undefined &&
                Date.now() < this.primaryUnavailableUntil;
            const targets = (
                coolingDown
                    ? [this.secondary, this.primary]
                    : [this.primary, this.secondary]
            ).filter(
                (target): target is ethers.providers.JsonRpcProvider =>
                    target !== undefined
            );
            for (const target of targets) {
                try {
                    await this.validate(target);
                } catch (error) {
                    if (!isPrimaryRpcTransientError(error)) {
                        if (ambiguous) return hash;
                        throw error;
                    }
                    continue;
                }
                this.recordDispatch(target);
                try {
                    return await target.perform("sendTransaction", {
                        signedTransaction,
                    });
                } catch (error) {
                    if (isAlreadySubmittedError(error)) {
                        if (ambiguous) return hash;
                        throw error;
                    }
                    if (!isPrimaryRpcTransientError(error)) {
                        if (ambiguous) return hash;
                        throw error;
                    }
                    ambiguous = true;
                    this.chainCheckedUntil.delete(target);
                    if (target === this.primary && this.secondary)
                        this.primaryUnavailableUntil =
                            Date.now() + this.cooldownMs;
                }
            }
            if (round >= this.retryRounds) {
                if (ambiguous) return hash;
                throw Object.assign(
                    new Error("No RPC endpoint accepted the transaction"),
                    { code: ethers.errors.SERVER_ERROR, transactionHash: hash }
                );
            }
            await this.backoff(round);
        }
    }

    async perform(method: string, params: any): Promise<any> {
        if (method === "sendTransaction")
            return this.broadcast(params.signedTransaction);
        return this.dispatch(
            (provider) => provider.perform(method, params),
            READ_METHODS.has(method)
        );
    }

    async send(method: string, params: any[]): Promise<any> {
        if (method === "eth_sendRawTransaction")
            return this.broadcast(params[0]);
        return this.dispatch(async (provider) => {
            const result = await provider.send(method, params);
            if (method === "eth_chainId" || method === "net_version") {
                this.assertChainId(result);
            }
            return result;
        }, RAW_READ_METHODS.has(method));
    }
}
