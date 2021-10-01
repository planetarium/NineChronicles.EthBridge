import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { TxId } from "./types/txid";
import { Mutex } from 'async-mutex';
import { encode } from "bencodex";
import web3 from "web3";
import crypto from "crypto";
import { KMSNCGSigner } from "./kms-ncg-signer"
import { Address } from "./types/address";
import Decimal from "decimal.js";

export class NCGKMSTransfer implements INCGTransfer {
    private readonly _headlessGraphQLCLient: IHeadlessGraphQLClient;
    private readonly _mutex: Mutex;
    private readonly _signer: KMSNCGSigner;

    /**
     * The address of sender;
     */
    private readonly _address: Address;
    private readonly _publicKey: string;
    private readonly _minters: [Address];

    /**
     *
     * @param headlessGraphQLCLient A GraphQL client to create unsigned tx, attach unsigned tx with signature and stage tx.
     * @param address An address to use in transaction as sender.
     * @param publicKey base64 encoded public key to use in transaction.
     * @param minters A list of minters' addresses.
     * @param kmsSigner A signer to sign transaction
     */
    constructor(headlessGraphQLCLient: IHeadlessGraphQLClient, address: Address, publicKey: string, minters: [Address], kmsSigner: KMSNCGSigner) {
        this._headlessGraphQLCLient = headlessGraphQLCLient;
        this._address = address;
        this._publicKey = publicKey;
        this._minters = minters;
        this._mutex = new Mutex();
        this._signer = kmsSigner;
    }

    async transfer(address: string, amount: string, memo: string | null): Promise<TxId> {
        // If 0.01 came as `amount`, expect 1.
        // If 50.00 came as `amount`, expect 5000.
        // If 50.011 came as `amount`, expect 5001.
        const ncgAmount = new Decimal(amount).mul(100).floor().toNumber();
        return await this._mutex.runExclusive(async () => {
            // FIXME: request unsigned transaction builder API to NineChronicles.Headless developer
            //        and remove these lines.
            const plainValue = {
                type_id: "transfer_asset2",
                values: {
                    amount: [
                        {
                            decimalPlaces: Buffer.from([0x02]),
                            minters: this._minters.map(x => Buffer.from(web3.utils.hexToBytes(x))),
                            ticker: 'NCG'
                        },
                        ncgAmount
                    ],
                    ...(memo === null ? {} : { memo }),
                    recipient: Buffer.from(web3.utils.hexToBytes(address)),
                    sender: Buffer.from(web3.utils.hexToBytes(this._address))
                }
            };
            const unsignedTx = await this._headlessGraphQLCLient.createUnsignedTx(encode(plainValue).toString('base64'), this._publicKey);
            const unsignedTxId = crypto.createHash('sha256').update(unsignedTx, 'base64').digest();
            const sign = await this._signer.sign(unsignedTxId);
            const base64Sign = sign.toString('base64');
            const tx = await this._headlessGraphQLCLient.attachSignature(unsignedTx, base64Sign);
            const success = await this._headlessGraphQLCLient.stageTx(tx);
            if (!success) {
                throw new Error('Failed to stage transaction');
            }
            const txId = crypto.createHash('sha256').update(tx, 'base64').digest().toString("hex");
            return txId;
        });
    }
}
