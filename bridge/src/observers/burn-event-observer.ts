import { IObserver } from ".";
import { BlockHash } from "../types/block-hash";
import { EventData } from 'web3-eth-contract';
import { TransactionLocation } from "../types/transaction-location";
import { BurnEventResult } from "../types/burn-event-result";
import { INCGTransfer } from "../interfaces/ncg-transfer";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { IMonitorStateStore } from "../interfaces/monitor-state-store";
import { UnwrappedEvent } from "../messages/unwrapped-event";

export class EthereumBurnEventObserver implements IObserver<{ blockHash: BlockHash, events: (EventData & TransactionLocation)[] }> {
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _slackWebClient: SlackWebClient;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _explorerUrl: string;
    private readonly _etherscanUrl: string;

    constructor(ncgTransfer: INCGTransfer, slackWebClient: SlackWebClient, monitorStateStore: IMonitorStateStore, explorerUrl: string, etherscanUrl: string) {
        this._ncgTransfer = ncgTransfer;
        this._slackWebClient = slackWebClient;
        this._monitorStateStore = monitorStateStore;
        this._explorerUrl = explorerUrl;
        this._etherscanUrl = etherscanUrl;
    }

    async notify(data: { blockHash: BlockHash; events: (EventData & TransactionLocation)[]; }): Promise<void> {
        const { blockHash, events } = data;
        if (events.length === 0) {
            await this._monitorStateStore.store("ethereum", { blockHash, txId: null });
        }

        for (const { returnValues, transactionHash, blockHash } of events) {
            const { _sender: sender, _to, amount } = returnValues as BurnEventResult;
            const recipient = _to.substring(0, 42);
            const nineChroniclesTxId = await this._ncgTransfer.transfer(recipient, amount, null);
            await this._monitorStateStore.store("ethereum", { blockHash, txId: transactionHash });
            await this._slackWebClient.chat.postMessage({
                channel: "#nine-chronicles-bridge-bot",
                ...new UnwrappedEvent(this._explorerUrl, this._etherscanUrl, sender, recipient, amount, nineChroniclesTxId, transactionHash).render()
            });
            console.log("Transferred", transactionHash);
        }
    }
}
