import { AbiItem } from 'web3-utils';

export interface ContractDescription {
    abi: AbiItem | AbiItem[],
    address: string,
};
