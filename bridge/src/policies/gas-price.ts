import { Decimal } from "decimal.js";

export interface IGasPricePolicy {
    calculateGasPrice(gasPrice: Decimal): Decimal;
}

export class GasPriceTipPolicy implements IGasPricePolicy {
    private readonly _tipRatio: Decimal;

    constructor(tipRatio: Decimal) {
        this._tipRatio = tipRatio;
    }

    calculateGasPrice(gasPrice: Decimal): Decimal {
        return gasPrice.mul(this._tipRatio).floor();
    }
}

export class GasPricePolicies implements IGasPricePolicy {
    private readonly _policies: IGasPricePolicy[];

    constructor(policies: IGasPricePolicy[]) {
        this._policies = policies;
    }

    calculateGasPrice(gasPrice: Decimal): Decimal {
        for (const policy of this._policies) {
            gasPrice = policy.calculateGasPrice(gasPrice);
        }

        return gasPrice;
    }
};
