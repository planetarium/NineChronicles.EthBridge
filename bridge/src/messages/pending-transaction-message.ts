import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { ForceOmit } from "../types/force-omit";
import { ExchangeHistory } from "../interfaces/exchange-history-store";
import { combineUrl } from "./utils";
import { MultiPlanetary } from "../multi-planetary";

export class PendingTransactionMessage implements Message {
    private readonly _bscScanUrl: string;
    private readonly _multiPlanetary: MultiPlanetary;

    constructor(
        private readonly transactions: ExchangeHistory[],
        private readonly multiPlanetary: MultiPlanetary,
        bscScanUrl: string = process.env.BSCSCAN_URL || "https://bscscan.com"
    ) {
        this._bscScanUrl = bscScanUrl;
        this._multiPlanetary = multiPlanetary;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        if (this.transactions) {
            console.log("Pending Transactions : ", this.transactions);
            return {
                text: `${this.transactions.length} Pending Transactions Found`,
                attachments: this.transactions.map((tx) => ({
                    author_name: "[ETH] wNCG → NCG pending event",
                    color: "#ff0033",
                    fields: [
                        {
                            title: "BSC transaction",
                            value: combineUrl(
                                this._bscScanUrl,
                                `/tx/${tx.tx_id}`
                            ),
                        },
                        {
                            title: "Planet Name",
                            value: this._multiPlanetary.getRequestPlanetName(
                                tx.recipient
                            ),
                        },
                        {
                            title: "Sender(BSC)",
                            value: tx.sender,
                        },
                        {
                            title: "Recipient(9c)",
                            value: tx.recipient,
                        },
                        {
                            title: "Amount",
                            value: tx.amount.toString(),
                        },
                        {
                            title: "Timestamp",
                            value: tx.timestamp,
                        },
                    ],
                })),
            };
        }

        return {
            text: "No pending transactions",
            attachments: [
                {
                    author_name: "BSC Bridge Restarted",
                    color: "#ffcc00",
                },
            ],
        };
    }
}
