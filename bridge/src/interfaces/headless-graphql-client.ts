import { BlockHash } from "../types/block-hash";
import { TxId } from "../types/txid";
import { INCGTransferEvent } from "./ncg-transfer-event";

export interface IHeadlessGraphQLClient {
    getTipIndex(): Promise<number>;
    getBlockHash(index: number): Promise<BlockHash>;
    getNCGTransferEvents(blockHash: BlockHash, recipient: string): Promise<INCGTransferEvent[]>;
    getNextTxNonce(address: string): Promise<number>;
    transfer(recipient: string, amount: string, txNonce: number): Promise<TxId>;
}
