import { config } from "dotenv/types";
import Web3 from "web3";
import { Contract, EventData } from 'web3-eth-contract';
import { ContractDescription } from "./interfaces/contract-description";

const BURN_EVENT_NAME = "Burn";

type Callback = (eventLog: EventData) => void;
type CallbackRemover = () => void;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    })
}

export class EthereumBurnEventMonitor {
    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _callbacks: Map<Symbol, Callback>;
    private readonly _confirmations: number;

    private running: boolean;
    private latestBlockNumber: number;

    constructor(web3: Web3, contractDescription: ContractDescription, latestBlockNumber: number, confirmations: number) {
        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
        this._confirmations = confirmations;
        this.latestBlockNumber = latestBlockNumber;

        this.running = false;
        this._callbacks = new Map();
    }

    public subscribe(callback: Callback): CallbackRemover {
        const symbol = Symbol();
        this._callbacks.set(symbol, callback);
        return () => {
            this._callbacks.delete(symbol);
        };
    }

    public run() {
        this.running = true;
        this.startMonitoring();
    }

    public stop(): void {
        this.running = false;
    }

    private async startMonitoring(): Promise<void> {
        while (this.running) {
            const beforeLatestBlockNumber = this.latestBlockNumber;
            const networkLatestBlockNumber = await this._web3.eth.getBlockNumber();
            const confrimedLatestBlockNumber = Math.max(networkLatestBlockNumber - this._confirmations, beforeLatestBlockNumber);

            if (beforeLatestBlockNumber < confrimedLatestBlockNumber) {
                console.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confrimedLatestBlockNumber}`);
                const eventLogs = await this.getBurnPastEvents(beforeLatestBlockNumber, confrimedLatestBlockNumber);
                for (const eventLog of eventLogs) {
                    for (const callback of this._callbacks.values()) {
                        callback(eventLog);
                    }
                }

                this.latestBlockNumber = confrimedLatestBlockNumber + 1;
            } else {
                console.debug("Skipped...");
            }

            await delay(15 * 1000);
        }
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
