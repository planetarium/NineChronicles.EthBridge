import { Monitor } from ".";
import { TransactionLocation } from "../types/transaction-location";
import { BlockHash } from "../types/block-hash";

type ProcessRemainsResult<TEventData> = {
    nextBlockIndex: number;
    remainedEvents: RemainedEvent<TEventData>[];
};
type RemainedEvent<TEventData> = {
    blockHash: string;
    events: (TEventData & TransactionLocation)[];
};

export const DefaultDelayMilliseconds = 15 * 1000;

export abstract class TriggerableMonitor<TEventData> extends Monitor<
    TEventData & TransactionLocation
> {
    private latestBlockNumber: number | undefined;

    private readonly _latestTransactionLocation: TransactionLocation | null;
    private readonly _delayMilliseconds: number;
    private readonly _intervalWithTipIndex: number;

    constructor(
        latestTransactionLocation: TransactionLocation | null,
        delayMilliseconds: number = DefaultDelayMilliseconds,
        intervalWithTipIndex = 0
    ) {
        super();

        this._latestTransactionLocation = latestTransactionLocation;
        this._delayMilliseconds = delayMilliseconds;
        this._intervalWithTipIndex = intervalWithTipIndex;
    }

    async *loop(): AsyncIterableIterator<{
        blockHash: BlockHash;
        events: (TEventData & TransactionLocation)[];
    }> {
        // The scan position can trigger several event blocks (50 for Nine
        // Chronicles) and is distinct from their block indexes. Preserve the
        // pending batch and its first unfinished item across RPC failures.
        let pendingBlockIndexes: number[] | undefined;
        let nextBlockOffset = 0;
        while (!this.stopped) {
            try {
                let idle = false;
                const releaseSession = await this.beginReadSession();
                try {
                    if (this.stopped) return;
                    if (this.latestBlockNumber === undefined) {
                        if (this._latestTransactionLocation !== null) {
                            const { nextBlockIndex, remainedEvents } =
                                await this.processRemains(
                                    this._latestTransactionLocation
                                );

                            for (const remainedEvent of remainedEvents) {
                                if (this.stopped) return;
                                yield remainedEvent;
                            }

                            this.latestBlockNumber = nextBlockIndex;
                        } else {
                            this.latestBlockNumber = await this.getTipIndex();
                        }
                    }
                    const tipIndex = await this.getTipIndex();
                    if (this.stopped) return;
                    this.debug(
                        "Try to check trigger at",
                        this.latestBlockNumber + 1
                    );
                    if (
                        this.latestBlockNumber +
                            1 +
                            this._intervalWithTipIndex <=
                        tipIndex
                    ) {
                        if (
                            pendingBlockIndexes === undefined &&
                            this.shouldCatchUp(
                                this.latestBlockNumber + 1,
                                tipIndex
                            )
                        ) {
                            for await (const item of this.catchUp(
                                this.latestBlockNumber + 1,
                                tipIndex
                            )) {
                                if (this.stopped) return;
                                yield {
                                    blockHash: item.blockHash,
                                    events: item.events,
                                };
                                // Acknowledge only the prefix the consumer completed.
                                this.latestBlockNumber = item.scanIndex;
                            }
                            continue;
                        }
                        if (pendingBlockIndexes === undefined) {
                            pendingBlockIndexes = this.triggerredBlocks(
                                this.latestBlockNumber + 1
                            );
                        }

                        while (nextBlockOffset < pendingBlockIndexes.length) {
                            const blockIndex =
                                pendingBlockIndexes[nextBlockOffset];
                            this.debug(
                                "Execute triggerred block #",
                                blockIndex
                            );
                            const blockHash = await this.getBlockHash(
                                blockIndex
                            );

                            const events = await this.getEvents(blockIndex);
                            if (this.stopped) return;
                            yield { blockHash, events };
                            // Advance only after the consumer resumes the generator.
                            // A read failure retries this item, not the consumed prefix.
                            nextBlockOffset += 1;
                        }

                        this.latestBlockNumber += 1;
                        pendingBlockIndexes = undefined;
                        nextBlockOffset = 0;
                    } else {
                        this.debug(
                            `Skip check trigger current: ${this.latestBlockNumber} / tip: ${tipIndex}`
                        );

                        idle = true;
                    }
                } finally {
                    releaseSession();
                }
                if (idle) await this.wait(this._delayMilliseconds);
            } catch (error) {
                if (this.stopped) return;
                this.error(
                    "Ignore and continue loop without breaking though unexpected error occurred:",
                    error
                );

                // Without this delay, a persistent error (e.g. an RPC outage)
                // would make this loop spin as fast as possible with no
                // backoff at all, hammering the provider with retries.
                await this.wait(this._delayMilliseconds);
            }
        }
    }

    protected async beginReadSession(): Promise<() => void> {
        return () => undefined;
    }

    protected shouldCatchUp(_from: number, _tip: number): boolean {
        return false;
    }

    protected async *catchUp(
        _from: number,
        _tip: number
    ): AsyncIterableIterator<{
        scanIndex: number;
        blockHash: string;
        events: (TEventData & TransactionLocation)[];
    }> {
        throw new Error("Range scanning is not supported by this monitor");
    }

    protected abstract processRemains(
        transactionLocation: TransactionLocation
    ): Promise<ProcessRemainsResult<TEventData>>;

    protected abstract triggerredBlocks(blockIndex: number): number[];

    private debug(message?: any, ...optionalParams: any[]): void {
        console.debug(`[${this.constructor.name}]`, message, ...optionalParams);
    }

    private error(message?: any, ...optionalParams: any[]): void {
        console.error(`[${this.constructor.name}]`, message, ...optionalParams);
    }

    protected abstract getBlockIndex(blockHash: string): Promise<number>;

    protected abstract getBlockHash(blockIndex: number): Promise<string>;

    protected abstract getTipIndex(): Promise<number>;

    protected abstract getEvents(
        blockIndex: number
    ): Promise<(TEventData & TransactionLocation)[]>;
}
