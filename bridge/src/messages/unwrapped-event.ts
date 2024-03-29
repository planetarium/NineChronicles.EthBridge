import { ChatPostMessageArguments } from "@slack/web-api";
import { WrappingEvent } from "./wrapping-event";
import { Address } from "../types/address";
import { TxId } from "../types/txid";
import { ForceOmit } from "../types/force-omit";

export class UnwrappedEvent extends WrappingEvent {
    private readonly _sender: Address;
    private readonly _recipient: Address;
    private readonly _nineChroniclesTxId: TxId;
    private readonly _ethereumTransactionHash: string;
    private readonly _amount: string;
    private readonly _isMultiPlanetRequestType: boolean;
    private readonly _planetName: string;

    constructor(
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string,
        sender: Address,
        recipient: Address,
        amount: string,
        nineChroniclesTxId: TxId,
        ethereumTransactionHash: string,
        isMultiPlanetRequestType: boolean,
        planetName: string
    ) {
        super(explorerUrl, ncscanUrl, useNcscan, etherscanUrl);

        this._sender = sender;
        this._recipient = recipient;
        this._amount = amount;
        this._nineChroniclesTxId = nineChroniclesTxId;
        this._ethereumTransactionHash = ethereumTransactionHash;
        this._planetName = planetName;
        this._isMultiPlanetRequestType = isMultiPlanetRequestType;
    }

    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel"> {
        const message = {
            text: "wNCG → NCG event occurred.",
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
                            title: "Planet-Name",
                            value: this._planetName,
                        },
                        {
                            title: "Network",
                            value: "Ethereum",
                        }
                    ],
                    fallback: `wNCG ${this._sender} → NCG ${this._recipient}`,
                },
            ],
        };

        if (!this._isMultiPlanetRequestType) {
            message.attachments[0].fields.push({
                title: "Not Multi-Planet Request Type",
                value: "This Transfer Request is not a multi-planet request type.",
            });
        }

        return message;
    }
}
