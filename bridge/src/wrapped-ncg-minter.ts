import Web3 from "web3";
import { TransactionReceipt, TransactionConfig } from "web3-core";
import { Contract } from "web3-eth-contract";

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

    async mint(address: string, amount: number): Promise<TransactionReceipt> {
        return this._contract.methods.mint(address, amount).send({from: this._minterAddress});
    }
}
