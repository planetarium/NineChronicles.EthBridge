import Web3 from "web3";
import { Contract, EventData } from 'web3-eth-contract';
import { ConfirmationMonitor } from "./confirmation-monitor";
import { ContractDescription } from "./interfaces/contract-description";
import { TransactionLocation } from "./types/transaction-location";

const BURN_EVENT_NAME = "Burn";

export class EthereumBurnEventMonitor extends ConfirmationMonitor<EventData> {

    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;

    constructor(web3: Web3, contractDescription: ContractDescription, latestTransactionLocation: TransactionLocation | null, confirmations: number) {
        super(latestTransactionLocation, confirmations);

        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
    }

    protected async getBlockIndex(blockHash: string) {
        const block = await this._web3.eth.getBlock(blockHash);
        return block.number;
    }

    protected getTipIndex(): Promise<number> {
        return this._web3.eth.getBlockNumber();
    }

    protected async getEvents(from: number, to: number) {
        // 0xc3599666213715dfabdf658c56a97b9adfad2cd9689690c70c79b20bc61940c9
        const BURN_EVENT_HASH = Web3.utils.sha3("Burn(address,bytes32,uint256)");
        const pastEvents = await this._contract
            .getPastEvents(BURN_EVENT_NAME, {
                address: this._contractDescription.address,
                topics: [BURN_EVENT_HASH],
                fromBlock: from,
                toBlock: to,
            });
        return pastEvents.map(x => {
            return {
                txId: x.transactionHash,
                ...x
            };
        });
    }
}
