import Web3 from "web3";
import { TransactionReceipt, TransactionConfig } from "web3-core";
import { Contract } from "web3-eth-contract";
import Decimal from "decimal.js";
import { PromiEvent } from "web3-core";

import { ContractDescription } from "./types/contract-description";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { IGasPricePolicy } from "./policies/gas-price";

export class WrappedNCGMinter implements IWrappedNCGMinter {
    private readonly _web3: Web3;
    private readonly _contractDescription: ContractDescription;
    private readonly _contract: Contract;
    private readonly _minterAddress: string;
    private readonly _gasPricePolicy: IGasPricePolicy;
    private readonly _priorityFee: Decimal;

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
        priorityFee: Decimal
    ) {
        this._web3 = web3;
        this._contractDescription = contractDescription;
        this._contract = new this._web3.eth.Contract(
            this._contractDescription.abi,
            this._contractDescription.address
        );
        this._minterAddress = minterAddress;
        this._gasPricePolicy = gasPricePolicy;
        this._priorityFee = priorityFee;
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
        // e.g. '103926224184', '93574861317'
        const gasPriceString = await this._web3.eth.getGasPrice();
        const gasPrice = new Decimal(gasPriceString);
        const calculatedGasPrice =
            this._gasPricePolicy.calculateGasPrice(gasPrice);
        const { transactionHash } = await this._contract.methods
            .mint(address, this._web3.utils.toBN(amount.toString()))
            .send({ from: this._minterAddress, gasPrice: calculatedGasPrice });
        return transactionHash;
    }
}
