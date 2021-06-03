import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { TxId } from "../types/txid";
import { URL } from "url";

export abstract class WrappingEvent implements Message {
    private readonly _explorerUrl: string;
    private readonly _etherscanUrl: string;

    constructor(explorerUrl: string, etherscanUrl: string) {
        this._explorerUrl = explorerUrl;
        this._etherscanUrl = etherscanUrl;
    }

    abstract render(): Partial<ChatPostMessageArguments>;

    protected toExplorerUrl(txId: TxId): string {
        return this.combineUrl(this._explorerUrl, `/transaction/?${txId}`);
    }

    protected toEtherscanUrl(transactionHash: string): string {
        return this.combineUrl(this._etherscanUrl, `/tx/${transactionHash}`);
    }

    private combineUrl(url: string, addition: string): string {
        return new URL(addition, url).toString();
    }
}
