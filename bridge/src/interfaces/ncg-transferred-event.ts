import { BlockHash } from "../types/block-hash";
import { TxId } from "../types/txid";

export interface INCGTransferredEvent {
    blockHash: BlockHash,
    txId: TxId,
    sender: string,
    recipient: string,
    amount: string,
}
