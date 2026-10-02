import { ethers } from "ethers";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

// ethers' own transient error codes. See
// https://docs.ethers.org/v5/api/utils/logger/#errors
const RETRYABLE_ETHERS_ERROR_CODES: ReadonlySet<string> = new Set([
    ethers.errors.SERVER_ERROR,
    ethers.errors.TIMEOUT,
    ethers.errors.NETWORK_ERROR,
]);

/** Classifies transient read failures, not whether a write is safe to repeat. */
export function isRetryableEthereumError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const err = error as {
        code?: unknown;
        event?: unknown;
        error?: unknown;
        status?: number;
    };

    // A changed chain is a configuration/safety error, not an outage.
    if (err.code === ethers.errors.NETWORK_ERROR && err.event === "changed")
        return false;

    if (
        typeof err.code === "string" &&
        [
            ethers.errors.CALL_EXCEPTION,
            ethers.errors.NONCE_EXPIRED,
            ethers.errors.INSUFFICIENT_FUNDS,
            ethers.errors.UNPREDICTABLE_GAS_LIMIT,
            ethers.errors.REPLACEMENT_UNDERPRICED,
            ethers.errors.TRANSACTION_REPLACED,
        ].includes(err.code as ethers.errors)
    )
        return false;

    // ethers wraps deterministic JSON-RPC errors in SERVER_ERROR. Inspect the
    // inner error first so invalid params, reverts and nonce errors stay fatal.
    if (err.error && typeof err.error === "object" && "code" in err.error) {
        return isRetryableEthereumError(err.error);
    }
    if (
        typeof err.code === "number" ||
        (typeof err.code === "string" && /^-\d+$/.test(err.code))
    ) {
        return Number(err.code) === -32603;
    }
    if (err.status !== undefined && err.status >= 400) {
        return err.status === 429 || err.status >= 500;
    }
    return (
        typeof err.code === "string" &&
        RETRYABLE_ETHERS_ERROR_CODES.has(err.code)
    );
}

export interface RetryEthereumRpcOptions {
    // Maximum number of additional attempts after the first one fails.
    maxRetry: number;
    // Delay between attempts, in milliseconds.
    delayMs: number;
    // Called every time a retryable error is about to be retried (not on the
    // final, non-retried failure). Useful for logging/metrics.
    onRetryableError?: (error: unknown, attemptsLeft: number) => void;
}

/**
 * Retry an idempotent read with a bounded delay. Never wrap mint(), transaction
 * submission, or any operation whose side effects may already have happened.
 */
export async function retryEthereumRpc<T>(
    fn: () => Promise<T>,
    options: RetryEthereumRpcOptions
): Promise<T> {
    const { maxRetry, delayMs, onRetryableError } = options;
    let attemptsLeft = maxRetry;

    while (true) {
        try {
            return await fn();
        } catch (error) {
            if (attemptsLeft <= 0 || !isRetryableEthereumError(error)) {
                throw error;
            }

            attemptsLeft -= 1;
            onRetryableError?.(error, attemptsLeft);
            await delay(delayMs);
        }
    }
}
