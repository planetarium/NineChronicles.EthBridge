import Web3 from "web3";
import { Contract, EventData } from 'web3-eth-contract';
import { ConfirmationMonitor } from "./confirmation-monitor";
import { ContractDescription } from "./interfaces/contract-description";

const BURN_EVENT_NAME = "Burn";

export class EthereumBurnEventMonitor extends ConfirmationMonitor<EventData> {

    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;

    constructor(web3: Web3, contractDescription: ContractDescription, latestBlockNumber: number, confirmations: number) {
        super(latestBlockNumber, confirmations);

        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
    }

    protected getTipIndex(): Promise<number> {
        return this._web3.eth.getBlockNumber();
    }

    protected getEvents(from: number, to: number): Promise<EventData[]> {
        // 0xc3599666213715dfabdf658c56a97b9adfad2cd9689690c70c79b20bc61940c9
        const BURN_EVENT_HASH = Web3.utils.sha3("Burn(address,bytes32,uint256)");
        return this._contract
            .getPastEvents(BURN_EVENT_NAME, {
                address: this._contractDescription.address,
                topics: [BURN_EVENT_HASH],
                fromBlock: from,
                toBlock: to,
            });
    }
}
