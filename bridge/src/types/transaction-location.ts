import { BlockHash } from "./block-hash";
import { TxId } from "./txid";

export interface TransactionLocation {
    blockHash: BlockHash;
    txId: TxId | null;
}
