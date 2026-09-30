import { ethers } from "ethers";

// How long to wait for the sub provider to answer a one-off chain-ID probe
// before treating it as unreachable. This bounds startup time when the sub
// provider is completely down, rather than hanging on a connection that will
// never resolve or reject on its own.
const DEFAULT_SUB_PROVIDER_PROBE_TIMEOUT_MS = 5000;

/**
 * Thrown only when the sub provider actually responded and reported a
 * different chain ID than the main provider - i.e. a genuine
 * misconfiguration that must never be silently ignored. A sub provider that
 * is merely unreachable does NOT throw this; see
 * `createEthereumFallbackProvider`.
 */
export class ChainIdMismatchError extends Error {
    constructor(mainChainId: number, subChainId: number) {
        super(
            `KMS_PROVIDER_SUB_URL is on chain ID ${subChainId}, but the main ` +
                `provider (KMS_PROVIDER_URL) is on chain ID ${mainChainId}. ` +
                "Refusing to combine RPC providers from different chains."
        );
        this.name = "ChainIdMismatchError";
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timed out after ${ms}ms`));
        }, ms);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

export interface CreateEthereumFallbackProviderOptions {
    // FallbackProvider quorum: how many providers must agree on a normal
    // call's result. Defaults to 1, so a single healthy provider (main OR
    // sub) is enough - this is the whole point of having a fallback.
    quorum?: number;
    // How long to wait for the sub provider's one-off chain-ID probe before
    // treating it as unreachable (see `DEFAULT_SUB_PROVIDER_PROBE_TIMEOUT_MS`).
    subProviderProbeTimeoutMs?: number;
}

/**
 * Builds an `ethers.providers.FallbackProvider` combining a main and a sub
 * JSON-RPC endpoint, in a way that tolerates the sub endpoint being
 * completely unreachable - which a naive `FallbackProvider` construction
 * does NOT: ethers v5's `FallbackProvider.detectNetwork()` awaits every
 * underlying provider's `getNetwork()`, independently of `quorum` (which
 * only governs ordinary calls). If the sub provider was constructed without
 * an explicit `network`, resolving its network requires a live RPC round
 * trip; if that provider is down, the whole `FallbackProvider` can fail (or
 * hang) on its very first call, even though the main provider is healthy -
 * defeating the entire point of adding a fallback.
 *
 * Worse, this isn't just a construction-time problem: ethers v5's
 * `getNetwork()` - called internally by most high-level provider methods
 * (`getBlockNumber()`, `getBlock()`, `getLogs()`, `getTransaction()`, ...) -
 * ALWAYS re-verifies the network with a fresh `detectNetwork()` call, even
 * for a provider given an explicit static `network` at construction. So
 * even after construction succeeds, every later real RPC call made through
 * the combined provider would still silently require a live round trip to
 * the sub provider merely to re-confirm its network - reintroducing the
 * exact single point of failure this function exists to remove.
 *
 * The fix: determine the expected chain ID from the main provider (which is
 * required to be reachable) with a single, raw `eth_chainId` call - not
 * `getNetwork()`, which would itself trigger ethers' own network
 * auto-detection machinery - then construct BOTH providers pinned to that
 * network, with `detectNetwork()` itself overridden to resolve it locally
 * (see `createPinnedNetworkProvider`). That removes the live network
 * round trip both at construction and on every later call.
 *
 * This does NOT silently ignore a genuine chain-ID mismatch: whenever the sub
 * provider IS reachable, its actual chain ID is checked ONCE, here, against
 * the main provider's, and a real mismatch throws `ChainIdMismatchError`.
 * Only a sub provider that can't be reached at all (or times out) within
 * `subProviderProbeTimeoutMs` skips that confirmation - there is no live
 * round trip to confirm it either way in that case, so it's assumed to match.
 */
// A throwaway, unused static network passed to probe-only provider
// instances below, purely so their constructor never kicks off ethers' own
// background network auto-detection (which would make an extra RPC round
// trip we don't want, and - being a fire-and-forget internal promise chain -
// could itself produce a stray unhandled rejection if the endpoint turns out
// to be unreachable). These probes only ever use the raw `send()` call.
const UNUSED_PLACEHOLDER_NETWORK = 1;

async function probeChainId(url: string, timeoutMs: number): Promise<number> {
    const probeProvider = new ethers.providers.JsonRpcProvider(
        url,
        UNUSED_PLACEHOLDER_NETWORK
    );
    const chainIdHex: string = await withTimeout(
        probeProvider.send("eth_chainId", []),
        timeoutMs
    );
    return ethers.BigNumber.from(chainIdHex).toNumber();
}

/**
 * Constructs a `JsonRpcProvider` pinned to `network`, with its
 * `detectNetwork()` overridden to just resolve that same, already-confirmed
 * network instead of making a live RPC call.
 *
 * This matters beyond construction: ethers v5's `getNetwork()` - called
 * internally by most high-level provider methods, including
 * `getBlockNumber()`, `getBlock()`, `getLogs()` and `getTransaction()` -
 * ALWAYS re-verifies the network with a fresh `detectNetwork()` call, even
 * when the provider already has a statically-known network. Left as-is,
 * that means every single one of those calls on the combined
 * `FallbackProvider` would still need a live round trip to the sub
 * provider to succeed, even though its network was already pinned at
 * construction - silently reintroducing the exact single-point-of-failure
 * this function exists to remove. Overriding `detectNetwork()` on both
 * providers this way means neither one is ever hit with a live call purely
 * to re-confirm a network that was already explicitly confirmed once (see
 * `createEthereumFallbackProvider`); the trade-off is that a provider's
 * chain silently changing later (an operator pointing the same URL at a
 * different chain, without restarting the bridge) would no longer be
 * detected - an extremely unlikely operational scenario for a bridge whose
 * RPC endpoints are static ops-managed configuration.
 */
function createPinnedNetworkProvider(
    url: string,
    network: ethers.providers.Network
): ethers.providers.JsonRpcProvider {
    const provider = new ethers.providers.JsonRpcProvider(url, network);
    provider.detectNetwork = async () => network;
    return provider;
}

export async function createEthereumFallbackProvider(
    mainProviderUrl: string,
    subProviderUrl: string,
    options: CreateEthereumFallbackProviderOptions = {}
): Promise<ethers.providers.FallbackProvider> {
    const {
        quorum = 1,
        subProviderProbeTimeoutMs = DEFAULT_SUB_PROVIDER_PROBE_TIMEOUT_MS,
    } = options;

    // One live round trip against the main provider, which is required to
    // be reachable, determines the network the whole FallbackProvider uses.
    const mainChainId = await probeChainId(
        mainProviderUrl,
        subProviderProbeTimeoutMs
    );
    const network = ethers.providers.getNetwork(mainChainId);

    try {
        const subChainId = await probeChainId(
            subProviderUrl,
            subProviderProbeTimeoutMs
        );
        if (subChainId !== mainChainId) {
            throw new ChainIdMismatchError(mainChainId, subChainId);
        }
    } catch (error) {
        if (error instanceof ChainIdMismatchError) {
            // A confirmed mismatch must never be silently ignored, even
            // though everything else here exists to tolerate the sub
            // provider being unreachable.
            throw error;
        }

        console.error(
            "Could not confirm the sub Ethereum RPC provider's chain ID - " +
                "it may simply be unreachable right now. Assuming it matches " +
                "the main provider's network; this will be re-checked " +
                "whenever it actually responds.",
            error
        );
    }

    // Pinned to the already-confirmed network, with no further live calls
    // ever needed to (re-)confirm it - see `createPinnedNetworkProvider`.
    // This is what lets `FallbackProvider`'s own construction, and every
    // later `getBlockNumber()`/`getBlock()`/`getLogs()`/etc. call through
    // it, resolve without requiring a live round trip to a possibly-down
    // sub provider.
    const mainProvider = createPinnedNetworkProvider(mainProviderUrl, network);
    const subProvider = createPinnedNetworkProvider(subProviderUrl, network);

    return new ethers.providers.FallbackProvider(
        [
            { provider: mainProvider, priority: 1, weight: 2 },
            { provider: subProvider, priority: 2, weight: 1 },
        ],
        quorum
    );
}
