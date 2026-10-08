import Web3 from "web3";
import { Contract } from "web3-eth-contract";
import Decimal from "decimal.js";

import { ContractDescription } from "./types/contract-description";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { IGasPricePolicy } from "./policies/gas-price";
import {
    MintOutcomeUnknownError,
    pinnedUntilBroadcast,
    PreBroadcastRetryOptions,
    ReceiptWaitOptions,
    waitForMintReceipt,
} from "./mint-safety";

export interface WrappedNCGMinterSafetyOptions {
    /** The routing provider behind Web3: pins reads and waits for receipts. */
    provider: {
        waitForTransaction(
            hash: string,
            confirmations?: number,
            timeout?: number
        ): Promise<{ status?: number }>;
    };
    receipt: ReceiptWaitOptions;
    preBroadcast: PreBroadcastRetryOptions;
}

export class WrappedNCGMinter implements IWrappedNCGMinter {
    private readonly _web3: Web3;
    private readonly _contractDescription: ContractDescription;
    private readonly _contract: Contract;
    private readonly _minterAddress: string;
    private readonly _gasPricePolicy: IGasPricePolicy;
    private readonly _priorityFee: Decimal;
    private readonly _safety: WrappedNCGMinterSafetyOptions | undefined;

    /**
     *
     * @param web3
     * @param contractDescription
     * @param minterAddress
     * @param gasTipRatio Percentage of gas tips to be incorporated into the block but not X %. If you want 150%, you should pass 1.5 decimal instance.
     */
    constructor(
        web3: Web3,
        contractDescription: ContractDescription,
        minterAddress: string,
        gasPricePolicy: IGasPricePolicy,
        priorityFee: Decimal,
        safety?: WrappedNCGMinterSafetyOptions
    ) {
        this._web3 = web3;
        this._contractDescription = contractDescription;
        this._contract = new this._web3.eth.Contract(
            this._contractDescription.abi as never[],
            this._contractDescription.address
        );
        this._minterAddress = minterAddress;
        this._gasPricePolicy = gasPricePolicy;
        this._priorityFee = priorityFee;
        this._safety = safety;
    }

    async mint(address: string, amount: Decimal): Promise<string> {
        //NOTICE: This can be a problem if the number of digits in amount exceeds 9e+14.
        //more detail: https://mikemcl.github.io/decimal.js/#toExpPos
        Decimal.set({ toExpPos: 900000000000000 });
        console.log(
            `Minting ${amount.toString()} ${
                this._contractDescription.address
            } to ${address}`
        );
        // Gas price, nonce and gas estimate share one endpoint with the
        // broadcast; a transient failure before it restarts the whole attempt.
        const { hash, sending } = await pinnedUntilBroadcast(
            this._safety?.provider,
            async () => {
                // e.g. '103926224184', '93574861317'
                const gasPriceString = await this._web3.eth.getGasPrice();
                const gasPrice = new Decimal(gasPriceString);
                const calculatedGasPrice =
                    this._gasPricePolicy.calculateGasPrice(gasPrice);
                const sending = this._contract.methods
                    .mint(address, this._web3.utils.toBN(amount.toString()))
                    .send({
                        from: this._minterAddress,
                        gasPrice: calculatedGasPrice,
                    });
                const hash = await new Promise<string>((resolve, reject) => {
                    sending.once("transactionHash", resolve);
                    sending.then(undefined, reject);
                });
                return { hash, sending };
            },
            this._safety?.preBroadcast ?? { attempts: 1, delayMs: 0 }
        );

        try {
            const { transactionHash } = await sending;
            return transactionHash ?? hash;
        } catch (error) {
            // A receipt in the error means the transaction was mined and reverted.
            if ((error as { receipt?: unknown } | null)?.receipt) throw error;
            const provider = this._safety?.provider;
            if (!provider) throw new MintOutcomeUnknownError(hash, error);
            console.error(
                `Web3 lost track of mint tx ${hash}; waiting for its receipt by hash`,
                error
            );
            const receipt = await waitForMintReceipt(
                {
                    hash,
                    wait: (confirmations, timeout) =>
                        provider.waitForTransaction(
                            hash,
                            confirmations,
                            timeout
                        ),
                },
                this._safety!.receipt
            );
            if (receipt.status === 0)
                throw Object.assign(
                    new Error(`Mint transaction ${hash} reverted`),
                    { receipt }
                );
            return hash;
        }
    }
}
