import Web3 from "web3";
import { Contract, EventData } from 'web3-eth-contract';
import { TriggerableMonitor } from "./triggerable-monitor";
import { ContractDescription } from "../types/contract-description";
import { TransactionLocation } from "../types/transaction-location";

const BURN_EVENT_NAME = "Burn";

export class EthereumBurnEventMonitor extends TriggerableMonitor<EventData> {
    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _confirmations: number;

    constructor(web3: Web3, contractDescription: ContractDescription, latestTransactionLocation: TransactionLocation | null, confirmations: number) {
        super(latestTransactionLocation);

        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
        this._confirmations = confirmations;
    }
    protected async processRemains(transactionLocation: TransactionLocation): Promise<{ nextBlockIndex: number, remainedEvents: { blockHash: string; events: (EventData & TransactionLocation)[]; }[] }> {
        const blockIndex = await this.getBlockIndex(transactionLocation.blockHash);
        const events = await this.getEvents(blockIndex);
        const returnEvents = [];
        let skip: boolean = true;
        for (const event of events) {
            if (skip) {
                if (event.txId === transactionLocation.txId) {
                    skip = false;
                }
                continue;
            } else {
                returnEvents.push(event);
            }
        }

        return { nextBlockIndex: blockIndex + this._confirmations, remainedEvents: [{ blockHash: transactionLocation.blockHash, events: returnEvents }] };
    }

    protected triggerredBlocks(blockIndex: number): number[] {
        const confirmedBlockIndex = blockIndex - this._confirmations;
        if (confirmedBlockIndex >= 0) {
            return [confirmedBlockIndex];
        }

        return [];
    }

    protected async getBlockIndex(blockHash: string) {
        const block = await this._web3.eth.getBlock(blockHash);
        return block.number;
    }

    protected getTipIndex(): Promise<number> {
        return this._web3.eth.getBlockNumber();
    }

    protected async getBlockHash(blockIndex: number): Promise<string> {
        const block = await this._web3.eth.getBlock(blockIndex);
        return block.hash;
    }

    protected async getEvents(blockIndex: number) {
        // 0xc3599666213715dfabdf658c56a97b9adfad2cd9689690c70c79b20bc61940c9
        const BURN_EVENT_HASH = Web3.utils.sha3("Burn(address,bytes32,uint256)");
        const pastEvents = await this._contract
            .getPastEvents(BURN_EVENT_NAME, {
                address: this._contractDescription.address,
                topics: [BURN_EVENT_HASH],
                fromBlock: blockIndex,
                toBlock: blockIndex,
            });
        return pastEvents.map(x => {
            return {
                txId: x.transactionHash,
                ...x
            };
        });
    }
}
