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
import { WrappingBannedUserEvent } from "../messages/wrapping-banned-user-event";
import { IExchangeHistoryStore } from "../interfaces/exchange-history-store";
import { IAddressBanPolicy } from "../policies/address-ban";
import { Integration } from "../integrations";
import { ISlackMessageSender } from "../interfaces/slack-message-sender";
import { IExchangeFeeRatioPolicy } from "../policies/exchange-fee-ratio";
import { ACCOUNT_TYPE } from "../whitelist/account-type";
import { WhitelistAccount } from "../types/whitelist-account";
import { SpreadsheetClient } from "../spreadsheet-client";

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
    whitelistMaximum: number;
    minimum: number;
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
    private readonly _spreadsheetClient: SpreadsheetClient;
    private readonly _slackMessageSender: ISlackMessageSender;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _exchangeHistoryStore: IExchangeHistoryStore;
    private readonly _explorerUrl: string;
    private readonly _ncscanUrl: string | undefined;
    private readonly _useNcscan: boolean;
    private readonly _etherscanUrl: string;
    private readonly _failureSubscribers: string;
    private readonly _exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy;
    private readonly _limitationPolicy: LimitationPolicy;
    private readonly _addressBanPolicy: IAddressBanPolicy;

    private readonly _integration: Integration;
    private readonly _whitelistAccounts: WhitelistAccount[];

    constructor(
        ncgTransfer: INCGTransfer,
        wrappedNcgTransfer: IWrappedNCGMinter,
        slackMessageSender: ISlackMessageSender,
        opensearchClient: OpenSearchClient,
        spreadsheetClient: SpreadsheetClient,
        monitorStateStore: IMonitorStateStore,
        exchangeHistoryStore: IExchangeHistoryStore,
        explorerUrl: string,
        ncscanUrl: string | undefined,
        useNcscan: boolean,
        etherscanUrl: string,
        exchangeFeeRatioPolicy: IExchangeFeeRatioPolicy,
        limitationPolicy: LimitationPolicy,
        addressBanPolicy: IAddressBanPolicy,
        integration: Integration,
        failureSubscribers: string,
        whitelistAccounts: WhitelistAccount[]
    ) {
        this._ncgTransfer = ncgTransfer;
        this._wrappedNcgTransfer = wrappedNcgTransfer;
        this._slackMessageSender = slackMessageSender;
        this._opensearchClient = opensearchClient;
        this._spreadsheetClient = spreadsheetClient;
        this._monitorStateStore = monitorStateStore;
        this._exchangeHistoryStore = exchangeHistoryStore;
        this._explorerUrl = explorerUrl;
        this._ncscanUrl = ncscanUrl;
        this._useNcscan = useNcscan;
        this._etherscanUrl = etherscanUrl;
        this._exchangeFeeRatioPolicy = exchangeFeeRatioPolicy;
        this._limitationPolicy = limitationPolicy;
        this._addressBanPolicy = addressBanPolicy;
        this._integration = integration;
        this._failureSubscribers = failureSubscribers;
        this._whitelistAccounts = whitelistAccounts;
    }

    async notify(data: {
        blockHash: BlockHash;
        events: (NCGTransferredEvent & TransactionLocation)[];
    }): Promise<void> {
        const { blockHash, events } = data;

        let recorded = false; // whether the tx is recorded in _monitorStateStore
        for (const {
            blockHash,
            txId,
            sender,
            amount: amountString,
            memo: recipient,
        } of events) {
            console.log("Process NineChronicles transaction", txId);

            if (this._addressBanPolicy.isBannedAddress(sender)) {
                // ignore banned user request
                this._ignoreBannedUserRequest(sender, txId);
                continue;
            }

            if (await this._exchangeHistoryStore.exist(txId)) {
                // ignore if the tx has already been processed before
                this._ignoreDuplicatedTxRequest(
                    txId,
                    sender,
                    recipient!,
                    amountString
                );
                continue;
            }

            // below values are needed for failure handling so it should be declared before the try block
            // to limit the amount of NCG that can be transferred in 24 hours & to apply fee
            const transferredAmountInLast24Hours = new Decimal(
                await this._exchangeHistoryStore.transferredAmountInLast24Hours(
                    "nineChronicles",
                    sender
                )
            );
            const { accountType, description: whitelistDescription } =
                this._getAccountType(sender, recipient!);
            console.log("accountType", accountType);

            try {
                const amount = new Decimal(amountString);
                const maximum = new Decimal(
                    this._getPolicyMaximum(accountType)
                );
                const minimum = new Decimal(this._limitationPolicy.minimum);
                const isAmountBelowMinimum = amount.cmp(minimum) === -1;
                const isAmountOver24HourMaximum =
                    transferredAmountInLast24Hours.cmp(maximum) >= 0;
                const maxExchangableAmount = maximum.sub(
                    transferredAmountInLast24Hours
                );
                const limitedAmount: Decimal = Decimal.min(
                    maxExchangableAmount,
                    amount
                );
                const isInvalidRecipient =
                    recipient === null || !isValidAddress(recipient);
                const isInvalidAmount = !amount.isFinite() || amount.isNaN();
                const isInvalidTx = isInvalidRecipient || isInvalidAmount;
                const isExchangableTx =
                    !isInvalidTx &&
                    !isAmountBelowMinimum &&
                    !isAmountOver24HourMaximum;

                // Record the transaction to stores
                recorded = await this._recordTxToStores(
                    blockHash,
                    txId,
                    sender,
                    recipient,
                    limitedAmount,
                    isExchangableTx
                );

                if (isInvalidRecipient) {
                    // ignore invalid recepient request
                    await this._ignoreInvalidRecepientRequest(
                        sender,
                        amountString,
                        txId,
                        amount,
                        recipient
                    );
                    continue;
                }

                if (amount.eq(0) || isInvalidAmount) {
                    // ignore zero amount or invalid amount request
                    console.log(
                        "It doesn't need any operation because amount is 0 or invalid."
                    );
                    continue;
                }

                if (isAmountBelowMinimum) {
                    // ignore below minimum request
                    this._ignoreAmountBelowMinimumRequest(
                        sender,
                        amountString,
                        txId,
                        amount,
                        recipient
                    );
                    continue;
                }

                if (isAmountOver24HourMaximum) {
                    // ignore over 24 hour maximum request
                    this._ignoreAmountOver24HourMaximumRequest(
                        sender,
                        amountString,
                        txId,
                        amount,
                        recipient,
                        transferredAmountInLast24Hours
                    );
                    continue;
                }

                // check if the amount is overflowed
                let refundAmount: string | null = null;
                let refundTxId: string | null = null;
                const isAmountOverflowed =
                    !isAmountOver24HourMaximum &&
                    transferredAmountInLast24Hours.add(amount).cmp(maximum) ===
                        1;
                if (isAmountOverflowed) {
                    // refund overflowed amount
                    refundTxId = await this._refundOverflowedAmount(
                        sender,
                        amountString,
                        txId,
                        amount,
                        recipient,
                        transferredAmountInLast24Hours,
                        maximum
                    );

                    if (
                        limitedAmount.lessThan(this._limitationPolicy.minimum)
                    ) {
                        // refund if the remaining amount is below policy minimum
                        await this._refundBelowMinimumAmount(
                            sender,
                            txId,
                            amount,
                            recipient,
                            limitedAmount
                        );
                        continue;
                    }
                }

                // mint wrapped NCG, finally
                await this._mintRequest(
                    txId,
                    sender,
                    recipient,
                    limitedAmount,
                    accountType,
                    whitelistDescription,
                    refundAmount,
                    refundTxId,
                    transferredAmountInLast24Hours
                );
            } catch (e) {
                // handle unexpected error
                await this._failedRequest(
                    sender,
                    recipient,
                    amountString,
                    txId,
                    accountType,
                    transferredAmountInLast24Hours,
                    e
                );
            }
        }

        if (!recorded) {
            // If no tx is recorded, store the blockHash with null txId
            await this._monitorStateStore.store("nineChronicles", {
                blockHash,
                txId: null,
            });
        }
    }

    /**
     * If <Sender, Recipient> Pair is in WhiteList,
     * applied whitelistMaximum for Maximum NCG Transfer Amount of Limitation Policy
     */
    private _getPolicyMaximum(accountType: ACCOUNT_TYPE): number {
        return accountType === ACCOUNT_TYPE.GENERAL
            ? this._limitationPolicy.maximum
            : this._limitationPolicy.whitelistMaximum;
    }

    private async _failedRequest(
        sender: string,
        recipient: string | null,
        amountString: string,
        txId: string,
        accountType: ACCOUNT_TYPE,
        transferredAmountInLast24Hours: Decimal,
        e: any
    ) {
        console.log("EERRRR", e);
        let errorMessage: string;
        if (e instanceof Error) {
            errorMessage = String(e);
        } else {
            errorMessage = JSON.stringify(e);
        }

        const slackMsgRes = await this._slackMessageSender.sendMessage(
            new WrappingFailureEvent(
                this._explorerUrl,
                this._ncscanUrl,
                this._useNcscan,
                sender,
                String(recipient),
                amountString,
                txId,
                errorMessage,
                this._failureSubscribers
            )
        );

        await this._spreadsheetClient.to_spreadsheet_mint({
            slackMessageId: `${
                slackMsgRes?.channel
            }/p${slackMsgRes?.ts?.replace(".", "")}`,
            url: this._explorerUrl,
            ncscanUrl: this._ncscanUrl,
            useNcscan: this._useNcscan,
            txId: txId,
            sender,
            recipient: String(recipient),
            amount: amountString,
            accountType,
            transferredAmountInLast24Hours,
            error: errorMessage,
        });

        this._opensearchClient.to_opensearch("error", {
            content: "NCG -> wNCG request failure",
            cause: errorMessage,
            libplanetTxId: txId,
            sender: sender,
            recipient: recipient,
            amount: amountString,
        });

        this._integration.error("Unexpected error during wrapping NCG", {
            errorMessage,
            sender,
            recipient,
            txId,
            amountString,
        });
    }

    private async _mintRequest(
        txId: string,
        sender: string,
        recipient: string | null,
        limitedAmount: Decimal,
        accountType: ACCOUNT_TYPE,
        whitelistDescription: string | undefined,
        refundAmount: string | null,
        refundTxId: string | null,
        transferredAmountInLast24Hours: Decimal
    ): Promise<void> {
        const fee: Decimal = this._exchangeFeeRatioPolicy.getFee(
            limitedAmount,
            transferredAmountInLast24Hours,
            accountType
        );
        const exchangeAmount: Decimal = limitedAmount.sub(fee);
        const ethereumDecimals = new Decimal(10).pow(18);
        const ethereumExchangeAmount: Decimal =
            exchangeAmount.mul(ethereumDecimals);

        console.log("limitedAmount", limitedAmount);
        console.log("fee", fee);
        console.log("exchangeAmount", exchangeAmount);

        const transactionHash = await this._wrappedNcgTransfer.mint(
            recipient!,
            ethereumExchangeAmount
        );

        console.log("Receipt", transactionHash);

        const isWhitelistEvent: boolean = accountType !== ACCOUNT_TYPE.GENERAL;
        this._slackMessageSender.sendMessage(
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
                refundTxId,
                isWhitelistEvent,
                whitelistDescription
            )
        );
        this._opensearchClient.to_opensearch("info", {
            content: "NCG -> wNCG request success",
            libplanetTxId: txId,
            ethereumTxId: transactionHash,
            fee: fee.toNumber(),
            sender: sender,
            recipient: recipient,
            amount: exchangeAmount.toNumber(),
        });
    }

    private async _refundBelowMinimumAmount(
        sender: string,
        txId: string,
        amount: Decimal,
        recipient: string | null,
        limitedAmount: Decimal
    ): Promise<void> {
        console.log(
            "Amount Ncg to transfer after refunded is lower than minimum",
            limitedAmount.toString()
        );
        const smallAmountRefundTxId = await this._ncgTransfer.transfer(
            sender,
            limitedAmount.toString(),
            `I'm bridge and you should transfer more NCG than ${this._limitationPolicy.minimum}.`
        );
        this._slackMessageSender.sendMessage(
            new RefundEvent(
                this._explorerUrl,
                this._ncscanUrl,
                this._useNcscan,
                sender,
                txId,
                limitedAmount,
                smallAmountRefundTxId,
                limitedAmount,
                `Overflowed Amount ${limitedAmount.toString()} is lower than minimum NCG. Refund NCG.`
            )
        );
        this._opensearchClient.to_opensearch("error", {
            content: "NCG -> wNCG request failure",
            cause: `Overflowed Amount ${limitedAmount.toString()} is lower than minimum NCG. Refund NCG.`,
            libplanetTxId: txId,
            sender: sender,
            recipient: recipient,
            amount: amount.toNumber(),
        });
        console.log(
            `Overflowed Amount after refund ${limitedAmount.toString()} is lower than minimum NCG. Refund NCG. The transaction's id is`,
            smallAmountRefundTxId
        );
    }

    private async _refundOverflowedAmount(
        sender: string,
        amountString: string,
        txId: string,
        amount: Decimal,
        recipient: string | null,
        transferredAmountInLast24Hours: Decimal,
        maximum: Decimal
    ): Promise<string> {
        // Should equal with amount - limitedAmount
        const refundAmount = transferredAmountInLast24Hours
            .add(amount)
            .sub(maximum);
        const refundAmountString = refundAmount.toString();
        const refundTxId = await this._ncgTransfer.transfer(
            sender,
            refundAmountString,
            `I'm bridge and you should transfer less NCG than ${this._limitationPolicy.maximum}.`
        );
        this._slackMessageSender.sendMessage(
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
        return refundTxId;
    }

    private async _ignoreAmountOver24HourMaximumRequest(
        sender: string,
        amountString: string,
        txId: string,
        amount: Decimal,
        recipient: string | null,
        transferredAmountInLast24Hours: Decimal
    ): Promise<void> {
        const nineChroniclesTxId = await this._ncgTransfer.transfer(
            sender,
            amountString,
            `I'm bridge and you can exchange until ${this._limitationPolicy.maximum} for 24 hours.`
        );
        this._slackMessageSender.sendMessage(
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
    }

    private _recordTxToStores(
        blockHash: BlockHash,
        txId: string,
        sender: string,
        recipient: string | null,
        limitedAmount: Decimal,
        isExchangableTx: boolean
    ): boolean {
        this._monitorStateStore.store("nineChronicles", { blockHash, txId });
        this._exchangeHistoryStore.put({
            network: "nineChronicles",
            tx_id: txId,
            sender,
            recipient: recipient ?? "",
            timestamp: new Date().toISOString(),
            amount: isExchangableTx ? limitedAmount.toNumber() : 0,
        });
        return true;
    }

    private async _ignoreAmountBelowMinimumRequest(
        sender: string,
        amountString: string,
        txId: string,
        amount: Decimal,
        recipient: string | null
    ): Promise<void> {
        const nineChroniclesTxId = await this._ncgTransfer.transfer(
            sender,
            amountString,
            `I'm bridge and you should transfer more NCG than ${this._limitationPolicy.minimum}.`
        );
        this._slackMessageSender.sendMessage(
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
    }

    // refund NCG if the memo is invalid, then notify on slack and log on opensearch/console
    private async _ignoreInvalidRecepientRequest(
        sender: string,
        amountString: string,
        txId: string,
        amount: Decimal,
        recipient: string | null
    ): Promise<void> {
        const nineChroniclesTxId = await this._ncgTransfer.transfer(
            sender,
            amountString,
            "I'm bridge and you should transfer with memo, valid ethereum address to receive."
        );
        this._slackMessageSender.sendMessage(
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
            cause: "Invalid recipient 9c address in memo",
            libplanetTxId: txId,
            sender: sender,
            recipient: recipient,
            amount: amount.toNumber(),
        });
        console.log(
            "Valid memo doesn't exist so refund NCG. The transaction's id is",
            nineChroniclesTxId
        );
    }

    // nofity on slack and log on console
    private async _ignoreBannedUserRequest(
        sender: string,
        txId: string
    ): Promise<void> {
        this._slackMessageSender.sendMessage(
            new WrappingBannedUserEvent(sender, txId)
        );
        console.log(`Sender ${sender} is banned.`);
    }

    // notify on slack and log on opensearch
    private async _ignoreDuplicatedTxRequest(
        txId: string,
        sender: string,
        recipient: string,
        amountString: string
    ): Promise<void> {
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
    }

    /**
     * checks if <Sender, Recipient> Pair is in Whitelist and returns the account type
     */
    private _getAccountType(
        sender: string,
        recipient: string
    ): { accountType: ACCOUNT_TYPE; description?: string } {
        if (!this._whitelistAccounts.length)
            return { accountType: ACCOUNT_TYPE.GENERAL };
        for (const whitelistAccount of this._whitelistAccounts) {
            if (
                whitelistAccount.from === sender &&
                whitelistAccount.to === recipient
            ) {
                return {
                    accountType: whitelistAccount.type,
                    description: whitelistAccount.description,
                };
            }
        }
        return { accountType: ACCOUNT_TYPE.GENERAL };
    }
}
