import { TxId } from "../types/txid";

export interface INCGTransfer {
    transfer(address: string, amount: BigInt): Promise<TxId>;
}
