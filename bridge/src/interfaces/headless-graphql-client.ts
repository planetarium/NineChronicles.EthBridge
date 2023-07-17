import { BlockHash } from "../types/block-hash";
import { TxId } from "../types/txid";
import { NCGTransferredEvent } from "../types/ncg-transferred-event";

export interface IHeadlessGraphQLClient {
    readonly endpoint: string;

    getBlockIndex(blockHash: BlockHash): Promise<number>;
    getTipIndex(): Promise<number>;
    getBlockHash(index: number): Promise<BlockHash>;
    getNCGTransferredEvents(
        blockHash: BlockHash,
        recipient: string
    ): Promise<NCGTransferredEvent[]>;
    getNextTxNonce(address: string): Promise<number>;
    getGenesisHash(): Promise<string>;
    transfer(
        recipient: string,
        amount: string,
        txNonce: number,
        memo: string | null
    ): Promise<TxId>;
    createUnsignedTx(plainValue: string, publicKey: string): Promise<string>;
    attachSignature(unsignedTx: string, signature: string): Promise<string>;
    stageTx(payload: string): Promise<boolean>;
}
