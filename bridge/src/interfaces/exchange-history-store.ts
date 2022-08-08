export interface ExchangeHistory {
    network: string;
    tx_id: string;
    sender: string;
    recipient: string;
    timestamp: string;
    amount: number;
}

export interface IExchangeHistoryStore {
    put(history: ExchangeHistory): Promise<void>;
    exist(tx_id: string): Promise<boolean>;

    transferredAmountInLast24Hours(
        network: string,
        sender: string
    ): Promise<number>;
}
