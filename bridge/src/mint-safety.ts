import { ethers } from "ethers";
import {
    isBroadcastRejection,
    isPrimaryRpcTransientError,
} from "./primary-rpc-provider";
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
    /** Survives callers (e.g. Web3) that replace the thrown error. */
    readonly lastBroadcast?: { hash: string; rejected: boolean };
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
 * network yet, so re-signing is safe. Once a broadcast happened, never restart:
 * a definitive rejection propagates, anything else (e.g. ethers' hash check
 * after sending) becomes {@link MintOutcomeUnknownError}.
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
            if (provider.broadcastAttempts !== broadcastsBefore) {
                const last = provider.lastBroadcast;
                if (isBroadcastRejection(error) || last?.rejected) throw error;
                throw new MintOutcomeUnknownError(
                    String(
                        (error as { transactionHash?: unknown } | null)
                            ?.transactionHash ??
                            last?.hash ??
                            "unknown"
                    ),
                    error
                );
            }
            if (attemptNumber >= options.attempts || !isTransient(error))
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
 * A mined revert or a cancelling replacement: the mint definitely did not
 * happen. A "repriced" replacement (same calldata, e.g. an operator speed-up)
 * may have minted, so it is not definitive.
 */
function isDefinitiveReceiptOutcome(error: unknown): boolean {
    const err = error as { code?: unknown; cancelled?: unknown } | null;
    return (
        err?.code === ethers.errors.CALL_EXCEPTION ||
        (err?.code === ethers.errors.TRANSACTION_REPLACED &&
            err.cancelled === true)
    );
}

/**
 * Wait for an already-broadcast mint. Only reverts and replacements are
 * definitive and propagate as-is. Transient errors are retried; anything else,
 * or anything unresolved when the budget or deadline runs out, becomes
 * {@link MintOutcomeUnknownError}.
 */
export async function waitForMintReceipt<R extends { status?: number }>(
    tx: {
        hash: string;
        /**
         * Must honour `timeout`. ethers' Contract replaces a response's
         * `wait` with one that drops it, so pass a provider's
         * `waitForTransaction` rather than such a `tx.wait`.
         */
        wait(confirmations?: number, timeout?: number): Promise<R>;
    },
    options: ReceiptWaitOptions
): Promise<R> {
    const sleep = options.sleep ?? defaultSleep;
    const deadline =
        Date.now() + (options.timeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS);
    let retriesLeft = options.maxRetry;
    while (true) {
        let receipt: R;
        try {
            receipt = await tx.wait(1, Math.max(1, deadline - Date.now()));
        } catch (error) {
            if (isDefinitiveReceiptOutcome(error)) throw error;
            if (
                !isRetryableEthereumError(error) ||
                retriesLeft <= 0 ||
                Date.now() >= deadline
            )
                throw new MintOutcomeUnknownError(tx.hash, error);
            retriesLeft -= 1;
            console.error(
                `Transient error while waiting for the receipt of mint tx ${tx.hash}, ${retriesLeft} attempt(s) left. Retrying...`,
                error
            );
            await sleep(options.delayMs);
            continue;
        }
        // waitForTransaction resolves (not rejects) for a mined revert.
        if (receipt?.status === 0)
            throw Object.assign(
                new Error(`Mint transaction ${tx.hash} reverted`),
                { code: ethers.errors.CALL_EXCEPTION, receipt }
            );
        return receipt;
    }
}
