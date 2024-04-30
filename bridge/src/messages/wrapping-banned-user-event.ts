import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { ForceOmit } from "../types/force-omit";
import { TxId } from "../types/txid";

export class WrappingBannedUserEvent implements Message {
    private readonly _txId: string;
    private readonly _sender: string;

    constructor(_sender: string, txId: TxId) {
        this._txId = txId;
        this._sender = _sender;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: "NCG → wNCG request ignored because the user is banned.",
            attachments: [
                {
                    author_name: "Bridge Warning",
                    color: "#ffcc00",
                    fields: [
                        {
                            title: "9c network transaction id",
                            value: this._txId,
                        },
                        {
                            title: "sender (NineChronicles)",
                            value: this._sender,
                        },
                    ],
                    fallback: `NCG → wNCG request ignored because the user is banned.`,
                },
            ],
        };
    }
}
