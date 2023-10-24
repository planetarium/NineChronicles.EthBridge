import Decimal from "decimal.js";

export interface IExchangeFeeRatioPolicy {
    getFee(): {
        feeRange1: IExchangeFeeInfo;
        feeRange2: IExchangeFeeInfo;
    };
}

export interface IExchangeFeeInfo {
    start: Decimal;
    end: Decimal;
    ratio: Decimal;
}

export class FixedExchangeFeeRatioPolicy implements IExchangeFeeRatioPolicy {
    private readonly _feeRange1: IExchangeFeeInfo;
    private readonly _feeRange2: IExchangeFeeInfo;

    constructor(feeRange1: IExchangeFeeInfo, feeRange2: IExchangeFeeInfo) {
        this._feeRange1 = feeRange1;
        this._feeRange2 = feeRange2;
    }

    getFee(): {
        feeRange1: IExchangeFeeInfo;
        feeRange2: IExchangeFeeInfo;
    } {
        return {
            feeRange1: this._feeRange1,
            feeRange2: this._feeRange2,
        };
    }
}
