import { EventData } from "web3-eth-contract";
import { TriggerableMonitor } from "./triggerable-monitor";
import { ContractDescription } from "../types/contract-description";
import { TransactionLocation } from "../types/transaction-location";
import { ethers } from "ethers";

export class EthereumBurnEventMonitor extends TriggerableMonitor<EventData> {
    private readonly _provider: ethers.providers.FallbackProvider;
    private readonly _contract: ethers.Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _confirmations: number;

    constructor(
        provider: ethers.providers.FallbackProvider,
        contractDescription: ContractDescription,
        latestTransactionLocation: TransactionLocation | null,
        confirmations: number
    ) {
        super(latestTransactionLocation);

        this._provider = provider;
        this._contract = new ethers.Contract(
            contractDescription.address,
            contractDescription.abi,
            this._provider
        );
        this._contractDescription = contractDescription;
        this._confirmations = confirmations;
    }
    protected async processRemains(transactionLocation: TransactionLocation) {
        const blockIndex = await this.getBlockIndex(
            transactionLocation.blockHash
        );
        const events = await this.getEvents(blockIndex);
        const returnEvents = [];
        let skip = true;
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

        return {
            nextBlockIndex: blockIndex + this._confirmations,
            remainedEvents: [
                {
                    blockHash: transactionLocation.blockHash,
                    events: returnEvents,
                },
            ],
        };
    }

    protected triggerredBlocks(blockIndex: number): number[] {
        const confirmedBlockIndex = blockIndex - this._confirmations;
        if (confirmedBlockIndex >= 0) {
            return [confirmedBlockIndex];
        }

        return [];
    }

    protected async getBlockIndex(blockHash: string) {
        const block = await this._provider.getBlock(blockHash);
        return block.number;
    }

    protected getTipIndex(): Promise<number> {
        return this._provider.getBlockNumber();
    }

    protected async getBlockHash(blockIndex: number): Promise<string> {
        const block = await this._provider.getBlock(blockIndex);
        return block.hash;
    }

    protected async getEvents(blockIndex: number) {
        const BURN_EVENT_SIG = "Burn(address,bytes32,uint256)";

        const filter = {
            address: this._contractDescription.address,
            topics: [ethers.utils.id(BURN_EVENT_SIG)], // This is equal with Web3.utils.sha3
            fromBlock: blockIndex,
            toBlock: blockIndex,
        };

        const pastEvents = await this._provider.getLogs(filter);
        const parsedEvents = pastEvents.map((log) =>
            this._contract.interface.parseLog(log)
        );

        return parsedEvents.map((parsedEvent, idx) => {
            return {
                ...pastEvents[idx],
                ...parsedEvent,
                txId: pastEvents[idx].transactionHash,
                returnValues: {
                    ...parsedEvent.args,
                    amount: ethers.BigNumber.from(
                        parsedEvent.args.amount
                    ).toString(),
                },
                raw: {
                    data: pastEvents[idx].data,
                    topics: pastEvents[idx].topics,
                },
                event: parsedEvent.name,
            };
        });
    }
}
