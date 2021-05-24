import { Monitor } from "./monitor";
import { captureException } from "@sentry/node";

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
            try {
                const beforeLatestBlockNumber = this.latestBlockNumber;
                const networkLatestBlockNumber = await this.getTipIndex();
                const confrimedLatestBlockNumber = Math.max(networkLatestBlockNumber - this._confirmations, beforeLatestBlockNumber);

                if (beforeLatestBlockNumber < confrimedLatestBlockNumber) {
                    this.debug(`Trying to look up from ${beforeLatestBlockNumber} to ${confrimedLatestBlockNumber}`);
                    const eventLogs = await this.getEvents(beforeLatestBlockNumber, confrimedLatestBlockNumber);
                    for (const eventLog of eventLogs) {
                        yield eventLog;
                    }

                    this.latestBlockNumber = confrimedLatestBlockNumber + 1;
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

    protected abstract getTipIndex(): Promise<number>;

    protected abstract getEvents(from: number, to: number): Promise<TEventData[]>;
}
