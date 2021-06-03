import { Monitor } from ".";
import { captureException } from "@sentry/node";
import { TransactionLocation } from "../types/transaction-location";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    })
}

export type CommonBlock = { blockIndex: number; } & TransactionLocation;

export abstract class ConfirmationMonitor<TEventData> extends Monitor<TEventData & TransactionLocation> {
    private latestBlockNumber: number | undefined;

    private readonly _latestTransactionLocation: TransactionLocation | null;
    private readonly _confirmations: number;
    private readonly _delayMilliseconds: number;

    constructor(latestTransactionLocation: TransactionLocation | null, confirmations: number, delayMilliseconds: number = 15 * 1000) {
        super();

        this._latestTransactionLocation = latestTransactionLocation;
        this._confirmations = confirmations;
        this._delayMilliseconds = delayMilliseconds;
    }

    async * loop(): AsyncIterableIterator<TEventData & TransactionLocation> {
        if (this._latestTransactionLocation !== null) {
            this.latestBlockNumber = await this.getBlockIndex(this._latestTransactionLocation.blockHash);
            const events = await this.getEvents(this.latestBlockNumber, this.latestBlockNumber);
            let skip: boolean = true;
            for (const event of events) {
                if (skip) {
                    if (event.txId === this._latestTransactionLocation.txId) {
                        skip = false;
                    }
                    continue;
                } else {
                    yield event;
                }
            }
        } else {
            this.latestBlockNumber = await this.getTipIndex();
        }

        while(true) {
            try {
                const beforeLatestBlockNumber = this.latestBlockNumber;
                const networkLatestBlockNumber = await this.getTipIndex();
                const confirmedLatestBlockNumber = Math.max(networkLatestBlockNumber - this._confirmations, beforeLatestBlockNumber);

                if (beforeLatestBlockNumber < confirmedLatestBlockNumber) {
                    this.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confirmedLatestBlockNumber}`);
                    const eventLogs = await this.getEvents(beforeLatestBlockNumber, confirmedLatestBlockNumber);
                    for (const eventLog of eventLogs) {
                        yield eventLog;
                    }

                    this.latestBlockNumber = confirmedLatestBlockNumber + 1;
                } else {
                    this.debug("Skipped...");
                }
            } catch (error) {
                this.error("Ignore and continue loop without breaking though unexpected error occurred:", error);
                captureException(error);
            }

            await delay(this._delayMilliseconds);
        }
    }

    private debug(message?: any, ...optionalParams: any[]): void {
        console.debug(`[${this.constructor.name}]`, message, ...optionalParams);
    }

    private error(message?: any, ...optionalParams: any[]): void {
        console.error(`[${this.constructor.name}]`, message, ...optionalParams);
    }

    protected abstract getBlockIndex(blockHash: string): Promise<number>;

    protected abstract getTipIndex(): Promise<number>;

    protected abstract getEvents(from: number, to: number): Promise<(TEventData & TransactionLocation)[]>;
}
