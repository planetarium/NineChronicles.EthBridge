import { ACCOUNT_TYPE } from "../whitelist/account-type";

export type WhitelistAccount = {
    type?: ACCOUNT_TYPE;
    from?: string;
    to?: string;
};
