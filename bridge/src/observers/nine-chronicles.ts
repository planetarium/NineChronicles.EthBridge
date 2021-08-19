import { IObserver } from ".";
import { NCGTransferredEvent } from "../types/ncg-transferred-event";
import { INCGTransfer } from "../interfaces/ncg-transfer";
import { isAddress } from "web3-utils";
import { IWrappedNCGMinter } from "../interfaces/wrapped-ncg-minter";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { IMonitorStateStore } from "../interfaces/monitor-state-store";
import { TransactionLocation } from "../types/transaction-location";
import { BlockHash } from "../types/block-hash";
import { WrappedEvent } from "../messages/wrapped-event";
import Decimal from "decimal.js"
import { WrappingFailureEvent } from "../messages/wrapping-failure-event";

// See also https://ethereum.github.io/yellowpaper/paper.pdf 4.2 The Transaction section.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isValidAddress(address: string): boolean {
    return isAddress(address) && address !== ZERO_ADDRESS;
}

export class NCGTransferredEventObserver implements IObserver<{ blockHash: BlockHash, events: (NCGTransferredEvent & TransactionLocation)[] }> {
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _wrappedNcgTransfer: IWrappedNCGMinter;
    private readonly _slackWebClient: SlackWebClient;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _explorerUrl: string;
    private readonly _etherscanUrl: string;

    constructor(ncgTransfer: INCGTransfer, wrappedNcgTransfer: IWrappedNCGMinter, slackWebClient: SlackWebClient, monitorStateStore: IMonitorStateStore, explorerUrl: string, etherscanUrl: string) {
        this._ncgTransfer = ncgTransfer;
        this._wrappedNcgTransfer = wrappedNcgTransfer;
        this._slackWebClient = slackWebClient;
        this._monitorStateStore = monitorStateStore;
        this._explorerUrl = explorerUrl;
        this._etherscanUrl = etherscanUrl;
    }

    async notify(data: { blockHash: BlockHash, events: (NCGTransferredEvent & TransactionLocation)[] }): Promise<void> {
        const { blockHash, events } = data;

        if (events.length === 0) {
            await this._monitorStateStore.store("nineChronicles", { blockHash, txId: null });
        }

        for (const { blockHash, txId, sender, amount: amountString, memo: recipient, } of events) {
            try {
                const amount = new Decimal(amountString).mul(new Decimal(10).pow(18));
                if (recipient === null || !isValidAddress(recipient) || !amount.isFinite() || amount.isNaN()) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(sender, amountString, "I'm bridge and you should transfer with memo having ethereum address to receive.");
                    console.log("Valid memo doesn't exist so refund NCG. The transaction's id is", nineChroniclesTxId);
                    return;
                }

                const { transactionHash } = await this._wrappedNcgTransfer.mint(recipient, amount);
                console.log("Receipt", transactionHash);
                await this._monitorStateStore.store("nineChronicles", { blockHash, txId });
                await this._slackWebClient.chat.postMessage({
                    channel: "#nine-chronicles-bridge-bot",
                    ...new WrappedEvent(this._explorerUrl, this._etherscanUrl, sender, recipient, amountString, txId, transactionHash).render()
                });
            } catch (e) {
                console.log("EERRRR", e)
                await this._slackWebClient.chat.postMessage({
                    channel: "#nine-chronicles-bridge-bot",
                    ...new WrappingFailureEvent(this._explorerUrl, sender, String(recipient), amountString, txId, String(e)).render()
                });
            }
        }
    }
}
