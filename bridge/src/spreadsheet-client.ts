import { combineNcExplorerUrl, combineUrl } from "./messages/utils";
import { sheets_v4 } from "googleapis";
import { IExchangeFeeRatioPolicy } from "./policies/exchange-fee-ratio";
import Decimal from "decimal.js";

interface BaseFeePolicy {
    baseFeeCriterion: number;
    baseFee: number;
}

interface SheetIndexes {
    mint: string;
    burn: string;
}

export class SpreadsheetClient {
    private readonly _googleSheet: sheets_v4.Sheets;
    private readonly _googleSpreadSheetId: string;
    private readonly _useSpreadSheet: boolean | undefined;
    private readonly _slackUrl: string;
    private readonly _sheetIndexes: SheetIndexes;
    private readonly _baseFeePolicy: BaseFeePolicy;
    private readonly _exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy;

    constructor(
        googleSheet: sheets_v4.Sheets,
        googleSpreadSheetId: string,
        useSpreadSheet: boolean | undefined,
        slackUrl: string,
        sheetIndexes: SheetIndexes,
        baseFeePolicy: BaseFeePolicy,
        exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy
    ) {
        this._googleSheet = googleSheet;
        this._googleSpreadSheetId = googleSpreadSheetId;
        this._useSpreadSheet = useSpreadSheet;
        this._slackUrl = slackUrl;
        this._sheetIndexes = sheetIndexes;
        this._baseFeePolicy = baseFeePolicy;
        this._exchangeFeeRatioPolicy = exchangeFeeRatioPolicy;
    }

    async to_spreadsheet_mint(data: {
        slackMessageId: string;
        url: string;
        ncscanUrl: string | undefined;
        useNcscan: boolean;
        txId: string;
        sender: string;
        recipient: string;
        amount: string;
        error: string;
    }) {
        if (!this._useSpreadSheet) return;

        try {
            const amountDecimal = new Decimal(Number(data.amount));
            const exchangeFeeRatio = this._exchangeFeeRatioPolicy.getFee();

            let fee;
            if (
                !amountDecimal.greaterThanOrEqualTo(
                    new Decimal(this._baseFeePolicy.baseFeeCriterion)
                )
            ) {
                fee = new Decimal(this._baseFeePolicy.baseFee);
            } else {
                if (
                    !amountDecimal.greaterThan(exchangeFeeRatio.feeRange1.end)
                ) {
                    fee = new Decimal(
                        amountDecimal
                            .mul(exchangeFeeRatio.feeRange1.ratio)
                            .toFixed(2)
                    );
                } else {
                    fee = new Decimal(
                        amountDecimal
                            .mul(exchangeFeeRatio.feeRange2.ratio)
                            .toFixed(2)
                    );
                }
            }
            const amountFeeApplied = amountDecimal.sub(fee).toString();

            return await this._googleSheet.spreadsheets.values.append({
                spreadsheetId: this._googleSpreadSheetId,
                range: this._sheetIndexes.mint,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        [
                            this._slackUrl + data.slackMessageId,
                            combineNcExplorerUrl(
                                data.url,
                                data.ncscanUrl,
                                data.useNcscan,
                                data.txId
                            ),
                            data.sender,
                            data.recipient,
                            data.amount,
                            amountFeeApplied,
                            data.error,
                            new Date().toLocaleString("sv"),
                        ],
                    ],
                },
            });
        } catch (e) {
            console.log(e);
        }

        return null;
    }

    async to_spreadsheet_burn(data: {
        slackMessageId: string;
        url: string;
        txId: string;
        sender: string;
        recipient: string;
        amount: string;
        error: string;
    }) {
        if (!this._useSpreadSheet) return;

        try {
            return await this._googleSheet.spreadsheets.values.append({
                spreadsheetId: this._googleSpreadSheetId,
                range: this._sheetIndexes.burn,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        [
                            this._slackUrl + data.slackMessageId,
                            combineUrl(data.url, `/tx/${data.txId}`),
                            data.sender,
                            data.recipient,
                            data.amount,
                            data.error,
                            new Date().toLocaleString("sv"),
                        ],
                    ],
                },
            });
        } catch (e) {
            console.log(e);
        }

        return null;
    }
}
