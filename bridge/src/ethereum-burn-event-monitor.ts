import { config } from "dotenv/types";
import Web3 from "web3";
import { Contract, EventData } from 'web3-eth-contract';
import { ContractDescription } from "./interfaces/contract-description";
import { Monitor } from "./monitor";

const BURN_EVENT_NAME = "Burn";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    })
}

export class EthereumBurnEventMonitor extends Monitor<EventData> {
    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _confirmations: number;

    private latestBlockNumber: number;

    constructor(web3: Web3, contractDescription: ContractDescription, latestBlockNumber: number, confirmations: number) {
        super();

        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
        this._confirmations = confirmations;
        this.latestBlockNumber = latestBlockNumber;
    }

    async * loop(): AsyncIterableIterator<EventData> {
        const beforeLatestBlockNumber = this.latestBlockNumber;
        const networkLatestBlockNumber = await this._web3.eth.getBlockNumber();
        const confrimedLatestBlockNumber = Math.max(networkLatestBlockNumber - this._confirmations, beforeLatestBlockNumber);

        if (beforeLatestBlockNumber < confrimedLatestBlockNumber) {
            console.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confrimedLatestBlockNumber}`);
            const eventLogs = await this.getBurnPastEvents(beforeLatestBlockNumber, confrimedLatestBlockNumber);
            for (const eventLog of eventLogs) {
                yield eventLog;
            }

            this.latestBlockNumber = confrimedLatestBlockNumber + 1;
        } else {
            console.debug("Skipped...");
        }

        await delay(15 * 1000);
    }

    private async getBurnPastEvents(from: number, to: number): Promise<EventData[]> {
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
