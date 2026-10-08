import {
    PrimaryRpcProvider,
    PrimaryRpcProviderOptions,
} from "./primary-rpc-provider";

/**
 * NodeReal first, Infura on transient failures. Idempotent reads and re-sends
 * of an already-signed transaction back off across both endpoints for about
 * a minute (1, 2, 4, 8, 16, 30s ceilings) before surfacing an outage.
 */
export async function createEthereumFallbackProvider(
    mainUrl: string,
    subUrl: string | undefined,
    options: Partial<PrimaryRpcProviderOptions> = {}
): Promise<PrimaryRpcProvider> {
    const provider = new PrimaryRpcProvider(mainUrl, subUrl, {
        retryRounds: 7,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 30000,
        ...options,
        expectedChainId: options.expectedChainId ?? 1,
    });
    await provider.getNetwork();
    await provider.checkSecondary();
    return provider;
}
