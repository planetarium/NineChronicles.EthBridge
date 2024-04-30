/**
 * Accout types with allowlisted for transfer amount and fee policy
 * NO_LIMIT_REGULAR_FEE: allowlisted, no limit on transfer amount but fee policy is applied
 * NO_LIMIT_ONE_PERCENT_FEE: allowlisted, no limit on transfer amount and 1% constant fee for NCG -> WNCG transfer
 * NO_LIMIT_NO_FEE: allowlisted, no limit on transfer amount and no fee for NCG -> WNCG transfer
 * GENERAL: limit on transfer amount and fee policy is applied
 */
export enum ACCOUNT_TYPE {
    NO_LIMIT_REGULAR_FEE = "noLimitRegularFee",
    NO_LIMIT_ONE_PERCENT_FEE = "noLimitOnePercentFee",
    NO_LIMIT_NO_FEE = "noLimitNoFee",
    GENERAL = "general",
}
