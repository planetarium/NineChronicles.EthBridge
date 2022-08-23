import { ChatPostMessageArguments } from "@slack/web-api";
import { WrappingEvent } from "./wrapping-event";
import { Address } from "../types/address";
import { TxId } from "../types/txid";
import Decimal from "decimal.js";
import { ForceOmit } from "../types/force-omit";

export class WrappedEvent extends WrappingEvent {
    private readonly _sender: Address;
    private readonly _recipient: Address;
    private readonly _nineChroniclesTxId: TxId;
    private readonly _ethereumTransactionHash: string;
    private readonly _fee: Decimal;
    private readonly _exchangeAmount: string;
    private readonly _refundAmount: string | null;
    private readonly _refundTxId: string | null;

    constructor(
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string,
        sender: Address,
        recipient: Address,
        exchangeAmount: string,
        nineChroniclesTxId: TxId,
        ethereumTransactionHash: string,
        fee: Decimal,
        refundAmount: string | null,
        refundTxId: TxId | null
    ) {
        super(explorerUrl, ncscanUrl, useNcscan, etherscanUrl);

        this._sender = sender;
        this._recipient = recipient;
        this._exchangeAmount = exchangeAmount;
        this._nineChroniclesTxId = nineChroniclesTxId;
        this._ethereumTransactionHash = ethereumTransactionHash;
        this._fee = fee;
        this._refundAmount = refundAmount;
        this._refundTxId = refundTxId;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        const refundFields =
            this._refundAmount !== null && this._refundTxId !== null
                ? [
                      {
                          title: "refund amount",
                          value: this._refundAmount,
                      },
                      {
                          title: "refund transaction",
                          value: this.toExplorerUrl(this._refundTxId),
                      },
                  ]
                : [];
        return {
            text: "NCG → wNCG event occurred.",
            attachments: [
                {
                    author_name: "Bridge Event",
                    color: "#42f5aa",
                    fields: [
                        {
                            title: "9c network transaction",
                            value: this.toExplorerUrl(this._nineChroniclesTxId),
                        },
                        {
                            title: "Ethereum network transaction",
                            value: this.toEtherscanUrl(
                                this._ethereumTransactionHash
                            ),
                        },
                        {
                            title: "sender (NineChronicles)",
                            value: this._sender,
                        },
                        {
                            title: "recipient (Ethereum)",
                            value: this._recipient,
                        },
                        {
                            title: "amount",
                            value: this._exchangeAmount,
                        },
                        {
                            title: "fee",
                            value: this._fee.toString(),
                        },
                        ...refundFields,
                    ],
                    fallback: `NCG ${this._sender} → wNCG ${this._recipient}`,
                },
            ],
        };
    }
}
