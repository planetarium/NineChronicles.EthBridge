import { IObserver } from ".";
import { NCGTransferredEvent } from "../types/ncg-transferred-event";
import { INCGTransfer } from "../interfaces/ncg-transfer";
import { isAddress } from "web3-utils";
import { IWrappedNCGMinter } from "../interfaces/wrapped-ncg-minter";
import { OpenSearchClient } from "../opensearch-client";
import { IMonitorStateStore } from "../interfaces/monitor-state-store";
import { TransactionLocation } from "../types/transaction-location";
import { BlockHash } from "../types/block-hash";
import { WrappedEvent } from "../messages/wrapped-event";
import { RefundEvent } from "../messages/refund-event";
import Decimal from "decimal.js";
import { WrappingFailureEvent } from "../messages/wrapping-failure-event";
import { WrappingRetryIgnoreEvent } from "../messages/wrapping-retry-ignore-event";
import { IExchangeHistoryStore } from "../interfaces/exchange-history-store";
import { IAddressBanPolicy } from "../policies/address-ban";
import { Integration } from "../integrations";
import { ISlackMessageSender } from "../interfaces/slack-message-sender";
import { IExchangeFeeRatioPolicy } from "../policies/exchange-fee-ratio";

// See also https://ethereum.github.io/yellowpaper/paper.pdf 4.2 The Transaction section.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isValidAddress(address: string): boolean {
    return (
        address.startsWith("0x") &&
        isAddress(address) &&
        address !== ZERO_ADDRESS
    );
}

interface LimitationPolicy {
    maximum: number;
    minimum: number;
}

interface BaseFeePolicy {
    criterion: number;
    fee: number;
}

export class NCGTransferredEventObserver
    implements
        IObserver<{
            blockHash: BlockHash;
            events: (NCGTransferredEvent & TransactionLocation)[];
        }>
{
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _wrappedNcgTransfer: IWrappedNCGMinter;
    private readonly _opensearchClient: OpenSearchClient;
    private readonly _slackMessageSender: ISlackMessageSender;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _exchangeHistoryStore: IExchangeHistoryStore;
    private readonly _explorerUrl: string;
    private readonly _ncscanUrl: string | undefined;
    private readonly _useNcscan: boolean;
    private readonly _etherscanUrl: string;
    /**
     * The fee ratio requried to exchange. This should be float value like 0.01.
     */
    private readonly _exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy;
    private readonly _baseFeePolicy: BaseFeePolicy;
    private readonly _limitationPolicy: LimitationPolicy;
    private readonly _addressBanPolicy: IAddressBanPolicy;

    private readonly _integration: Integration;

    constructor(
        ncgTransfer: INCGTransfer,
        wrappedNcgTransfer: IWrappedNCGMinter,
        slackMessageSender: ISlackMessageSender,
        opensearchClient: OpenSearchClient,
        monitorStateStore: IMonitorStateStore,
        exchangeHistoryStore: IExchangeHistoryStore,
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string,
        exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy,
        baseFeePolicy: BaseFeePolicy,
        limitationPolicy: LimitationPolicy,
        addressBanPolicy: IAddressBanPolicy,
        integration: Integration
    ) {
        this._ncgTransfer = ncgTransfer;
        this._wrappedNcgTransfer = wrappedNcgTransfer;
        this._slackMessageSender = slackMessageSender;
        this._opensearchClient = opensearchClient;
        this._monitorStateStore = monitorStateStore;
        this._exchangeHistoryStore = exchangeHistoryStore;
        this._explorerUrl = explorerUrl;
        this._ncscanUrl = ncscanUrl;
        this._useNcscan = useNcscan;
        this._etherscanUrl = etherscanUrl;
        this._exchangeFeeRatioPolicy = exchangeFeeRatioPolicy;
        this._baseFeePolicy = baseFeePolicy;
        this._limitationPolicy = limitationPolicy;
        this._addressBanPolicy = addressBanPolicy;
        this._integration = integration;
    }

    async notify(data: {
        blockHash: BlockHash;
        events: (NCGTransferredEvent & TransactionLocation)[];
    }): Promise<void> {
        const { blockHash, events } = data;

        let recorded = false;
        for (const {
            blockHash,
            txId,
            sender,
            amount: amountString,
            memo: recipient,
        } of events) {
            try {
                console.log("Process NineChronicles transaction", txId);

                if (this._addressBanPolicy.isBannedAddress(sender)) {
                    continue;
                }

                if (await this._exchangeHistoryStore.exist(txId)) {
                    this._slackMessageSender.sendMessage(
                        new WrappingRetryIgnoreEvent(txId)
                    );
                    this._opensearchClient.to_opensearch("error", {
                        content: "NCG -> wNCG request failure",
                        cause: "Exchange history exist",
                        libplanetTxId: txId,
                        sender: sender,
                        recipient: recipient,
                        amount: amountString,
                    });
                    continue;
                }

                const decimals = new Decimal(10).pow(18);
                const amount = new Decimal(amountString);
                const minimum = new Decimal(this._limitationPolicy.minimum);
                const maximum = new Decimal(this._limitationPolicy.maximum);
                const transferredAmountInLast24Hours = new Decimal(
                    await this._exchangeHistoryStore.transferredAmountInLast24Hours(
                        "nineChronicles",
                        sender
                    )
                );
                const maxExchangableAmount = maximum.sub(
                    transferredAmountInLast24Hours
                );
                const limitedAmount: Decimal = Decimal.min(
                    maxExchangableAmount,
                    amount
                );

                const lessThanMinimum = amount.cmp(minimum) === -1;
                const alreadyExchangedUptoMaximum =
                    transferredAmountInLast24Hours.cmp(maximum) >= 0;
                const overflowedExchangeAmount =
                    !alreadyExchangedUptoMaximum &&
                    transferredAmountInLast24Hours.add(amount).cmp(maximum) ===
                        1;

                const isInvalidRecipient =
                    recipient === null || !isValidAddress(recipient);
                const isInvalidAmount = !amount.isFinite() || amount.isNaN();
                const isInvalidTx = isInvalidRecipient || isInvalidAmount;

                const isExchangableTx =
                    !isInvalidTx &&
                    !lessThanMinimum &&
                    !alreadyExchangedUptoMaximum;

                await this._monitorStateStore.store("nineChronicles", {
                    blockHash,
                    txId,
                });
                recorded = true;
                await this._exchangeHistoryStore.put({
                    network: "nineChronicles",
                    tx_id: txId,
                    sender,
                    recipient: recipient ?? "",
                    timestamp: new Date().toISOString(),
                    amount: isExchangableTx ? limitedAmount.toNumber() : 0,
                });

                if (isInvalidTx) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(
                        sender,
                        amountString,
                        "I'm bridge and you should transfer with memo, valid ethereum address to receive."
                    );
                    await this._slackMessageSender.sendMessage(
                        new RefundEvent(
                            this._explorerUrl,
                            this._ncscanUrl,
                            this._useNcscan,
                            sender,
                            txId,
                            amount,
                            nineChroniclesTxId,
                            amount,
                            `The memo(${recipient}) is invalid.`
                        )
                    );
                    this._opensearchClient.to_opensearch("error", {
                        content: "NCG -> wNCG request failure",
                        cause: "Invalid 9c transaction ID",
                        libplanetTxId: txId,
                        sender: sender,
                        recipient: recipient,
                        amount: amount.toNumber(),
                    });
                    console.log(
                        "Valid memo doesn't exist so refund NCG. The transaction's id is",
                        nineChroniclesTxId
                    );
                    continue;
                }

                if (amount.eq(0)) {
                    console.log(
                        "It doesn't need any operation because amount is 0."
                    );
                    continue;
                }

                if (lessThanMinimum) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(
                        sender,
                        amountString,
                        `I'm bridge and you should transfer more NCG than ${this._limitationPolicy.minimum}.`
                    );
                    await this._slackMessageSender.sendMessage(
                        new RefundEvent(
                            this._explorerUrl,
                            this._ncscanUrl,
                            this._useNcscan,
                            sender,
                            txId,
                            amount,
                            nineChroniclesTxId,
                            amount,
                            `The amount(${amountString}) is less than ${this._limitationPolicy.minimum}`
                        )
                    );
                    this._opensearchClient.to_opensearch("error", {
                        content: "NCG -> wNCG request failure",
                        cause: `Less than minimum transferable amount (${this._limitationPolicy.minimum})`,
                        libplanetTxId: txId,
                        sender: sender,
                        recipient: recipient,
                        amount: amount.toNumber(),
                    });
                    console.log(
                        `The amount(${amountString}) is less than ${this._limitationPolicy.minimum} so refund NCG. The transaction's id is`,
                        nineChroniclesTxId
                    );
                    continue;
                }

                // NOTE x.cmp(y) returns -1, means x < y.
                if (alreadyExchangedUptoMaximum) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(
                        sender,
                        amountString,
                        `I'm bridge and you can exchange until ${this._limitationPolicy.maximum} for 24 hours.`
                    );
                    await this._slackMessageSender.sendMessage(
                        new RefundEvent(
                            this._explorerUrl,
                            this._ncscanUrl,
                            this._useNcscan,
                            sender,
                            txId,
                            amount,
                            nineChroniclesTxId,
                            amount,
                            `${sender} already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${amountString}.`
                        )
                    );
                    this._opensearchClient.to_opensearch("error", {
                        content: "NCG -> wNCG request failure",
                        cause: `24 hr transfer maximum ${this._limitationPolicy.maximum} reached. User transferred ${transferredAmountInLast24Hours} NCGs in 24 hrs.`,
                        libplanetTxId: txId,
                        sender: sender,
                        recipient: recipient,
                        amount: amount.toNumber(),
                    });
                    console.log(
                        `${sender} already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${amountString}. The transaction's id is`,
                        nineChroniclesTxId
                    );
                    continue;
                }

                let refundAmount: string | null = null;
                let refundTxId: string | null = null;

                if (overflowedExchangeAmount) {
                    // Should equal with amount - limitedAmount
                    const refundAmount = transferredAmountInLast24Hours
                        .add(amount)
                        .sub(maximum);
                    const refundAmountString = refundAmount.toString();
                    refundTxId = await this._ncgTransfer.transfer(
                        sender,
                        refundAmountString,
                        `I'm bridge and you should transfer less NCG than ${this._limitationPolicy.maximum}.`
                    );
                    await this._slackMessageSender.sendMessage(
                        new RefundEvent(
                            this._explorerUrl,
                            this._ncscanUrl,
                            this._useNcscan,
                            sender,
                            txId,
                            amount,
                            refundTxId,
                            new Decimal(refundAmount),
                            `${sender} tried to exchange ${amountString} and already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${refundAmount}`
                        )
                    );
                    this._opensearchClient.to_opensearch("error", {
                        content: "NCG -> wNCG request failure",
                        cause: `24 hr transfer maximum ${this._limitationPolicy.maximum} reached. User transferred ${transferredAmountInLast24Hours} NCGs in 24 hrs.`,
                        libplanetTxId: txId,
                        refundTxId: refundTxId,
                        refundAmount: refundAmount.toNumber(),
                        sender: sender,
                        recipient: recipient,
                        amount: amount.toNumber(),
                    });
                    console.log(
                        `${sender} tried to exchange ${amountString} and already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${refundAmount}. The transaction's id is`,
                        refundTxId
                    );
                }

                const exchangeFeeRatio =
                    this._exchangeFeeRatioPolicy.getFee(sender);
                if (exchangeFeeRatio === false) {
                    throw new Error(
                        `Failed to get exchange fee ratio for ${sender}`
                    );
                }

                /**
                 * If exchangeFeeRatio == 0.01 (1%), it exchanges only 0.99 (= 1 - 0.01 = 99%) of amount.
                 * Applied Base Fee Policy, base Fee = 10 when Transfer( NCG -> WNCG ) under 1000 NCG
                 */
                const fee = limitedAmount.greaterThanOrEqualTo(new Decimal(this._baseFeePolicy.criterion))
                    ? new Decimal(limitedAmount.mul(exchangeFeeRatio).toFixed(2))
                    : new Decimal(this._baseFeePolicy.fee);
                const exchangeAmount = limitedAmount.sub(fee);
                const ethereumExchangeAmount = exchangeAmount.mul(decimals);

                console.log("limitedAmount", limitedAmount);
                console.log("fee", fee);
                console.log("exchangeAmount", exchangeAmount);

                // FIXME: Hard-coded.
                let transactionHash;
                // https://explorer.libplanet.io/9c-main/block/?52573abd5e04d933a84f171745ce39c1d3e17cefe8aab12f62172f7710a3bd01
                if (
                    blockHash ===
                    "52573abd5e04d933a84f171745ce39c1d3e17cefe8aab12f62172f7710a3bd01"
                ) {
                    transactionHash =
                        "0x79eb4190dddc6f25807e6f6fc8c4311e45e5882463ecaf5c07c85fe8bc4b3760";
                    // https://explorer.libplanet.io/9c-main/block/?4a3e74ffb45a317085c5bde76159069db42ff04d45f62d64cbac4ac1e5ec503c
                } else if (
                    blockHash ===
                    "4a3e74ffb45a317085c5bde76159069db42ff04d45f62d64cbac4ac1e5ec503c"
                ) {
                    transactionHash =
                        "0xc60146f55fd24323de2e2efbd66743317ac9601aa648daf9d78069661635c306";
                } else {
                    const txHash = await this._wrappedNcgTransfer.mint(
                        recipient!,
                        ethereumExchangeAmount
                    );
                    transactionHash = txHash;
                }

                console.log("Receipt", transactionHash);
                await this._slackMessageSender.sendMessage(
                    new WrappedEvent(
                        this._explorerUrl,
                        this._ncscanUrl,
                        this._useNcscan,
                        this._etherscanUrl,
                        sender,
                        recipient!,
                        exchangeAmount.toString(),
                        txId,
                        transactionHash,
                        fee,
                        refundAmount,
                        refundTxId
                    )
                );
                await this._opensearchClient.to_opensearch("info", {
                    content: "NCG -> wNCG request success",
                    libplanetTxId: txId,
                    ethereumTxId: transactionHash,
                    fee: fee.toNumber(),
                    sender: sender,
                    recipient: recipient,
                    amount: exchangeAmount.toNumber(),
                });
            } catch (e) {
                console.log("EERRRR", e);
                let errorMessage: string;
                if (e instanceof Error) {
                    errorMessage = String(e);
                } else {
                    errorMessage = JSON.stringify(e);
                }

                // TODO: it should be replaced with `Integration` Slack implementation.
                await this._slackMessageSender.sendMessage(
                    new WrappingFailureEvent(
                        this._explorerUrl,
                        this._ncscanUrl,
                        this._useNcscan,
                        sender,
                        String(recipient),
                        amountString,
                        txId,
                        errorMessage
                    )
                );
                await this._opensearchClient.to_opensearch("error", {
                    content: "NCG -> wNCG request failure",
                    cause: errorMessage,
                    libplanetTxId: txId,
                    sender: sender,
                    recipient: recipient,
                    amount: amountString,
                });
                await this._integration.error(
                    "Unexpected error during wrapping NCG",
                    {
                        errorMessage,
                        sender,
                        recipient,
                        txId,
                        amountString,
                    }
                );
            }
        }

        if (!recorded) {
            await this._monitorStateStore.store("nineChronicles", {
                blockHash,
                txId: null,
            });
        }
    }
}
