import { IObserver } from ".";
import { BlockHash } from "../types/block-hash";
import { EventData } from "web3-eth-contract";
import { TransactionLocation } from "../types/transaction-location";
import { BurnEventResult } from "../types/burn-event-result";
import { INCGTransfer } from "../interfaces/ncg-transfer";
import { OpenSearchClient } from "../opensearch-client";
import { IMonitorStateStore } from "../interfaces/monitor-state-store";
import { UnwrappedEvent } from "../messages/unwrapped-event";
import Decimal from "decimal.js";
import { UnwrappingFailureEvent } from "../messages/unwrapping-failure-event";
import { Integration } from "../integrations";
import { ISlackMessageSender } from "../interfaces/slack-message-sender";

export class EthereumBurnEventObserver
    implements
        IObserver<{
            blockHash: BlockHash;
            events: (EventData & TransactionLocation)[];
        }>
{
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _opensearchClient: OpenSearchClient;
    private readonly _slackMessageSender: ISlackMessageSender;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _explorerUrl: string;
    private readonly _etherscanUrl: string;
    private readonly _integration: Integration;

    constructor(
        ncgTransfer: INCGTransfer,
        slackMessageSender: ISlackMessageSender,
        opensearchClient: OpenSearchClient,
        monitorStateStore: IMonitorStateStore,
        explorerUrl: string,
        etherscanUrl: string,
        integration: Integration
    ) {
        this._ncgTransfer = ncgTransfer;
        this._slackMessageSender = slackMessageSender;
        this._opensearchClient = opensearchClient;
        this._monitorStateStore = monitorStateStore;
        this._explorerUrl = explorerUrl;
        this._etherscanUrl = etherscanUrl;
        this._integration = integration;
    }

    async notify(data: {
        blockHash: BlockHash;
        events: (EventData & TransactionLocation)[];
    }): Promise<void> {
        const { blockHash, events } = data;
        if (events.length === 0) {
            await this._monitorStateStore.store("ethereum", {
                blockHash,
                txId: null,
            });
        }

        for (const { returnValues, transactionHash, blockHash } of events) {
            const {
                _sender: sender,
                _to,
                amount: burnedWrappedNcgAmountString,
            } = returnValues as BurnEventResult;
            const recipient = _to.substring(0, 42);
            const amount = new Decimal(burnedWrappedNcgAmountString).div(
                new Decimal(10).pow(18)
            );
            const amountString = amount.toFixed(2, Decimal.ROUND_DOWN);

            try {
                console.log("Process Ethereum transaction", transactionHash);
                const nineChroniclesTxId = await this._ncgTransfer.transfer(
                    recipient,
                    amountString,
                    transactionHash
                );

                await this._monitorStateStore.store("ethereum", {
                    blockHash,
                    txId: transactionHash,
                });
                await this._slackMessageSender.sendMessage(
                    new UnwrappedEvent(
                        this._explorerUrl,
                        this._etherscanUrl,
                        sender,
                        recipient,
                        amountString,
                        nineChroniclesTxId,
                        transactionHash
                    ).render()
                );
                await this._opensearchClient.to_opensearch("info", {
                    content: "wNCG -> NCG request success",
                    libplanetTxId: nineChroniclesTxId,
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: recipient,
                    amount: amount.toNumber(),
                });
                console.log("Transferred", nineChroniclesTxId);
            } catch (e) {
                await this._slackMessageSender.sendMessage(
                    new UnwrappingFailureEvent(
                        this._etherscanUrl,
                        sender,
                        recipient,
                        amountString,
                        transactionHash,
                        String(e)
                    ).render()
                );
                await this._opensearchClient.to_opensearch("error", {
                    content: "wNCG -> NCG request failure",
                    cause: String(e),
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: recipient,
                    amount: amount.toNumber(),
                });
                await this._integration.error(
                    "Unexpected error during unwrapping NCG",
                    {
                        errorMessage: String(e),
                        sender,
                        recipient,
                        transactionHash,
                        amountString,
                    }
                );
            }
        }
    }
}
