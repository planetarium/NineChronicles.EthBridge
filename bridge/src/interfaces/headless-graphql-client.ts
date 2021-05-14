import { TxId } from "../types/txid";

export interface IHeadlessGraphQLClient {
    getNextTxNonce(address: string): Promise<number>;
    transfer(recipient: string, amount: string, txNonce: number): Promise<TxId>;
}
