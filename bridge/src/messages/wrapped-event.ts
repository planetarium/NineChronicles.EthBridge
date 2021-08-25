import { ChatPostMessageArguments } from "@slack/web-api";
import { WrappingEvent } from "./wrapping-event";
import { Address } from "../types/address";
import { TxId } from "../types/txid";
import Decimal from "decimal.js";

export class WrappedEvent extends WrappingEvent {
    private readonly _sender: Address;
    private readonly _recipient: Address;
    private readonly _nineChroniclesTxId: TxId;
    private readonly _ethereumTransactionHash: string;
    private readonly _amount: string;
    private readonly _fee: Decimal;

    constructor(
        explorerUrl: string,
        etherscanUrl: string,
        sender: Address,
        recipient: Address,
        amount: string,
        nineChroniclesTxId: TxId,
        ethereumTransactionHash: string,
        fee: Decimal
    ) {
        super(explorerUrl, etherscanUrl);

        this._sender = sender;
        this._recipient = recipient;
        this._amount = amount;
        this._nineChroniclesTxId = nineChroniclesTxId;
        this._ethereumTransactionHash = ethereumTransactionHash;
        this._fee = fee;
    }

    render(): Partial<ChatPostMessageArguments> {
        return {
            text: "NCG → wNCG event occurred.",
            attachments: [
                {
                    author_name: 'Bridge Event',
                    color: "#42f5aa",
                    fields: [
                        {
                            title: "9c network transaction",
                            value: this.toExplorerUrl(this._nineChroniclesTxId),
                        },
                        {
                            title: "Ethereum network transaction",
                            value: this.toEtherscanUrl(this._ethereumTransactionHash),
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
                            value: this._amount
                        },
                        {
                            title: "fee",
                            value: this._fee.toString()
                        }
                    ],
                    fallback: `NCG ${this._sender} → wNCG ${this._recipient}`
                }
            ]
        }
    }
}
