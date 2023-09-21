import { combineNcExplorerUrl, combineUrl } from "./messages/utils";
import { sheets_v4 } from "googleapis";

interface FeePolicy {
    baseFeeCriterion: number;
    baseFee: number;
    feeRatio: number;
}

interface SheetIndexes {
    mint: string;
    burn: string;
}

export class SpreadsheetClient {
    private readonly _googleSheet: sheets_v4.Sheets;
    private readonly _googleSpreadSheetId: string;
    private readonly _useSpreadSheet: boolean | undefined;
    private readonly _feePolicy: FeePolicy;
    private readonly _slackUrl: string;
    private readonly _sheetIndexes: SheetIndexes;

    constructor(
        googleSheet: sheets_v4.Sheets,
        googleSpreadSheetId: string,
        useSpreadSheet: boolean | undefined,
        feePolicy: FeePolicy,
        slackUrl: string,
        sheetIndexes: SheetIndexes
    ) {
        this._googleSheet = googleSheet;
        this._googleSpreadSheetId = googleSpreadSheetId;
        this._useSpreadSheet = useSpreadSheet;
        this._feePolicy = feePolicy;
        this._slackUrl = slackUrl;
        this._sheetIndexes = sheetIndexes;
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
            const amountNum = Number(data.amount);
            const amountFeeApplied =
                amountNum >= this._feePolicy.baseFeeCriterion
                    ? (amountNum * 0.99).toFixed(2)
                    : amountNum - this._feePolicy.baseFee;

            return await this._googleSheet.spreadsheets.values.append({
                spreadsheetId: this._googleSpreadSheetId,
                // range: "NCGtoWNCG!A1:F1",
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
