import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { TxId } from "../types/txid";
import { Address } from "../types/address";
import { ForceOmit } from "../types/force-omit";
import { combineNcExplorerUrl } from "./utils";

export class WrappingFailureEvent implements Message {
    private readonly _url: string;
    private readonly _ncscanUrl: string | undefined;
    private readonly _useNcscan: boolean;
    private readonly _sender: Address;
    private readonly _recipient: Address;
    private readonly _txId: TxId;
    private readonly _amount: string;
    private readonly _error: string;
    private readonly _subscribers: string;

    constructor(
        url: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        sender: Address,
        recipient: Address,
        amount: string,
        txId: TxId,
        error: string,
        subscribers: string
    ) {
        this._url = url;
        this._ncscanUrl = ncscanUrl;
        this._useNcscan = useNcscan;
        this._sender = sender;
        this._recipient = recipient;
        this._amount = amount;
        this._txId = txId;
        this._error = error;
        this._subscribers = subscribers;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: `NCG → wNCG event failed. ${this._subscribers}`,
            attachments: [
                {
                    author_name: "Bridge Error",
                    color: "#ff0033",
                    fields: [
                        {
                            title: "9c network transaction",
                            value: combineNcExplorerUrl(
                                this._url,
                                this._ncscanUrl,
                                this._useNcscan,
                                this._txId
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
                            value: this._amount,
                        },
                        {
                            title: "error",
                            value: this._error,
                        },
                    ],
                    fallback: `NCG ${this._sender} → wNCG ${this._recipient} failed`,
                },
            ],
        };
    }
}
