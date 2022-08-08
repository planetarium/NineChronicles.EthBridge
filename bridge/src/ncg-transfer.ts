import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { TxId } from "./types/txid";

export class NCGTransfer implements INCGTransfer {
    private readonly _headlessGraphQLCLient: IHeadlessGraphQLClient;

    /**
     * The address of sender;
     */
    private readonly _address: string;

    constructor(
        headlessGraphQLCLient: IHeadlessGraphQLClient,
        address: string
    ) {
        this._headlessGraphQLCLient = headlessGraphQLCLient;
        this._address = address;
    }

    async transfer(
        address: string,
        amount: string,
        memo: string | null
    ): Promise<TxId> {
        const nextTxNonce = await this._headlessGraphQLCLient.getNextTxNonce(
            this._address
        );
        return await this._headlessGraphQLCLient.transfer(
            address,
            amount,
            nextTxNonce,
            memo
        );
    }
}
