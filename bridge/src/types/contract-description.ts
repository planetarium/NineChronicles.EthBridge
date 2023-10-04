import { AbiItem } from "web3-utils";
import { ContractInterface } from "ethers";

export interface ContractDescription {
    abi: ContractInterface;
    address: string;
}
