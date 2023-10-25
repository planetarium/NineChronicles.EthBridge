import Decimal from "decimal.js";

export interface IExchangeFeeRatioPolicy {
    getFee(amount: Decimal): Decimal;
}

export interface BaseFeePolicy {
    criterion: Decimal;
    fee: Decimal;
}

export interface IExchangeFeeInfo {
    start: Decimal;
    end: Decimal;
    ratio: Decimal;
}

export class FixedExchangeFeeRatioPolicy implements IExchangeFeeRatioPolicy {
    private readonly _feeRange1: IExchangeFeeInfo;
    private readonly _feeRange2: IExchangeFeeInfo;
    private readonly _baseFeePolicy: BaseFeePolicy;

    constructor(
        feeRange1: IExchangeFeeInfo,
        feeRange2: IExchangeFeeInfo,
        baseFeePolicy: BaseFeePolicy
    ) {
        this._feeRange1 = feeRange1;
        this._feeRange2 = feeRange2;
        this._baseFeePolicy = baseFeePolicy;
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

        // fee for Amount Range 1
        if (
            amount.greaterThanOrEqualTo(this._feeRange1.start) &&
            amount.lessThanOrEqualTo(this._feeRange1.end)
        ) {
            return new Decimal(amount.mul(this._feeRange1.ratio).toFixed(2));
        } else if (
            // fee for Amount Range 2
            amount.greaterThan(this._feeRange2.start) &&
            amount.lessThanOrEqualTo(this._feeRange2.end)
        ) {
            return new Decimal(amount.mul(this._feeRange2.ratio).toFixed(2));
        }

        throw new Error(`Invalid amount for getting fee.`);
    }
}
