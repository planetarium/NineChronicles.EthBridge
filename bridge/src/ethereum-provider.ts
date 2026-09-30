import { ethers } from "ethers";
import { isRetryableEthereumError } from "./rpc-retry";

/** Keep network validation, but do not require an unavailable RPC to agree. */
export class ResilientFallbackProvider extends ethers.providers
    .FallbackProvider {
    async detectNetwork(): Promise<ethers.providers.Network> {
        const results = await Promise.allSettled(
            this.providerConfigs.map(({ provider }) => provider.getNetwork())
        );
        let network: ethers.providers.Network | undefined;
        for (const result of results) {
            if (result.status === "rejected") {
                if (!isRetryableEthereumError(result.reason))
                    throw result.reason;
                continue;
            }
            if (
                network &&
                (network.chainId !== result.value.chainId ||
                    network.name !== result.value.name ||
                    network.ensAddress !== result.value.ensAddress)
            ) {
                throw new ChainIdMismatchError(
                    network.chainId,
                    result.value.chainId
                );
            }
            network = result.value;
        }
        if (!network) {
            const failure = results.find(
                (result) => result.status === "rejected"
            ) as PromiseRejectedResult;
            throw failure.reason;
        }
        return network;
    }
}

export class ChainIdMismatchError extends Error {
    constructor(mainChainId: number, subChainId: number) {
        super(
            `Ethereum RPC endpoints disagree on their network: ${mainChainId} vs ${subChainId}`
        );
        this.name = "ChainIdMismatchError";
    }
}

export interface CreateEthereumFallbackProviderOptions {
    quorum?: number;
    expectedChainId?: number;
    subProviderProbeTimeoutMs?: number;
}

export async function createEthereumFallbackProvider(
    mainUrl: string,
    subUrl: string,
    options: CreateEthereumFallbackProviderOptions = {}
): Promise<ethers.providers.FallbackProvider> {
    const expectedChainId = options.expectedChainId ?? 1;
    if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
        throw new Error("expectedChainId must be a positive safe integer");
    }
    // Bound individual discovery and ordinary requests, including the transport's own
    // throttling, so an unavailable endpoint cannot hold failover indefinitely.
    const connect = (url: string) =>
        new ethers.providers.JsonRpcProvider(
            {
                url,
                timeout: options.subProviderProbeTimeoutMs ?? 10000,
                throttleLimit: 1,
            },
            expectedChainId
        );
    const provider = new ResilientFallbackProvider(
        [
            { provider: connect(mainUrl), priority: 1, weight: 1 },
            { provider: connect(subUrl), priority: 2, weight: 1 },
        ],
        options.quorum ?? 1
    );
    await provider.getNetwork();
    return provider;
}
