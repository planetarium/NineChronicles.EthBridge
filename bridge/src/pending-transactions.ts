import { IExchangeHistoryStore } from "./interfaces/exchange-history-store";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { MultiPlanetary } from "./multi-planetary";
import { ISlackMessageSender } from "./interfaces/slack-message-sender";
import { PendingTransactionMessage } from "./messages/pending-transaction-message";
import { TransactionStatus } from "./types/transaction-status";

/** Slack rejects messages with more than 100 attachments. */
const MAX_REMINDER_ROWS = 20;

export class PendingTransactionHandler {
    constructor(
        private readonly _exchangeHistoryStore: IExchangeHistoryStore,
        private readonly _ncgTransfer: INCGTransfer,
        private readonly _multiPlanetary: MultiPlanetary,
        private readonly _slackMessageSender: ISlackMessageSender
    ) {}

    async messagePendingTransactions(): Promise<void> {
        const pendingTransactions =
            await this._exchangeHistoryStore.getPendingTransactions();

        if (pendingTransactions.length > 0) {
            // Report, but never let Slack keep these rows from being failed.
            try {
                await this._slackMessageSender.sendMessage(
                    new PendingTransactionMessage(
                        pendingTransactions.slice(0, MAX_REMINDER_ROWS),
                        this._multiPlanetary,
                        undefined,
                        undefined,
                        "Pending",
                        pendingTransactions.length
                    )
                );
            } catch (error) {
                console.error(
                    `Could not report ${pendingTransactions.length} pending transaction(s)`,
                    error
                );
            }

            for (const tx of pendingTransactions) {
                await this._exchangeHistoryStore.updateStatus(
                    tx.tx_id,
                    TransactionStatus.FAILED
                );
            }
        }

        // Possibly-landed mints are never auto-failed; remind until resolved.
        // A reminder must never block startup (Slack outage, attachment limit).
        const unconfirmed =
            await this._exchangeHistoryStore.getUnconfirmedTransactions();
        if (unconfirmed.length > 0) {
            try {
                await this._slackMessageSender.sendMessage(
                    new PendingTransactionMessage(
                        unconfirmed.slice(0, MAX_REMINDER_ROWS),
                        this._multiPlanetary,
                        undefined,
                        undefined,
                        "Unconfirmed",
                        unconfirmed.length
                    )
                );
            } catch (error) {
                console.error(
                    `Could not report ${unconfirmed.length} unconfirmed mint(s)`,
                    error
                );
            }
        }
    }
}
