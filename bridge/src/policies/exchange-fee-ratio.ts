import Decimal from "decimal.js";
import { ACCOUNT_TYPE } from "../whitelist/account-type";

export interface IExchangeFeeRatioPolicy {
    getFee(
        amount: Decimal,
        transferredAmountInLast24Hours: Decimal,
        accountType?: ACCOUNT_TYPE
    ): Decimal;
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

    /**
     * fee for less than the criterion: 10 fixed
     * fee for less than the feeRangeDividerAmount: 1% of the amount (1% base)
     * fee for more than the feeRangeDividerAmount: 3% of the amount (1% base + 2% surcharge)
     * fee is rounded to 2 decimal places
     * fee considering transfer amount and transferred amount in the last 24 hours
     */
    getFee(
        amount: Decimal,
        transferredAmountInLast24Hours: Decimal,
        accountType: ACCOUNT_TYPE = ACCOUNT_TYPE.GENERAL
    ): Decimal {
        // no fee for NO_LIMIT_NO_FEE account
        if (accountType === ACCOUNT_TYPE.NO_LIMIT_NO_FEE) {
            return new Decimal(0);
        }

        // fixed 1% fee for NO_LIMIT_ONE_PERCENT_FEE account
        if (accountType === ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE) {
            return new Decimal(amount.mul(0.01).toFixed(2));
        }

        const afterTransferAmount: Decimal =
            transferredAmountInLast24Hours.add(amount);
        if (accountType === ACCOUNT_TYPE.GENERAL) {
            // general account has restrictions on the transfer amount
            this._generalAccountValidityCheck(amount, afterTransferAmount);
        }

        let range1amount: Decimal;
        let range2amount: Decimal;
        if (
            transferredAmountInLast24Hours.greaterThan(
                this._feeRangeDividerAmount
            )
        ) {
            // feeRangeDividerAmount < transferredAmountInLast24Hours
            // base fee (1%) + surcharge (2%) for the whole amount
            range1amount = new Decimal(0);
            range2amount = amount;
        } else if (
            transferredAmountInLast24Hours.greaterThan(
                this._baseFeePolicy.criterion
            )
        ) {
            // criterion < transferredAmountInLast24Hours < feeRangeDividerAmount
            // no fixed fee, some base fee (1%) + some or no surcharge (2%)
            if (afterTransferAmount.greaterThan(this._feeRangeDividerAmount)) {
                // if feeRangeDividerAmount < afterTransferAmount
                range1amount = this._feeRangeDividerAmount.sub(
                    transferredAmountInLast24Hours
                );
                range2amount = amount.sub(range1amount);
            } else {
                // no surcharge if afterTransferAmount < feeRangeDividerAmount
                range1amount = amount;
                range2amount = new Decimal(0);
            }
        } else if (
            afterTransferAmount.lessThanOrEqualTo(this._feeRangeDividerAmount)
        ) {
            // transferredAmountInLast24Hours < criterion && afterTransferAmount <= _feeRangeDividerAmount
            range1amount = amount;
            range2amount = new Decimal(0);
        } else {
            // transferredAmountInLast24Hours < criterion && _feeRangeDividerAmount < afterTransferAmount
            range1amount = this._feeRangeDividerAmount.sub(
                transferredAmountInLast24Hours
            );
            range2amount = amount.sub(range1amount);
        }

        const fee: Decimal = new Decimal(0)
            .add(range1amount.mul(this._feeRatios.range1)) // base for range1
            .add(range2amount.mul(this._feeRatios.range1)) // base for range2
            .add(range2amount.mul(this._feeRatios.range2)); // surcharge for range2

        // fee is always greater or equal to the base fee
        return Decimal.max(
            this._baseFeePolicy.fee,
            new Decimal(fee.toFixed(2))
        );
    }

    private _generalAccountValidityCheck(
        amount: Decimal,
        afterTransferAmount: Decimal
    ): void {
        // reject if the amount is less than 100 NCG from general accounts
        if (amount.lessThan(100)) {
            throw new Error(
                "The transfer amount should be greater than 100 NCG"
            );
        }

        // reject if the amount is more than this._maximumNCG from general accounts
        if (amount.greaterThan(this._maximumNCG)) {
            throw new Error(
                `The transfer amount should be less than or equal to ${this._maximumNCG} NCG`
            );
        }

        // reject if the after-transfer amount is more than this._maximumNCG from general accounts
        if (afterTransferAmount.greaterThan(this._maximumNCG)) {
            throw new Error(
                `24hr transfer amount should be less than or equal to ${this._maximumNCG} NCG`
            );
        }
    }
}
