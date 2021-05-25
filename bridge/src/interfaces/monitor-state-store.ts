export interface IMonitorStateStore {
    store(network: string, blockHash: string, txId: string): Promise<void>;
    load(network: string): Promise<{ blockHash: string, txId: string }>;
}
