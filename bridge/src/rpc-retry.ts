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

// JSON-RPC "internal error" range some providers (e.g. Infura, Alchemy) use for
// transient node/quota issues, as opposed to e.g. -32000 execution errors or
// -32602 invalid params, which indicate a real problem with the request itself.
const RETRYABLE_JSON_RPC_CODE_PATTERN = /^-326\d\d$/;

function extractCandidateCodes(error: unknown): unknown[] {
    if (error === null || typeof error !== "object") {
        return [];
    }

    // ethers usually throws `{ code: 'SERVER_ERROR', ..., error: { code: -32603, ... } }`
    // where the inner `error` is the raw JSON-RPC error. Both codes are checked.
    const err = error as { code?: unknown; error?: { code?: unknown } };
    return [err.code, err.error?.code];
}

/**
 * Decides whether an error thrown from an Ethereum RPC call (or a transaction
 * submitted through it) looks transient and is therefore safe to retry.
 *
 * This is intentionally conservative: anything that isn't clearly a
 * network/server/timeout condition, or a JSON-RPC internal error, is treated as
 * NOT retryable, so revert reasons, invalid nonce errors, and anything else that
 * could mean a transaction was already broadcast are never retried here. Blindly
 * retrying those could cause a duplicate submission.
 */
export function isRetryableEthereumError(error: unknown): boolean {
    for (const code of extractCandidateCodes(error)) {
        if (
            typeof code === "string" &&
            RETRYABLE_ETHERS_ERROR_CODES.has(code)
        ) {
            return true;
        }

        if (
            (typeof code === "number" || typeof code === "string") &&
            RETRYABLE_JSON_RPC_CODE_PATTERN.test(String(code))
        ) {
            return true;
        }
    }

    return false;
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
 * Runs `fn`, retrying only when the thrown error looks like a transient
 * Ethereum RPC issue (see `isRetryableEthereumError`). Any other error -
 * including one that could mean a transaction was already broadcast - is
 * rethrown immediately without retrying.
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
