import { ChatPostMessageArguments } from "@slack/web-api";
import { Message } from ".";
import { TxId } from "../types/txid";
import { URL } from "url";
import { join, resolve } from "path";
import { ForceOmit } from "../types/force-omit";
import { combineNcExplorerUrl, combineUrl } from "./utils";

export abstract class WrappingEvent implements Message {
    private readonly _explorerUrl: string;
    private readonly _ncscanUrl: string | undefined;
    protected readonly _useNcscan: boolean;
    private readonly _etherscanUrl: string;

    constructor(
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string
    ) {
        this._explorerUrl = explorerUrl;
        this._ncscanUrl = ncscanUrl;
        this._useNcscan = useNcscan;
        this._etherscanUrl = etherscanUrl;
    }

    abstract render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel">;

    protected toExplorerUrl(txId: TxId): string {
        return combineNcExplorerUrl(
            this._explorerUrl,
            this._ncscanUrl,
            this._useNcscan,
            txId
        );
    }

    protected toEtherscanUrl(transactionHash: string): string {
        return combineUrl(this._etherscanUrl, `/tx/${transactionHash}`);
    }
}
