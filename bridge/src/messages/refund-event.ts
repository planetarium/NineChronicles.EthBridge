import { ChatPostMessageArguments } from "@slack/web-api";
import { Message, combineUrl } from ".";
import { TxId } from "../types/txid";
import { Address } from "../types/address";
import { Decimal } from "decimal.js";
import { ForceOmit } from "../types/force-omit";

export class RefundEvent implements Message {
    private readonly _sender: Address;
    private readonly _requestTxId: TxId;
    private readonly _requestAmount: Decimal;
    private readonly _refundTxId: TxId;
    private readonly _refundAmount: Decimal;
    private readonly _explorerUrl: string;
    private readonly _reason: string;

    constructor(
        explorerUrl: string,
        sender: Address,
        requestTxId: TxId,
        requestAmount: Decimal,
        refundTxId: TxId,
        refundAmount: Decimal,
        reason: string
    ) {
        this._sender = sender;
        this._refundTxId = refundTxId;
        this._refundAmount = refundAmount;
        this._requestTxId = requestTxId;
        this._requestAmount = requestAmount;
        this._explorerUrl = explorerUrl;
        this._reason = reason;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: "NCG refund event occurred.",
            attachments: [
                {
                    author_name: "Bridge Event",
                    color: "#42f5aa",
                    fields: [
                        {
                            title: "Reason",
                            value: this._reason,
                        },
                        {
                            title: "Address",
                            value: this._sender,
                        },
                        {
                            title: "Request transaction",
                            value: combineUrl(
                                this._explorerUrl,
                                `transaction?${this._requestTxId}`
                            ),
                        },
                        {
                            title: "Request Amount",
                            value: this._requestAmount.toString(),
                        },
                        {
                            title: "Refund transaction",
                            value: combineUrl(
                                this._explorerUrl,
                                `transaction?${this._refundTxId}`
                            ),
                        },
                        {
                            title: "Refund Amount",
                            value: this._refundAmount.toString(),
                        },
                    ],
                    fallback: `Refund NCG ${this._refundAmount} in ${this._requestAmount} to ${this._sender}`,
                },
            ],
        };
    }
}
