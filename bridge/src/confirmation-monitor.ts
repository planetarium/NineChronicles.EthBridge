import { Monitor } from "./monitor";

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(() => { resolve() }, ms);
    })
}

export abstract class ConfirmationMonitor<TEventData> extends Monitor<TEventData> {
    private latestBlockNumber: number;

    private readonly _confirmations: number;
    private readonly _delayMilliseconds: number;

    constructor(latestBlockNumber: number, confirmations: number, delayMilliseconds: number = 15 * 1000) {
        super();

        this.latestBlockNumber = latestBlockNumber;

        this._confirmations = confirmations;
        this._delayMilliseconds = delayMilliseconds;
    }

    async * loop(): AsyncIterableIterator<TEventData> {
        while(true) {
            const beforeLatestBlockNumber = this.latestBlockNumber;
            const networkLatestBlockNumber = await this.getTipIndex();
            const confrimedLatestBlockNumber = Math.max(networkLatestBlockNumber - this._confirmations, beforeLatestBlockNumber);

            if (beforeLatestBlockNumber < confrimedLatestBlockNumber) {
                console.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confrimedLatestBlockNumber}`);
                const eventLogs = await this.getEvents(beforeLatestBlockNumber, confrimedLatestBlockNumber);
                for (const eventLog of eventLogs) {
                    yield eventLog;
                }

                this.latestBlockNumber = confrimedLatestBlockNumber + 1;
            } else {
                console.debug("Skipped...");
            }

            await delay(this._delayMilliseconds);
        }
    }

    protected abstract getTipIndex(): Promise<number>;

    protected abstract getEvents(from: number, to: number): Promise<TEventData[]>;
}
