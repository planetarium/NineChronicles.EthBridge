import { combineNcExplorerUrl } from "./messages/utils";
import { sheets_v4 } from "googleapis";

export class SpreadsheetClient {
    private readonly _googleSheet: sheets_v4.Sheets;
    private readonly _googleSpreadSheetId: string;
    constructor(googleSheet: sheets_v4.Sheets, googleSpreadSheetId: string) {
        this._googleSheet = googleSheet;
        this._googleSpreadSheetId = googleSpreadSheetId;
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
        try {
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
