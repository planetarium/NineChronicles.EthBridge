import { ethers } from "ethers";

// ethers' own transient error codes. See
// https://docs.ethers.org/v5/api/utils/logger/#errors
const RETRYABLE_ETHERS_ERROR_CODES: ReadonlySet<string> = new Set([
    ethers.errors.SERVER_ERROR,
    ethers.errors.TIMEOUT,
    ethers.errors.NETWORK_ERROR,
]);

/**
 * -32005 is shared by provider quota/rate limits and deterministic result-size
 * limits; only the former is an outage worth retrying elsewhere or later.
 */
export function isRpcQuotaExceededError(code: unknown, message: unknown) {
    const text = typeof message === "string" ? message : "";
    return (
        Number(code) === -32005 &&
        !/block.*range|range.*block|too many (results|logs)|query returned more than|response.*size/i.test(
            text
        ) &&
        /rate|quota|requests per|request limit|maximum API usage limit|^\s*limit exceeded[.!]?\s*$/i.test(
            text
        )
    );
}

/** Classifies transient read failures, not whether a write is safe to repeat. */
export function isRetryableEthereumError(error: unknown): boolean {
    if (error === null || typeof error !== "object") return false;
    const err = error as {
        code?: unknown;
        event?: unknown;
        error?: unknown;
        status?: number;
        message?: unknown;
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
        return (
            Number(err.code) === -32603 ||
            isRpcQuotaExceededError(err.code, err.message)
        );
    }
    if (err.status !== undefined && err.status >= 400) {
        // 402 is how some providers (e.g. NodeReal) report an exhausted quota.
        return err.status === 402 || err.status === 429 || err.status >= 500;
    }
    return (
        typeof err.code === "string" &&
        RETRYABLE_ETHERS_ERROR_CODES.has(err.code)
    );
}
