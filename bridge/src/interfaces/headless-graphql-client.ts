import { BlockHash } from "../types/block-hash";
import { TxId } from "../types/txid";
import { INCGTransferredEvent } from "./ncg-transferred-event";

export interface IHeadlessGraphQLClient {
    getBlockIndex(blockHash: BlockHash): Promise<number>;
    getTipIndex(): Promise<number>;
    getBlockHash(index: number): Promise<BlockHash>;
    getNCGTransferredEvents(blockHash: BlockHash, recipient: string): Promise<INCGTransferredEvent[]>;
    getNextTxNonce(address: string): Promise<number>;
    transfer(recipient: string, amount: string, txNonce: number, memo: string | null): Promise<TxId>;
}
