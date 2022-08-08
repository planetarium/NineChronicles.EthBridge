import Decimal from "decimal.js";
import { Address } from "../types/address";

export interface IExchangeFeeRatioPolicy {
    getFee(address: Address): Decimal | false;
}

export class FixedExchangeFeeRatioPolicy implements IExchangeFeeRatioPolicy {
    private readonly _fee: Decimal;

    constructor(fee: Decimal) {
        this._fee = fee;
    }

    getFee(address: string): Decimal | false {
        return this._fee;
    }
}

export class ZeroExchangeFeeRatioPolicy implements IExchangeFeeRatioPolicy {
    private readonly _address: Address;

    constructor(address: Address) {
        this._address = address
    }

    getFee(address: string): Decimal | false {
        if (address === this._address) {
            return new Decimal(0);
        }

        return false;
    }
}

export class ExchnageFeePolicies implements IExchangeFeeRatioPolicy {
    private readonly _policies: IExchangeFeeRatioPolicy[];

    constructor(policies: IExchangeFeeRatioPolicy[]) {
        this._policies = policies;
    }

    getFee(address: string): Decimal | false {
        for (const policy of this._policies) {
            const fee = policy.getFee(address);
            if (fee !== false) {
                return fee;
            }
        }
        return false;
    }
}
