import { BlockHash } from "./block-hash";
import { TxId } from "./txid";

export interface NCGTransferredEvent {
    blockHash: BlockHash;
    txId: TxId;
    sender: string;
    recipient: string;
    amount: string;
    memo: string | null;
}
