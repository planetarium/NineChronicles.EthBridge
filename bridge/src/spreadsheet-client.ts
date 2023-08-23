import { combineNcExplorerUrl } from "./messages/utils";
import { sheets_v4 } from "googleapis";

interface FeePolicy {
    baseFeeCriterion: number;
    baseFee: number;
    feeRatio: number;
}

export class SpreadsheetClient {
    private readonly _googleSheet: sheets_v4.Sheets;
    private readonly _googleSpreadSheetId: string;
    private readonly _useSpreadSheet: boolean | undefined;
    private readonly _feePolicy: FeePolicy;

    constructor(
        googleSheet: sheets_v4.Sheets,
        googleSpreadSheetId: string,
        useSpreadSheet: boolean | undefined,
        feePolicy: FeePolicy
    ) {
        this._googleSheet = googleSheet;
        this._googleSpreadSheetId = googleSpreadSheetId;
        this._useSpreadSheet = useSpreadSheet;
        this._feePolicy = feePolicy;
    }

    async to_spreadsheet(data: {
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

            await this._googleSheet.spreadsheets.values.append({
                spreadsheetId: this._googleSpreadSheetId,
                range: "A1:F1",
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [
                        [
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
}
