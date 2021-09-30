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
import { IExchangeHistoryStore } from "../interfaces/exchange-history-store";
import { IAddressBanPolicy } from "../policies/address-ban";
import { Integration } from "../integrations";

// See also https://ethereum.github.io/yellowpaper/paper.pdf 4.2 The Transaction section.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function isValidAddress(address: string): boolean {
    return address.startsWith("0x") && isAddress(address) && address !== ZERO_ADDRESS;
}

interface LimitationPolicy {
    maximum: number,
    minimum: number,
};

export class NCGTransferredEventObserver implements IObserver<{ blockHash: BlockHash, events: (NCGTransferredEvent & TransactionLocation)[] }> {
    private readonly _ncgTransfer: INCGTransfer;
    private readonly _wrappedNcgTransfer: IWrappedNCGMinter;
    private readonly _slackWebClient: SlackWebClient;
    private readonly _monitorStateStore: IMonitorStateStore;
    private readonly _exchangeHistoryStore: IExchangeHistoryStore;
    private readonly _explorerUrl: string;
    private readonly _etherscanUrl: string;
    /**
     * The fee ratio requried to exchange. This should be float value like 0.01.
     */
    private readonly _exchangeFeeRatio: Decimal;
    private readonly _limitationPolicy: LimitationPolicy;
    private readonly _addressBanPolicy: IAddressBanPolicy;

    private readonly _integration: Integration;

    constructor(ncgTransfer: INCGTransfer, wrappedNcgTransfer: IWrappedNCGMinter, slackWebClient: SlackWebClient, monitorStateStore: IMonitorStateStore, exchangeHistoryStore: IExchangeHistoryStore, explorerUrl: string, etherscanUrl: string, exchangeFeeRatio: Decimal, limitationPolicy: LimitationPolicy, addressBanPolicy: IAddressBanPolicy, integration: Integration) {
        this._ncgTransfer = ncgTransfer;
        this._wrappedNcgTransfer = wrappedNcgTransfer;
        this._slackWebClient = slackWebClient;
        this._monitorStateStore = monitorStateStore;
        this._exchangeHistoryStore = exchangeHistoryStore;
        this._explorerUrl = explorerUrl;
        this._etherscanUrl = etherscanUrl;
        this._exchangeFeeRatio = exchangeFeeRatio;
        this._limitationPolicy = limitationPolicy;
        this._addressBanPolicy = addressBanPolicy;
        this._integration = integration;
    }

    async notify(data: { blockHash: BlockHash, events: (NCGTransferredEvent & TransactionLocation)[] }): Promise<void> {
        const { blockHash, events } = data;

        let recorded = false;
        for (const { blockHash, txId, sender, amount: amountString, memo: recipient, } of events) {
            try {
                if (this._addressBanPolicy.isBannedAddress(sender)) {
                    continue;
                }

                const decimals = new Decimal(10).pow(18);
                const amount = new Decimal(amountString);
                const minimum = new Decimal(this._limitationPolicy.minimum);
                const maximum = new Decimal(this._limitationPolicy.maximum);
                const transferredAmountInLast24Hours = new Decimal(await this._exchangeHistoryStore.transferredAmountInLast24Hours("nineChronicles", sender));
                const maxExchangableAmount = maximum.sub(transferredAmountInLast24Hours);
                const limitedAmount: Decimal = Decimal.min(maxExchangableAmount, amount);

                const lessThanMinimum = amount.cmp(minimum) === -1;
                const alreadyExchangedUptoMaximum = transferredAmountInLast24Hours.cmp(maximum) >= 0;
                const overflowedExchangeAmount = !alreadyExchangedUptoMaximum && transferredAmountInLast24Hours.add(amount).cmp(maximum) === 1;

                const isInvalidRecipient = recipient === null || !isValidAddress(recipient);
                const isInvalidAmount = !amount.isFinite() || amount.isNaN();
                const isInvalidTx = isInvalidRecipient || isInvalidAmount;

                const isExchangableTx = !isInvalidTx && !lessThanMinimum && !alreadyExchangedUptoMaximum

                await this._monitorStateStore.store("nineChronicles", { blockHash, txId });
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
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(sender, amountString, "I'm bridge and you should transfer with memo, valid ethereum address to receive.");
                    console.log("Valid memo doesn't exist so refund NCG. The transaction's id is", nineChroniclesTxId);
                    continue;
                }

                if (amount.eq(0)) {
                    console.log("It doesn't need any operation because amount is 0.");
                    continue;
                }

                if (lessThanMinimum) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(sender, amountString, `I'm bridge and you should transfer more NCG than ${this._limitationPolicy.minimum}.`);
                    console.log(`The amount(${amountString}) is less than ${this._limitationPolicy.minimum} so refund NCG. The transaction's id is`, nineChroniclesTxId);
                    continue;
                }

                // NOTE x.cmp(y) returns -1, means x < y.
                if (alreadyExchangedUptoMaximum) {
                    const nineChroniclesTxId = await this._ncgTransfer.transfer(sender, amountString, `I'm bridge and you can exchange until ${this._limitationPolicy.maximum} for 24 hours.`);
                    console.log(`${sender} already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${amountString}. The transaction's id is`, nineChroniclesTxId);
                    continue;
                }

                let refundAmount: string | null = null;
                let refundTxId: string | null = null;

                if (overflowedExchangeAmount) {
                    // Should equal with amount - limitedAmount
                    refundAmount = transferredAmountInLast24Hours.add(amount).sub(maximum).toString();
                    refundTxId = await this._ncgTransfer.transfer(sender, refundAmount, `I'm bridge and you should transfer less NCG than ${this._limitationPolicy.maximum}.`);
                    console.log(`${sender} tried to exchange ${amountString} and already exchanged ${transferredAmountInLast24Hours} and users can exchange until ${this._limitationPolicy.maximum} in 24 hours so refund NCG as ${refundAmount}. The transaction's id is`, refundTxId);
                }

                // If exchangeFeeRatio == 0.01 (1%), it exchanges only 0.99 (= 1 - 0.01 = 99%) of amount.
                const fee = new Decimal(limitedAmount.mul(this._exchangeFeeRatio).toFixed(2));
                const exchangeAmount = limitedAmount.sub(fee);
                const ethereumExchangeAmount = exchangeAmount.mul(decimals);

                console.log("limitedAmount", limitedAmount);
                console.log("fee", fee);
                console.log("exchangeAmount", exchangeAmount);

                // FIXME: Hard-coded.
                let transactionHash
                // https://explorer.libplanet.io/9c-main/block/?52573abd5e04d933a84f171745ce39c1d3e17cefe8aab12f62172f7710a3bd01
                if(blockHash === "52573abd5e04d933a84f171745ce39c1d3e17cefe8aab12f62172f7710a3bd01") {
                  transactionHash = "0x79eb4190dddc6f25807e6f6fc8c4311e45e5882463ecaf5c07c85fe8bc4b3760";
                // https://explorer.libplanet.io/9c-main/block/?4a3e74ffb45a317085c5bde76159069db42ff04d45f62d64cbac4ac1e5ec503c
                } else if(blockHash === "4a3e74ffb45a317085c5bde76159069db42ff04d45f62d64cbac4ac1e5ec503c") {
                  transactionHash = "0xc60146f55fd24323de2e2efbd66743317ac9601aa648daf9d78069661635c306";
                } else {
                  const { transactionHash: txHash } = await this._wrappedNcgTransfer.mint(recipient!, ethereumExchangeAmount);
                  transactionHash = txHash;
                }

                console.log("Receipt", transactionHash);
                await this._slackWebClient.chat.postMessage({
                    channel: "#nine-chronicles-bridge-bot",
                    ...new WrappedEvent(this._explorerUrl, this._etherscanUrl, sender, recipient!, exchangeAmount.toString(), txId, transactionHash, fee, refundAmount, refundTxId).render()
                });
            } catch (e) {
                console.log("EERRRR", e)
                // TODO: it should be replaced with `Integration` Slack implementation.
                await this._slackWebClient.chat.postMessage({
                    channel: "#nine-chronicles-bridge-bot",
                    ...new WrappingFailureEvent(this._explorerUrl, sender, String(recipient), amountString, txId, String(e)).render()
                });
                await this._integration.error("Unexpected error during wrapping NCG", {
                    errorMessage: String(e),
                    sender,
                    recipient,
                    txId,
                    amountString,
                });
            }
        }

        if (!recorded) {
            await this._monitorStateStore.store("nineChronicles", { blockHash, txId: null });
        }
    }
}
