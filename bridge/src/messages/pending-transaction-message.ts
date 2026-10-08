import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { ForceOmit } from "../types/force-omit";
import { ExchangeHistory } from "../interfaces/exchange-history-store";
import { combineUrl } from "./utils";
import { MultiPlanetary } from "../multi-planetary";

export class PendingTransactionMessage implements Message {
    private readonly _ethScanUrl: string;
    private readonly _ncScanUrl: string;
    private readonly _multiPlanetary: MultiPlanetary;

    constructor(
        private readonly transactions: ExchangeHistory[],
        private readonly multiPlanetary: MultiPlanetary,
        ethScanUrl: string = process.env.ETHERSCAN_ROOT_URL ||
            "https://etherscan.io/",
        ncScanUrl: string = process.env.NCSCAN_URL || "https://9cscan.com/",
        private readonly kind: "Pending" | "Unconfirmed" = "Pending",
        private readonly total: number = transactions.length
    ) {
        this._ethScanUrl = ethScanUrl;
        this._ncScanUrl = ncScanUrl;
        this._multiPlanetary = multiPlanetary;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        console.log(this.transactions);
        if (this.transactions.length !== 0) {
            console.log("Pending Transactions : ", this.transactions);
            return {
                text:
                    (this.kind === "Pending"
                        ? `${this.total} Pending Transactions Found`
                        : `${this.total} Unconfirmed Mints Found`) +
                    (this.total > this.transactions.length
                        ? ` (showing ${this.transactions.length})`
                        : "") +
                    (this.kind === "Pending"
                        ? ""
                        : " - check each on-chain before any refund or re-mint"),
                attachments: this.transactions.map((tx) => {
                    const titleUrl =
                        tx.network === "ethereum"
                            ? this._ethScanUrl
                            : this._ncScanUrl;
                    const senderLabel =
                        tx.network === "ethereum" ? "ETH" : "9C";
                    const recipientLabel =
                        tx.network === "ethereum" ? "9c" : "ETH";
                    const authorLabel =
                        tx.network === "ethereum" ? "wNCG → NCG" : "NCG → wNCG";
                    return {
                        author_name: `[ETH] ${authorLabel} ${this.kind.toLowerCase()} event`,
                        color: "#ff0033",
                        fields: [
                            {
                                title: senderLabel + " transaction",
                                value: combineUrl(titleUrl, `/tx/${tx.tx_id}`),
                            },
                            {
                                title: "Planet Name",
                                value: this._multiPlanetary.getRequestPlanetName(
                                    tx.recipient
                                ),
                            },
                            {
                                title: `Sender(${senderLabel})`,
                                value: tx.sender,
                            },
                            {
                                title: `Recipient(${recipientLabel})`,
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
                    };
                }),
            };
        }

        return {
            text: "No pending transactions",
            attachments: [
                {
                    author_name: "ETH Bridge Restarted",
                    color: "#ffcc00",
                },
            ],
        };
    }
}
