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
import { IExchangeHistoryStore } from "../interfaces/exchange-history-store";
import { UnwrappingRetryIgnoreEvent } from "../messages/unwrapping-retry-ignore-event";
import { SpreadsheetClient } from "../spreadsheet-client";
import { MultiPlanetary } from "../multi-planetary";
import { TransactionStatus } from "../types/transaction-status";

export class EthereumBurnEventObserver
    implements
        IObserver<{
            blockHash: BlockHash;
            events: (EventData & TransactionLocation)[];
        }>
{
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _opensearchClient: OpenSearchClient;
    private readonly _spreadsheetClient: SpreadsheetClient;
    private readonly _slackMessageSender: ISlackMessageSender;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _exchangeHistoryStore: IExchangeHistoryStore;
    private readonly _explorerUrl: string;
    private readonly _ncscanUrl: string | undefined;
    private readonly _useNcscan: boolean;
    private readonly _etherscanUrl: string;
    private readonly _integration: Integration;
    private readonly _multiPlanetary: MultiPlanetary;
    private readonly _failureSubscribers: string;
    private readonly _opensearchClientMigration: OpenSearchClient;
    constructor(
        ncgTransfer: INCGTransfer,
        slackMessageSender: ISlackMessageSender,
        opensearchClient: OpenSearchClient,
        spreadsheetClient: SpreadsheetClient,
        monitorStateStore: IMonitorStateStore,
        exchangeHistoryStore: IExchangeHistoryStore,
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string,
        integration: Integration,
        multiPlanetary: MultiPlanetary,
        failureSubscribers: string,
        opensearchClientMigration: OpenSearchClient
    ) {
        this._ncgTransfer = ncgTransfer;
        this._slackMessageSender = slackMessageSender;
        this._opensearchClient = opensearchClient;
        this._spreadsheetClient = spreadsheetClient;
        this._monitorStateStore = monitorStateStore;
        this._exchangeHistoryStore = exchangeHistoryStore;
        this._explorerUrl = explorerUrl;
        this._ncscanUrl = ncscanUrl;
        this._useNcscan = useNcscan;
        this._etherscanUrl = etherscanUrl;
        this._integration = integration;
        this._multiPlanetary = multiPlanetary;
        this._failureSubscribers = failureSubscribers;
        this._opensearchClientMigration = opensearchClientMigration;
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

            // Added logging for checking _to arg
            console.log("_to", _to);

            const isMultiPlanetRequestType =
                this._multiPlanetary.isMultiPlanetRequestType(_to);

            const requestPlanetName =
                this._multiPlanetary.getRequestPlanetName(_to);

            const user9cAddress = isMultiPlanetRequestType
                ? "0x" + _to.substring(14, 54)
                : _to.substring(0, 42);

            const amount = new Decimal(burnedWrappedNcgAmountString).div(
                new Decimal(10).pow(18)
            );
            const amountString = amount.toFixed(2, Decimal.ROUND_DOWN);

            if (await this._exchangeHistoryStore.exist(transactionHash)) {
                this._slackMessageSender.sendMessage(
                    new UnwrappingRetryIgnoreEvent(transactionHash)
                );
                this._opensearchClient.to_opensearch("error", {
                    content: "wNCG -> NCG request failure",
                    cause: "Exchange history exist",
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amountString,
                });
                this._opensearchClientMigration.to_opensearch("error", {
                    content: "wNCG -> NCG request failure",
                    cause: "Exchange history exist",
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amountString,
                });
                continue;
            }

            await this._exchangeHistoryStore.put({
                network: "ethereum",
                tx_id: transactionHash,
                sender,
                recipient: user9cAddress,
                timestamp: new Date().toISOString(),
                amount: parseFloat(amountString),
                status: TransactionStatus.PENDING,
            });

            try {
                console.log("Process Ethereum transaction", transactionHash);
                const isMainPlanetRequest =
                    this._multiPlanetary.isMainPlanetRequest(requestPlanetName);
                if (!isMainPlanetRequest) {
                    console.log(`Send to other planet - ${requestPlanetName}`);
                }
                /**
                 * If User send wNCG to other planet
                 * recipient is other planet's vault address.
                 * memo is user's other planet's 9c Address.
                 */
                const recipient =
                    isMultiPlanetRequestType && !isMainPlanetRequest
                        ? this._multiPlanetary.getPlanetVaultAddress(
                              requestPlanetName
                          )
                        : user9cAddress;

                const memo = isMainPlanetRequest
                    ? transactionHash
                    : user9cAddress;

                // Added logging for checking args
                console.log({
                    recipient,
                    memo,
                    amountString,
                });

                const nineChroniclesTxId = await this._ncgTransfer.transfer(
                    recipient,
                    amountString,
                    memo
                );

                await this._monitorStateStore.store("ethereum", {
                    blockHash,
                    txId: transactionHash,
                });
                await this._slackMessageSender.sendMessage(
                    new UnwrappedEvent(
                        this._explorerUrl,
                        this._ncscanUrl,
                        this._useNcscan,
                        this._etherscanUrl,
                        sender,
                        user9cAddress,
                        amountString,
                        nineChroniclesTxId,
                        transactionHash,
                        isMultiPlanetRequestType,
                        requestPlanetName
                    )
                );
                this._exchangeHistoryStore.updateStatus(
                    transactionHash,
                    TransactionStatus.COMPLETED
                );
                await this._opensearchClient.to_opensearch("info", {
                    content: "wNCG -> NCG request success",
                    libplanetTxId: nineChroniclesTxId,
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amount.toNumber(),
                    planetName: requestPlanetName,
                    network: "ETH",
                });
                await this._opensearchClientMigration.to_opensearch("info", {
                    content: "wNCG -> NCG request success",
                    libplanetTxId: nineChroniclesTxId,
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amount.toNumber(),
                    planetName: requestPlanetName,
                    network: "ETH",
                });
                console.log("Transferred", nineChroniclesTxId);
            } catch (e) {
                const slackMsgRes = await this._slackMessageSender.sendMessage(
                    new UnwrappingFailureEvent(
                        this._etherscanUrl,
                        sender,
                        user9cAddress,
                        amountString,
                        transactionHash,
                        String(e),
                        requestPlanetName,
                        this._failureSubscribers
                    )
                );

                await this._spreadsheetClient.to_spreadsheet_burn({
                    slackMessageId: `${
                        slackMsgRes?.channel
                    }/p${slackMsgRes?.ts?.replace(".", "")}`,
                    url: this._etherscanUrl,
                    txId: transactionHash,
                    sender,
                    recipient: String(user9cAddress),
                    amount: amountString,
                    planetName: requestPlanetName,
                    error: String(e),
                });

                await this._opensearchClient.to_opensearch("error", {
                    content: "wNCG -> NCG request failure",
                    cause: String(e),
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amount.toNumber(),
                    planetName: requestPlanetName,
                    network: "ETH",
                });
                await this._opensearchClientMigration.to_opensearch("error", {
                    content: "wNCG -> NCG request failure",
                    cause: String(e),
                    ethereumTxId: transactionHash,
                    sender: sender,
                    recipient: user9cAddress,
                    amount: amount.toNumber(),
                    planetName: requestPlanetName,
                    network: "ETH",
                });
                await this._integration.error(
                    "Unexpected error during unwrapping NCG",
                    {
                        errorMessage: String(e),
                        sender,
                        user9cAddress,
                        transactionHash,
                        amountString,
                    }
                );
            }
        }
    }
}
