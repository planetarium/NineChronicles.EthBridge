export enum TransactionStatus {
    PENDING = "pending",
    COMPLETED = "completed",
    FAILED = "failed",
    /** Mint broadcast but not confirmed; check on-chain, never auto-fail. */
    UNCONFIRMED = "unconfirmed",
}
