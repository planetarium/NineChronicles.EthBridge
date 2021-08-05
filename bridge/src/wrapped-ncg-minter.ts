import Web3 from "web3";
import { TransactionReceipt, TransactionConfig } from "web3-core";
import { Contract } from "web3-eth-contract";
import Decimal from "decimal.js"

import { ContractDescription } from "./types/contract-description";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";

export class WrappedNCGMinter implements IWrappedNCGMinter {
    private readonly _web3: Web3;
    private readonly _contractDescription: ContractDescription;
    private readonly _contract: Contract;
    private readonly _minterAddress: string;

    constructor(web3: Web3, contractDescription: ContractDescription, minterAddress: string) {
        this._web3 = web3;
        this._contractDescription = contractDescription;
        this._contract = new this._web3.eth.Contract(this._contractDescription.abi, this._contractDescription.address);
        this._minterAddress = minterAddress;
    }

    async mint(address: string, amount: Decimal): Promise<TransactionReceipt> {
      //NOTICE: This can be a problem if the number of digits in amount exceeds 9e+14.
      //more detail: https://mikemcl.github.io/decimal.js/#toExpPos
      Decimal.set({toExpPos: 900000000000000});
      console.log(`Minting ${amount.toString()} ${this._contractDescription.address} to ${address}`);
        return this._contract.methods.mint(address, this._web3.utils.toBN(amount.toString())).send({from: this._minterAddress});
    }
}
