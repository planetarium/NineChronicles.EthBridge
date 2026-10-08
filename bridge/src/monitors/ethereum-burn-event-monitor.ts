import { EventData } from "web3-eth-contract";
import { TriggerableMonitor } from "./triggerable-monitor";
import { ContractDescription } from "../types/contract-description";
import { TransactionLocation } from "../types/transaction-location";
import { ethers } from "ethers";
import { PrimaryRpcProvider } from "../primary-rpc-provider";
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

// Recovery requires archived headers from the saved branch. Fail closed if
// no common ancestor can be proven, rather than skipping replacement burns.
const MAX_REORG_RECOVERY_DEPTH = 1000;

export class EthereumBurnEventMonitor extends TriggerableMonitor<EventData> {
    private readonly _provider: ethers.providers.BaseProvider;
    private readonly _contract: ethers.Contract;
    private readonly _contractDescription: ContractDescription;
    private readonly _confirmations: number;
    private _catchUpChunkSize: number;
    private readonly _maxCatchUpChunkSize: number;
    private _requestedBlock: { index: number; hash: string } | undefined;

    constructor(
        provider: ethers.providers.BaseProvider,
        contractDescription: ContractDescription,
        latestTransactionLocation: TransactionLocation | null,
        confirmations: number,
        catchUpChunkSize: number = DEFAULT_CATCH_UP_CHUNK_SIZE
    ) {
        super(latestTransactionLocation);
        if (!Number.isSafeInteger(catchUpChunkSize) || catchUpChunkSize < 1)
            throw new Error("catchUpChunkSize must be a positive safe integer");
        if (!Number.isSafeInteger(confirmations) || confirmations < 0)
            throw new Error("confirmations must be a nonnegative safe integer");
        // The main provider also serves Safe/legacy minting. A scan must never
        // pin those independent reads or writes to its selected endpoint.
        this._provider =
            provider instanceof PrimaryRpcProvider
                ? provider.createReadProvider()
                : provider;
        this._contractDescription = contractDescription;
        this._contract = new ethers.Contract(
            contractDescription.address,
            contractDescription.abi,
            this._provider
        );
        this._confirmations = confirmations;
        this._catchUpChunkSize = catchUpChunkSize;
        this._maxCatchUpChunkSize = catchUpChunkSize;
    }
    protected async processRemains(transactionLocation: TransactionLocation) {
        const savedBlock = await this.getRecoveryBlock(
            transactionLocation.blockHash
        );
        // The first successful dispatch selects this session's endpoint. Capture
        // its epoch afterward so selecting a healthy fallback is not a change
        // within the recovery read itself.
        const readEpoch = this.getReadEpoch();
        const blockIndex = savedBlock.number;
        const tipIndex = await this.getTipIndex();
        if (tipIndex < blockIndex + this._confirmations) {
            // Also wait before orphan recovery: a lagging endpoint must not move
            // the persisted checkpoint backward before it confirms this height.
            throw new Error(
                `Cannot resume checkpoint block ${blockIndex}: RPC tip ${tipIndex} has fewer than ${this._confirmations} confirmations`
            );
        }
        const anchor = await this.getRecoveryBlock(blockIndex);
        const assertStableRead = async () => {
            const currentAnchor = await this.getRecoveryBlock(blockIndex);
            if (
                currentAnchor.hash !== anchor.hash ||
                this.getReadEpoch() !== readEpoch
            ) {
                throw new Error(
                    `Chain or RPC endpoint changed while resuming block ${blockIndex}`
                );
            }
        };

        if (savedBlock.hash !== anchor.hash) {
            let ancestor = savedBlock;
            let depth = 0;
            while (
                ancestor.hash !==
                (await this.getRecoveryBlock(ancestor.number)).hash
            ) {
                if (
                    depth >= MAX_REORG_RECOVERY_DEPTH ||
                    ancestor.number === 0
                ) {
                    throw new Error(
                        `Cannot recover orphan checkpoint: no common ancestor within ${MAX_REORG_RECOVERY_DEPTH} blocks`
                    );
                }
                if (!ancestor.parentHash) {
                    throw new Error(
                        `Cannot recover orphan checkpoint: parent hash unavailable at block ${ancestor.number}`
                    );
                }
                const parent = await this.getRecoveryBlock(ancestor.parentHash);
                if (parent.number !== ancestor.number - 1) {
                    throw new Error(
                        `Cannot recover orphan checkpoint: invalid parent height at block ${ancestor.number}`
                    );
                }
                ancestor = parent;
                depth += 1;
            }
            await assertStableRead();
            // Replaying the replaced branch relies on the observer's persisted
            // source-transaction history in the same database to suppress payouts
            // for transactions that were already processed and are included again.
            return {
                nextBlockIndex: ancestor.number + this._confirmations,
                remainedEvents: [{ blockHash: ancestor.hash, events: [] }],
            };
        }

        const events = await this.fetchEvents(blockIndex, blockIndex);
        if (events.some((event) => event.blockHash !== anchor.hash)) {
            throw new Error(
                `Burn logs disagree with checkpoint block ${blockIndex}`
            );
        }
        let returnEvents = events;
        if (transactionLocation.txId !== null) {
            const cursorIndex = events.findIndex(
                (event) => event.txId === transactionLocation.txId
            );
            if (cursorIndex === -1) {
                throw new Error(
                    `Checkpoint transaction ${transactionLocation.txId} is missing from block ${blockIndex}`
                );
            }
            returnEvents = events.slice(cursorIndex + 1);
        }
        // A null cursor proves no transaction was saved, not that the RPC logs
        // are empty. Replay them; the same-database observer history deduplicates.
        await assertStableRead();

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

    protected getReadEpoch(): number | undefined {
        return this._provider instanceof PrimaryRpcProvider
            ? this._provider.readEpoch
            : undefined;
    }

    protected async beginReadSession(): Promise<() => void> {
        return this._provider instanceof PrimaryRpcProvider
            ? this._provider.beginReadSession()
            : () => undefined;
    }

    private async getRecoveryBlock(
        indexOrHash: number | string
    ): Promise<ethers.providers.Block> {
        const block = await this._provider.getBlock(indexOrHash);
        if (
            !block ||
            !Number.isSafeInteger(block.number) ||
            block.number < 0 ||
            !block.hash
        ) {
            throw new Error(
                `Cannot recover checkpoint: block header unavailable or invalid for ${indexOrHash}`
            );
        }
        if (
            typeof indexOrHash === "string"
                ? block.hash !== indexOrHash
                : block.number !== indexOrHash
        ) {
            throw new Error(
                `Cannot recover checkpoint: block header disagrees with ${indexOrHash}`
            );
        }
        return block;
    }

    protected triggerredBlocks(blockIndex: number): number[] {
        const confirmed = blockIndex - this._confirmations;
        return confirmed >= 0 ? [confirmed] : [];
    }

    protected async getBlockIndex(hash: string): Promise<number> {
        return (await this.getRecoveryBlock(hash)).number;
    }

    protected async getTipIndex(): Promise<number> {
        const tip = await this._provider.getBlockNumber();
        if (!Number.isSafeInteger(tip) || tip < 0)
            throw new Error("RPC returned an invalid tip height");
        return tip;
    }

    protected async getBlockHash(index: number): Promise<string> {
        const block = await this.getRecoveryBlock(index);
        this._requestedBlock = { index, hash: block.hash };
        return block.hash;
    }

    private async assertAnchor(
        index: number,
        hash: string,
        epoch: number | undefined
    ): Promise<void> {
        const current = await this.getRecoveryBlock(index);
        if (current.hash !== hash || this.getReadEpoch() !== epoch)
            throw new Error(
                `Chain or RPC endpoint changed while reading burn events at block ${index}`
            );
    }

    protected async getEvents(index: number): Promise<BurnLogEvent[]> {
        const hash =
            this._requestedBlock?.index === index
                ? this._requestedBlock.hash
                : await this.getBlockHash(index);
        // The requested hash is only reusable for the immediately following read.
        this._requestedBlock = undefined;
        const epoch = this.getReadEpoch();
        const events = await this.fetchEvents(index, index);
        if (events.some((event) => event.blockHash !== hash))
            throw new Error(`Burn logs disagree with block hash at ${index}`);
        await this.assertAnchor(index, hash, epoch);
        return events;
    }

    protected shouldCatchUp(from: number, tip: number): boolean {
        // A single confirmed block keeps its two-header path; any wider range
        // batches immediately, without waiting for more blocks.
        return tip - from + 1 > 1 && from >= this._confirmations;
    }

    protected async *catchUp(from: number, tip: number) {
        const start = from - this._confirmations;
        let chunkSize = this._catchUpChunkSize;
        while (true) {
            const end = Math.min(
                start + chunkSize - 1,
                tip - this._confirmations
            );
            const hash = await this.getBlockHash(end);
            const epoch = this.getReadEpoch();
            let events: BurnLogEvent[];
            try {
                events = await this.fetchEvents(start, end);
            } catch (error) {
                if (chunkSize > 1 && isBlockRangeTooLargeError(error)) {
                    chunkSize = Math.max(1, Math.floor(chunkSize / 2));
                    continue;
                }
                throw error;
            }
            await this.assertAnchor(end, hash, epoch);
            // Remember the working size, but grow back after each success so
            // one dense range does not shrink scans for the process lifetime.
            this._catchUpChunkSize = Math.min(
                this._maxCatchUpChunkSize,
                chunkSize * 2
            );
            const byBlock = new Map<number, BurnLogEvent[]>();
            for (const event of events) {
                const group = byBlock.get(event.blockNumber) ?? [];
                group.push(event);
                byBlock.set(event.blockNumber, group);
            }
            for (const [index, group] of byBlock) {
                const eventHash = await this.getBlockHash(index);
                await this.assertAnchor(end, hash, epoch);
                if (group.some((event) => event.blockHash !== eventHash))
                    throw new Error(
                        `Burn logs disagree with block hash at ${index}`
                    );
                if (this.stopped) return;
                yield {
                    scanIndex: index + this._confirmations,
                    blockHash: eventHash,
                    events: group,
                };
            }
            // Coalesce only the verified empty suffix. On error the loop resumes
            // after the last acknowledged event, re-reading all uncommitted gaps.
            if (!byBlock.has(end)) {
                await this.assertAnchor(end, hash, epoch);
                if (this.stopped) return;
                yield {
                    scanIndex: end + this._confirmations,
                    blockHash: hash,
                    events: [],
                };
            }
            return;
        }
    }

    private async fetchEvents(
        fromBlock: number,
        toBlock: number
    ): Promise<BurnLogEvent[]> {
        const topic = ethers.utils.id("Burn(address,bytes32,uint256)");
        const logs = await this._provider.getLogs({
            address: this._contractDescription.address,
            topics: [topic],
            fromBlock,
            toBlock,
        });
        const seen = new Set<string>();
        for (const log of logs) {
            const key = `${log.blockNumber}:${log.logIndex}`;
            if (
                !Number.isSafeInteger(log.blockNumber) ||
                log.blockNumber < fromBlock ||
                log.blockNumber > toBlock ||
                !Number.isSafeInteger(log.logIndex) ||
                log.logIndex < 0 ||
                !Number.isSafeInteger(log.transactionIndex) ||
                log.transactionIndex < 0 ||
                log.removed ||
                log.address.toLowerCase() !==
                    this._contractDescription.address.toLowerCase() ||
                log.topics[0] !== topic ||
                seen.has(key)
            )
                throw new Error("RPC returned invalid or duplicate burn logs");
            seen.add(key);
        }
        return [...logs]
            .sort(
                (a, b) =>
                    a.blockNumber - b.blockNumber ||
                    a.transactionIndex - b.transactionIndex ||
                    a.logIndex - b.logIndex
            )
            .map((log) =>
                toBurnLogEvent(log, this._contract.interface.parseLog(log))
            );
    }
}
