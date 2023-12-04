import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { TxId } from "../types/txid";
import { Address } from "../types/address";
import { ForceOmit } from "../types/force-omit";
import { combineUrl } from "./utils";

export class UnwrappingFailureEvent implements Message {
    private readonly _url: string;
    private readonly _sender: Address;
    private readonly _recipient: Address;
    private readonly _txId: TxId;
    private readonly _amount: string;
    private readonly _error: string;
    private readonly _planetName: string;
    private readonly _subscribers: string;

    constructor(
        url: string,
        sender: Address,
        recipient: Address,
        amount: string,
        txId: TxId,
        error: string,
        planetName: string,
        subscribers: string
    ) {
        this._url = url;
        this._sender = sender;
        this._recipient = recipient;
        this._amount = amount;
        this._txId = txId;
        this._error = error;
        this._planetName = planetName;
        this._subscribers = subscribers;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: `wNCG → NCG event failed. ${this._subscribers}`,
            attachments: [
                {
                    author_name: "Bridge Error",
                    color: "#ff0033",
                    fields: [
                        {
                            title: "Ethereum transaction",
                            value: combineUrl(this._url, `/tx/${this._txId}`),
                        },
                        {
                            title: "sender (Ethereum)",
                            value: this._sender,
                        },
                        {
                            title: "recipient (NineChronicles)",
                            value: this._recipient,
                        },
                        {
                            title: "amount",
                            value: this._amount,
                        },
                        {
                            title: "Planet Name",
                            value: this._planetName,
                        },
                        {
                            title: "error",
                            value: this._error,
                        },
                    ],
                    fallback: `wNCG ${this._sender} → NCG ${this._recipient} failed`,
                },
            ],
        };
    }
}
