import { BlockHash } from "../types/block-hash";
import { TxId } from "../types/txid";

export interface INCGTransferEvent {
    blockHash: BlockHash,
    txId: TxId,
    sender: string,
    recipient: string,
    amount: string,
}
