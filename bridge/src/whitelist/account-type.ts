/**
 * WhiteListed Account Type
 * ALLOWED: White listed Account, applied fee policy when transfer NCG -> WNCG
 * FEE_WAIVER_ALLOWED: White listed Account, fee-free
 */
export enum ACCOUNT_TYPE {
    ALLOWED = "allowed",
    FEE_WAIVER_ALLOWED = "feeWavierAllowed",
    NORMAL = "normal",
}
