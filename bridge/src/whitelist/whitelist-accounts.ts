import { WhitelistAccount } from "../types/whitelist-account";
import { ACCOUNT_TYPE } from "./account-type";

/**
 * White Listed Account List, Fill the whitelistedAccounts Array
 * example
 *     {
 *         type: ACCOUNT_TYPE.ALLOWED,
 *         from: "9C Address",
 *         to: "ETH Address",
 *         description: "Account for securing funds"
 *     },
 *     {
 *         type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
 *         from: "9C Address",
 *         to: "ETH Address",
 *         description: "Account of Partner"
 *     },
 */
export const whitelistAccounts: WhitelistAccount[] = [
    {
        type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
        from: "0x7cA620bAc4b96dA636BD4Cb2141A42b55C5f6Fdd",
        to: "0x3C3729cd7D4Ce89C6546636c8083820fac38B368",
        description: "Nine Corporation",
    },
    {
        type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
        from: "0xdF81374a4e4853340CCef6485083Cc1ba9100E2B",
        to: "0x96B32355C206d21E82cC868dd00B1C13fABdd831",
        description: "Planetarium Labs",
    },
];
