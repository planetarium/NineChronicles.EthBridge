import { TransactionLocation } from "../types/transaction-location";

export interface IMonitorStateStore {
    store(
        network: string,
        transactionLocation: TransactionLocation
    ): Promise<void>;
    load(network: string): Promise<TransactionLocation | null>;
}
