import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { ForceOmit } from "../types/force-omit";
import { TxId } from "../types/txid";

export class UnwrappingRetryIgnoreEvent implements Message {
    private readonly _txId: string;

    constructor(txId: TxId) {
        this._txId = txId;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        return {
            text: "wNCG → NCG event already seems executed so it skipped.",
            attachments: [
                {
                    author_name: "Bridge Warning",
                    color: "#ffcc00",
                    fields: [
                        {
                            title: "Ethereum network transaction id",
                            value: this._txId,
                        },
                    ],
                    fallback: `wNCG → NCG event already seems executed so it skipped.`,
                },
            ],
        };
    }
}
