import { ethers } from "ethers";

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
        error?: unknown;
        serverError?: unknown;
    };
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
    return (
        Number(err.code) === -32005 &&
        !/block.*range|range.*block|too many (results|logs)|query returned more than|response.*size/i.test(
            err.message ?? ""
        ) &&
        /rate|quota|requests per|request limit/i.test(err.message ?? "")
    );
}

export interface PrimaryRpcProviderOptions {
    expectedChainId: number;
    requestTimeoutMs?: number;
    cooldownMs?: number;
}

/** Sequential failover: a healthy primary never causes secondary RPC traffic. */
export class PrimaryRpcProvider extends ethers.providers.BaseProvider {
    private readonly primary: ethers.providers.JsonRpcProvider;
    private readonly secondary: ethers.providers.JsonRpcProvider | undefined;
    private readonly cooldownMs: number;
    private primaryUnavailableUntil = 0;
    private primaryProbe: Promise<ethers.providers.JsonRpcProvider> | undefined;

    constructor(
        primaryUrl: string,
        secondaryUrl: string | undefined,
        options: PrimaryRpcProviderOptions
    ) {
        const {
            expectedChainId,
            requestTimeoutMs = 10000,
            cooldownMs = 30000,
        } = options;
        if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0)
            throw new Error("expectedChainId must be a positive safe integer");
        if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)
            throw new Error("requestTimeoutMs must be positive and finite");
        if (!Number.isFinite(cooldownMs) || cooldownMs < 0)
            throw new Error("cooldownMs must be nonnegative and finite");
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
    }

    private async validate(
        provider: ethers.providers.JsonRpcProvider
    ): Promise<ethers.providers.JsonRpcProvider> {
        // Preserve deterministic probe errors: JsonRpcProvider.getNetwork()
        // otherwise turns these into NETWORK_ERROR/noNetwork.
        this.assertChainId(await provider.send("eth_chainId", []));
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

    async detectNetwork(): Promise<ethers.providers.Network> {
        const provider = await this.selectProvider();
        return provider.network;
    }

    private async dispatch<T>(
        operation: (provider: ethers.providers.JsonRpcProvider) => Promise<T>,
        retryable: boolean
    ): Promise<T> {
        const provider = await this.selectProvider();
        try {
            return await operation(provider);
        } catch (error) {
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
            const secondary = await this.validate(this.secondary);
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
