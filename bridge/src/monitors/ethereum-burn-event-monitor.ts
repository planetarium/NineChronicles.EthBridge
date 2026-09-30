import { EventData } from "web3-eth-contract";
import { TriggerableMonitor } from "./triggerable-monitor";
import { ContractDescription } from "../types/contract-description";
import { TransactionLocation } from "../types/transaction-location";
import { ethers } from "ethers";
import { isRetryableEthereumError } from "../rpc-retry";

// Default maximum number of blocks fetched in a single getLogs() call while
// catching up from far behind the chain head. Kept well under common RPC
// provider getLogs range/result limits (e.g. Infura/Alchemy typically allow a
// few thousand blocks per call on standard tiers).
const DEFAULT_CATCH_UP_CHUNK_SIZE = 2000;

function toBurnLogEvent(
    pastEvent: ethers.providers.Log,
    parsedEvent: ethers.utils.LogDescription
) {
    return {
        ...pastEvent,
        ...parsedEvent,
        txId: pastEvent.transactionHash,
        returnValues: {
            ...parsedEvent.args,
            amount: ethers.BigNumber.from(parsedEvent.args.amount).toString(),
        },
        raw: {
            data: pastEvent.data,
            topics: pastEvent.topics,
        },
        event: parsedEvent.name,
    };
}

type BurnLogEvent = ReturnType<typeof toBurnLogEvent>;

// Check structured errors before wrapper messages: ethers includes serialized
// child errors in "failed to meet quorum" messages, including unrelated errors.
export function isBlockRangeTooLargeError(error: unknown): boolean {
    function inspect(value: unknown, depth = 0): boolean {
        if (value === null || typeof value !== "object" || depth > 10) {
            return false;
        }
        const err = value as {
            message?: unknown;
            error?: unknown;
            body?: unknown;
            results?: { error?: unknown }[];
        };
        if (Array.isArray(err.results)) {
            const errors = err.results
                .map((result) => result.error)
                .filter((child) => child !== undefined);
            const rangeErrors = errors.map((child) =>
                inspect(child, depth + 1)
            );
            return (
                rangeErrors.some(Boolean) &&
                errors.every(
                    (child, index) =>
                        rangeErrors[index] || isRetryableEthereumError(child)
                )
            );
        }
        if (err.error !== undefined) {
            return inspect(err.error, depth + 1);
        }
        if (typeof err.body === "string") {
            try {
                const body = JSON.parse(err.body);
                if (body.error !== undefined) {
                    return inspect(body.error, depth + 1);
                }
            } catch (_) {
                // A non-JSON transport response is not a range error.
            }
        }
        return (
            typeof err.message === "string" &&
            /query returned more than|too many (results|logs)|(?:block.*range|range.*block).*(?:too (?:large|wide)|exceed|limit|maximum)|(?:limit|maximum|exceed).*block.*range|response.*size.*(?:exceed|limit)/i.test(
                err.message
            )
        );
    }
    return inspect(error);
}

export class EthereumBurnEventMonitor extends TriggerableMonitor<EventData> {
    private readonly _provider: ethers.providers.BaseProvider;
    private readonly _contract: ethers.Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _confirmations: number;
    // Not readonly: shrunk in place (see `getEvents`) whenever the RPC
    // provider rejects a getLogs() range as too large, so the smaller,
    // working size is remembered for later chunks instead of repeatedly
    // re-discovering the same limit.
    private _catchUpChunkSize: number;

    // Set every time getTipIndex() is called (i.e. once per monitor loop
    // iteration), so getEvents() can tell how far behind the chain head it
    // currently is without an extra RPC call.
    private _lastKnownTipIndex: number | undefined;
    private _cacheAnchor: { index: number; hash: string } | undefined;
    private _requestedBlock: { index: number; hash: string } | undefined;
    // Events already fetched as part of a batched getLogs() range call,
    // keyed by block number, waiting to be consumed by later single-block
    // getEvents() calls for the rest of that range.
    private readonly _cachedEventsByBlock: Map<number, BurnLogEvent[]> =
        new Map();

    constructor(
        provider: ethers.providers.BaseProvider,
        contractDescription: ContractDescription,
        latestTransactionLocation: TransactionLocation | null,
        confirmations: number,
        catchUpChunkSize: number = DEFAULT_CATCH_UP_CHUNK_SIZE
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
        this._catchUpChunkSize = catchUpChunkSize;
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

    protected async getTipIndex(): Promise<number> {
        const tipIndex = await this._provider.getBlockNumber();
        this._lastKnownTipIndex = tipIndex;
        return tipIndex;
    }

    protected async getBlockHash(blockIndex: number): Promise<string> {
        const block = await this._provider.getBlock(blockIndex);
        this._requestedBlock = { index: blockIndex, hash: block.hash };
        return block.hash;
    }

    private invalidateCache(): void {
        this._cachedEventsByBlock.clear();
        this._cacheAnchor = undefined;
    }

    private async assertBlockHash(index: number, hash: string): Promise<void> {
        const block = await this._provider.getBlock(index);
        if (block === null || block.hash !== hash) {
            this.invalidateCache();
            throw new Error(
                `Chain changed while reading burn events at block ${index}`
            );
        }
    }

    private async validateEvents(
        blockIndex: number,
        events: BurnLogEvent[],
        recheckBlock = true
    ): Promise<void> {
        const requested = this._requestedBlock;
        const hash =
            requested?.index === blockIndex
                ? requested.hash
                : (await this._provider.getBlock(blockIndex)).hash;
        if (events.some((event) => event.blockHash !== hash)) {
            this.invalidateCache();
            throw new Error(
                `Burn logs disagree with block hash at ${blockIndex}`
            );
        }
        if (recheckBlock) {
            await this.assertBlockHash(blockIndex, hash);
        }
    }

    protected async getEvents(blockIndex: number): Promise<BurnLogEvent[]> {
        const cachedEvents = this._cachedEventsByBlock.get(blockIndex);
        if (cachedEvents !== undefined && this._cacheAnchor !== undefined) {
            await this.validateEvents(blockIndex, cachedEvents, false);
            // The anchor commits to every ancestor in this range, including
            // empty blocks. Check it after the loop's current-block read.
            await this.assertBlockHash(
                this._cacheAnchor.index,
                this._cacheAnchor.hash
            );
            this._cachedEventsByBlock.delete(blockIndex);
            return cachedEvents;
        }
        this.invalidateCache();

        // Only ever fetch (and cache ahead) blocks that are already at least
        // `_confirmations` deep as of the last known tip - i.e. exactly the
        // set of blocks the caller could otherwise have requested one at a
        // time - so batching here can never serve data for a block that
        // hasn't reached the same confirmation depth the rest of this
        // monitor already relies on (see `triggerredBlocks`). A range anchor
        // also detects deeper reorgs before cached events, including empty
        // results, can be consumed.
        const confirmedTipIndex =
            this._lastKnownTipIndex !== undefined
                ? this._lastKnownTipIndex - this._confirmations
                : blockIndex;

        // Retries with a shrinking chunk size specifically when the provider
        // rejects the range as too large - as opposed to any other error,
        // which is rethrown immediately and handled by the caller's normal
        // retry/backoff (see `TriggerableMonitor.loop`). Without this, a
        // chunk size that exceeds the provider's own getLogs() range/result
        // limit would otherwise repeat the exact same oversized request
        // forever instead of adapting to it.
        let chunkSize = this._catchUpChunkSize;
        while (true) {
            const chunkEndBlockIndex = Math.max(
                blockIndex,
                Math.min(blockIndex + chunkSize - 1, confirmedTipIndex)
            );

            let events: BurnLogEvent[];
            // In steady state, the loop already read this single block's
            // hash immediately before getEvents. Reuse it as the pre-read
            // anchor; the post-read check also validates the yielded hash.
            const requested = this._requestedBlock;
            const reuseCurrentAnchor =
                chunkEndBlockIndex === blockIndex &&
                requested?.index === blockIndex;
            const anchor = reuseCurrentAnchor
                ? requested
                : await this._provider.getBlock(chunkEndBlockIndex);
            if (anchor === null) {
                throw new Error(
                    `Missing range anchor block ${chunkEndBlockIndex}`
                );
            }
            try {
                events = await this.fetchEvents(blockIndex, chunkEndBlockIndex);
            } catch (error) {
                if (chunkSize > 1 && isBlockRangeTooLargeError(error)) {
                    chunkSize = Math.max(1, Math.floor(chunkSize / 2));
                    console.error(
                        `getLogs() range [${blockIndex}, ${chunkEndBlockIndex}] was rejected as too large; ` +
                            `shrinking the catch-up chunk size to ${chunkSize} block(s) and retrying.`,
                        error
                    );
                    continue;
                }

                throw error;
            }

            await this.assertBlockHash(chunkEndBlockIndex, anchor.hash);
            await this.validateEvents(
                blockIndex,
                events.filter((event) => event.blockNumber === blockIndex),
                !reuseCurrentAnchor
            );

            // Remember the (possibly shrunk) working chunk size for later
            // calls, so it doesn't have to re-discover the same provider
            // limit from scratch every time.
            this._catchUpChunkSize = chunkSize;

            if (chunkEndBlockIndex === blockIndex) {
                return events;
            }

            this._cacheAnchor = {
                index: chunkEndBlockIndex,
                hash: anchor.hash,
            };

            // Bucket the wider range's events by block so the rest of this
            // chunk's later, individual getEvents(blockIndex) calls (made as
            // the caller advances one block at a time) are served from cache
            // instead of triggering another getLogs() round-trip each time.
            const eventsByBlock = new Map<number, BurnLogEvent[]>();
            for (let i = blockIndex + 1; i <= chunkEndBlockIndex; ++i) {
                eventsByBlock.set(i, []);
            }
            const eventsForBlockIndex: BurnLogEvent[] = [];
            for (const event of events) {
                if (event.blockNumber === blockIndex) {
                    eventsForBlockIndex.push(event);
                } else {
                    eventsByBlock.get(event.blockNumber)?.push(event);
                }
            }
            for (const [cachedBlockIndex, cachedBlockEvents] of eventsByBlock) {
                this._cachedEventsByBlock.set(
                    cachedBlockIndex,
                    cachedBlockEvents
                );
            }

            return eventsForBlockIndex;
        }
    }

    private async fetchEvents(
        fromBlockIndex: number,
        toBlockIndex: number
    ): Promise<BurnLogEvent[]> {
        const BURN_EVENT_SIG = "Burn(address,bytes32,uint256)";

        const filter = {
            address: this._contractDescription.address,
            topics: [ethers.utils.id(BURN_EVENT_SIG)], // This is equal with Web3.utils.sha3
            fromBlock: fromBlockIndex,
            toBlock: toBlockIndex,
        };

        const pastEvents = await this._provider.getLogs(filter);
        const parsedEvents = pastEvents.map((log) =>
            this._contract.interface.parseLog(log)
        );

        return parsedEvents.map((parsedEvent, idx) =>
            toBurnLogEvent(pastEvents[idx], parsedEvent)
        );
    }
}
