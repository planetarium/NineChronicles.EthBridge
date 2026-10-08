import { isPrimaryRpcTransientError } from "./primary-rpc-provider";
import { isRetryableEthereumError } from "./rpc-retry";

/**
 * A mint transaction reached the network but its receipt could not be
 * confirmed. It may still be mined, so the request must never be treated as
 * failed and re-minted without checking the transaction hash on-chain.
 */
export class MintOutcomeUnknownError extends Error {
    constructor(
        public readonly transactionHash: string,
        public readonly cause: unknown
    ) {
        super(
            `Mint transaction ${transactionHash} was broadcast but its outcome is unconfirmed. ` +
                `Check it on-chain before any manual action; do not re-mint blindly. Cause: ${describe(
                    cause
                )}`
        );
        this.name = "MintOutcomeUnknownError";
    }
}

function describe(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

/** The routing surface needed to pin pre-broadcast reads to one endpoint. */
export interface BroadcastTrackingProvider {
    beginReadSession(): Promise<() => void>;
    readonly broadcastAttempts: number;
}

function isBroadcastTracking(
    provider: unknown
): provider is BroadcastTrackingProvider {
    return (
        typeof provider === "object" &&
        provider !== null &&
        typeof (provider as BroadcastTrackingProvider).beginReadSession ===
            "function" &&
        typeof (provider as BroadcastTrackingProvider).broadcastAttempts ===
            "number"
    );
}

export interface PreBroadcastRetryOptions {
    /** Total attempts, including the first. */
    attempts: number;
    delayMs: number;
    sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
    return isPrimaryRpcTransientError(error) || isRetryableEthereumError(error);
}

/**
 * Run one mint attempt up to and including its broadcast with every read
 * pinned to a single endpoint: "pending" nonces, Safe nonces and gas estimates
 * differ between nodes and must agree with the node that receives the
 * transaction. A transient failure before anything was broadcast restarts the
 * attempt (possibly on the other endpoint); nothing was signed onto the
 * network yet, so re-signing is safe. Once a broadcast happened, never restart.
 */
export async function pinnedUntilBroadcast<T>(
    provider: unknown,
    attempt: () => Promise<T>,
    options: PreBroadcastRetryOptions
): Promise<T> {
    if (!isBroadcastTracking(provider)) return attempt();
    const sleep = options.sleep ?? defaultSleep;
    for (let attemptNumber = 1; ; attemptNumber++) {
        const broadcastsBefore = provider.broadcastAttempts;
        let release: (() => void) | undefined;
        try {
            release = await provider.beginReadSession();
            return await attempt();
        } catch (error) {
            if (
                provider.broadcastAttempts !== broadcastsBefore ||
                attemptNumber >= options.attempts ||
                !isTransient(error)
            )
                throw error;
            console.error(
                `Transient RPC error before broadcasting a mint (attempt ${attemptNumber}/${options.attempts}); restarting it`,
                error
            );
        } finally {
            release?.();
        }
        await sleep(options.delayMs);
    }
}

export interface ReceiptWaitOptions {
    /** Retries after a transient receipt read error or a wait timeout. */
    maxRetry: number;
    delayMs: number;
    /** Overall deadline; ethers otherwise polls a missing receipt forever. */
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_RECEIPT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Wait for an already-broadcast mint. Reverts and replacements are definitive
 * and propagate as-is; anything still unresolved when the retry budget or the
 * deadline runs out becomes {@link MintOutcomeUnknownError}.
 */
export async function waitForMintReceipt<R>(
    tx: {
        hash: string;
        wait(confirmations?: number, timeout?: number): Promise<R>;
    },
    options: ReceiptWaitOptions
): Promise<R> {
    const sleep = options.sleep ?? defaultSleep;
    const deadline =
        Date.now() + (options.timeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS);
    let retriesLeft = options.maxRetry;
    while (true) {
        try {
            return await tx.wait(1, Math.max(1, deadline - Date.now()));
        } catch (error) {
            if (!isRetryableEthereumError(error)) throw error;
            if (retriesLeft <= 0 || Date.now() >= deadline)
                throw new MintOutcomeUnknownError(tx.hash, error);
            retriesLeft -= 1;
            console.error(
                `Transient error while waiting for the receipt of mint tx ${tx.hash}, ${retriesLeft} attempt(s) left. Retrying...`,
                error
            );
        }
        await sleep(options.delayMs);
    }
}
