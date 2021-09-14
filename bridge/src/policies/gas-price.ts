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
