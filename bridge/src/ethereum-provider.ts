import {
    PrimaryRpcProvider,
    PrimaryRpcProviderOptions,
} from "./primary-rpc-provider";

/** NodeReal first, Infura on transient read failures; no broadcast retries. */
export async function createEthereumFallbackProvider(
    mainUrl: string,
    subUrl: string | undefined,
    options: Partial<PrimaryRpcProviderOptions> = {}
): Promise<PrimaryRpcProvider> {
    const provider = new PrimaryRpcProvider(mainUrl, subUrl, {
        ...options,
        expectedChainId: options.expectedChainId ?? 1,
    });
    await provider.getNetwork();
    return provider;
}
