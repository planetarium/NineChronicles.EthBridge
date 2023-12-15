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
        from: "0x368440201eB5823a103f4Fb0eF94840365bE838E",
        to: "0xbfA59D285ee3D40D9729da9eB8ebF5082F6D9F84",
        description: "Nine Corporation (Ops)",
    },
    {
        type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
        from: "0xdF81374a4e4853340CCef6485083Cc1ba9100E2B",
        to: "0x96B32355C206d21E82cC868dd00B1C13fABdd831",
        description: "Planetarium Labs",
    },
    {
        type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
        from: "0xE8D6c4b15269754fE7b26DA243052ECD2a88db07",
        to: "0x96B32355C206d21E82cC868dd00B1C13fABdd831",
        description: "Planetarium Labs (Ops)",
    },
    {
        type: ACCOUNT_TYPE.ALLOWED,
        from: "0x5107492e877157f5774863539464C0e67da9ca71",
        to: "0x1e7600a1B8841C48df4833D9691AE5062ee70FFb",
        description: "Hashed",
    },
];
