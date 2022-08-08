import { TxId } from "../types/txid";

export interface INCGTransfer {
    transfer(
        address: string,
        amount: string,
        memo: string | null
    ): Promise<TxId>;
}
