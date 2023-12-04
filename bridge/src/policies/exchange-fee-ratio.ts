import Decimal from "decimal.js";

export interface IExchangeFeeRatioPolicy {
    getFee(amount: Decimal): Decimal;
}

export interface BaseFeePolicy {
    criterion: Decimal;
    fee: Decimal;
}

export interface FeeRatios {
    range1: Decimal;
    range2: Decimal;
}

export class FixedExchangeFeeRatioPolicy implements IExchangeFeeRatioPolicy {
    private readonly _baseFeePolicy: BaseFeePolicy;
    private readonly _maximumNCG: Decimal;
    private readonly _feeRangeDividerAmount: Decimal;
    private readonly _feeRatios: FeeRatios;

    constructor(
        maximumNCG: Decimal,
        feeRangeDividerAmount: Decimal,
        baseFeePolicy: BaseFeePolicy,
        feeRatios: FeeRatios
    ) {
        this._maximumNCG = maximumNCG;
        this._feeRangeDividerAmount = feeRangeDividerAmount;
        this._baseFeePolicy = baseFeePolicy;
        this._feeRatios = feeRatios;
    }

    getFee(amount: Decimal): Decimal {
        /**
         * BASE FEE
         * If exchangeFeeRatio == 0.01 (1%), it exchanges only 0.99 (= 1 - 0.01 = 99%) of amount.
         * Applied Base Fee Policy, base Fee = 10 when Transfer( NCG -> WNCG ) under 1000 NCG
         */
        if (amount.lessThan(this._baseFeePolicy.criterion)) {
            return this._baseFeePolicy.fee;
        }

        let fee = new Decimal(amount.mul(this._feeRatios.range1).toFixed(2));

        if (
            amount.greaterThan(this._feeRangeDividerAmount) &&
            amount.lessThanOrEqualTo(this._maximumNCG)
        ) {
            const overAmount = amount.sub(this._feeRangeDividerAmount);
            const surCharge = new Decimal(
                overAmount.mul(this._feeRatios.range2).toFixed(2)
            );
            fee = fee.add(surCharge);
        }

        return fee;
    }
}
