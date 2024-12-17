import { TransactionStatus } from "../types/transaction-status";

export interface ExchangeHistory {
    network: string;
    tx_id: string;
    sender: string;
    recipient: string;
    timestamp: string;
    amount: number;
    status: TransactionStatus;
}

export interface IExchangeHistoryStore {
    put(history: ExchangeHistory): Promise<void>;
    exist(tx_id: string): Promise<boolean>;

    transferredAmountInLast24Hours(
        network: string,
        sender: string
    ): Promise<number>;

    updateStatus(
        tx_id: string,
        status: TransactionStatus.COMPLETED | TransactionStatus.FAILED
    ): Promise<void>;

    getPendingTransactions(): Promise<ExchangeHistory[]>;
}
