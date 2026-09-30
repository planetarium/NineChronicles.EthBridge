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

// The JSON-RPC 2.0 "Internal error" code - a genuinely transient, server-side
// problem, safe to retry. See https://www.jsonrpc.org/specification#error_object.
const RETRYABLE_JSON_RPC_INTERNAL_ERROR_CODE = -32603;

// Deterministic JSON-RPC 2.0 codes for a malformed or invalid request. These
// will NEVER succeed on retry, no matter how the surrounding error looks -
// including when ethers wraps one of these inside an outer SERVER_ERROR-like
// envelope, which otherwise looks retryable at a glance.
const DETERMINISTIC_JSON_RPC_CODES: ReadonlySet<number> = new Set([
    -32700, // Parse error
    -32600, // Invalid Request
    -32601, // Method not found
    -32602, // Invalid params
]);

function toNumericCode(code: unknown): number | null {
    if (typeof code === "number") {
        return code;
    }
    if (typeof code === "string" && /^-?\d+$/.test(code)) {
        return parseInt(code, 10);
    }
    return null;
}

/**
 * Decides whether an error thrown from an Ethereum RPC call (or a transaction
 * submitted through it) looks transient and is therefore safe to retry.
 *
 * This is intentionally conservative: anything that isn't clearly a
 * network/server/timeout condition, or specifically the JSON-RPC "Internal
 * error" code, is treated as NOT retryable, so revert reasons, invalid nonce
 * errors, and anything else that could mean a transaction was already
 * broadcast are never retried here. Blindly retrying those could cause a
 * duplicate submission.
 *
 * ethers often wraps the raw JSON-RPC error under an outer `{ code:
 * 'SERVER_ERROR', ..., error: { code, message, ... } }` envelope. The outer
 * `SERVER_ERROR`/`TIMEOUT`/`NETWORK_ERROR` classification alone is NOT
 * trusted when a deterministic inner JSON-RPC code (e.g. invalid params, or
 * an unknown method) is present - that inner code means the request itself
 * will never succeed, regardless of how the outer wrapper looks.
 */
export function isRetryableEthereumError(error: unknown): boolean {
    if (error === null || typeof error !== "object") {
        return false;
    }

    const err = error as { code?: unknown; error?: { code?: unknown } };
    const innerCode = toNumericCode(err.error?.code);

    if (innerCode !== null) {
        if (DETERMINISTIC_JSON_RPC_CODES.has(innerCode)) {
            return false;
        }
        if (innerCode === RETRYABLE_JSON_RPC_INTERNAL_ERROR_CODE) {
            return true;
        }
    }

    const outerCode = err.code;
    if (
        typeof outerCode === "string" &&
        RETRYABLE_ETHERS_ERROR_CODES.has(outerCode)
    ) {
        return true;
    }

    if (toNumericCode(outerCode) === RETRYABLE_JSON_RPC_INTERNAL_ERROR_CODE) {
        return true;
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
