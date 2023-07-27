import { WhitelistAccount } from "../types/whitelist-account";
import { ACCOUNT_TYPE } from "./account-type";

/**
 * White Listed Account List, Fill the whitelistedAccounts Array
 * example
 *     {
 *         type: ACCOUNT_TYPE.ALLOWED,
 *         from: "9C Address",
 *         to: "ETH Address",
 *     },
 *     {
 *         type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
 *         from: "9C Address",
 *         to: "ETH Address",
 *     },
 */
export const whitelistedAccounts: WhitelistAccount[] = [];
