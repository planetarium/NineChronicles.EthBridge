import Web3 from "web3";
import { EventLog, BlockNumber } from 'web3-core';
import { Contract } from 'web3-eth-contract';
import { ContractDescription } from "./types/contract-description";

const BURN_EVENT_NAME = "Burn";
const CONFIRMATIONS = 10;

type Callback = (eventLog: EventLog) => void;
type CallbackRemover = () => void;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    })
}

export class Monitor {
    private readonly _web3: Web3;
    private readonly _contract: Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _callbacks: Map<Symbol, Callback>;

    private running: boolean;
    private latestBlockNumber: number;

    constructor(web3: Web3, contractDescription: ContractDescription, latestBlockNumber: number) {
        this._web3 = web3;
        this._contract = new this._web3.eth.Contract(contractDescription.abi, contractDescription.address);
        this._contractDescription = contractDescription;
        this.latestBlockNumber = latestBlockNumber;

        this.running = false;
        this._callbacks = new Map();
    }

    public watch(callback: Callback): CallbackRemover {
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
            const confrimedLatestBlockNumber = Math.max(networkLatestBlockNumber - CONFIRMATIONS, beforeLatestBlockNumber);

            console.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confrimedLatestBlockNumber}`);
            const eventLogs = await this.getBurnPastEvents(beforeLatestBlockNumber, confrimedLatestBlockNumber);
            for (const eventLog of eventLogs) {
                for (const callback of this._callbacks.values()) {
                    callback(eventLog);
                }
            }

            this.latestBlockNumber = confrimedLatestBlockNumber;
            await delay(15 * 1000);
        }
    }

    private async getBurnPastEvents(from: number, to: number): Promise<EventLog[]> {
        return this._contract
            .getPastEvents(BURN_EVENT_NAME, {
                address: this._contractDescription.address,
                fromBlock: from,
                toBlock: to,
            });
    }
}
