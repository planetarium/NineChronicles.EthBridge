import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { ForceOmit } from "../types/force-omit";
import { TxId } from "../types/txid";

export class WrappingRetryIgnoreEvent implements Message {
    private readonly _txId: string;

    constructor(txId: TxId) {
        this._txId = txId;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: "NCG → wNCG event already seems executed so it skipped.",
            attachments: [
                {
                    author_name: "Bridge Warning",
                    color: "#ffcc00",
                    fields: [
                        {
                            title: "9c network transaction id",
                            value: this._txId,
                        },
                    ],
                    fallback: `NCG → wNCG event already seems executed so it skipped.`,
                },
            ],
        };
    }
}
