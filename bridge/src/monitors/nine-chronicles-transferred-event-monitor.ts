import { TriggerableMonitor } from "./triggerable-monitor";
import { IHeadlessGraphQLClient } from "../interfaces/headless-graphql-client";
import { NCGTransferredEvent } from "../types/ncg-transferred-event";
import { TransactionLocation } from "../types/transaction-location";


const AUTHORIZED_BLOCK_INTERVAL = 50;

export class NineChroniclesTransferredEventMonitor extends TriggerableMonitor<NCGTransferredEvent> {
    private readonly _headlessGraphQLClient: IHeadlessGraphQLClient;
    private readonly _address: string;

    constructor(latestTransactionLocation: TransactionLocation | null, headlessGraphQLClient: IHeadlessGraphQLClient, address: string) {
        super(latestTransactionLocation);

        this._headlessGraphQLClient = headlessGraphQLClient;
        this._address = address;
    }

    protected async processRemains(transactionLocation: TransactionLocation) {
        const blockHash = transactionLocation.blockHash;
        const blockIndex = await this.getBlockIndex(transactionLocation.blockHash);
        const authorizedBlockIndex = Math.floor((blockIndex + AUTHORIZED_BLOCK_INTERVAL) / AUTHORIZED_BLOCK_INTERVAL) * AUTHORIZED_BLOCK_INTERVAL;
        const remainedEvents: { blockHash: string; events: any[]; }[] = Array(authorizedBlockIndex - blockIndex + 1);
        const events = await this.getEvents(blockIndex);
        const returnEvents = [];
        let skip: boolean = true;
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

        remainedEvents[0] = { blockHash, events: returnEvents };

        for (let i = 1; i <= authorizedBlockIndex - blockIndex; ++i) {
            remainedEvents[i] = { blockHash: await this.getBlockHash(blockIndex + i), events: await this.getEvents(blockIndex + i) };
        }

        return { nextBlockIndex: authorizedBlockIndex, remainedEvents: remainedEvents };
    }

    protected triggerredBlocks(blockIndex: number): number[] {
        if (blockIndex !== 0 && blockIndex % AUTHORIZED_BLOCK_INTERVAL === 0) {
            const blockIndexes = Array(AUTHORIZED_BLOCK_INTERVAL);
            for (let i = 0; i < AUTHORIZED_BLOCK_INTERVAL; ++i) {
                blockIndexes[i] = blockIndex - AUTHORIZED_BLOCK_INTERVAL + 1 + i;
            }
            return blockIndexes;
        }

        return [];
    }

    protected getBlockIndex(blockHash: string) {
        return this._headlessGraphQLClient.getBlockIndex(blockHash);
    }

    protected getTipIndex(): Promise<number> {
        return this._headlessGraphQLClient.getTipIndex();
    }

    protected getBlockHash(blockIndex: number) {
        return this._headlessGraphQLClient.getBlockHash(blockIndex);
    }

    protected async getEvents(blockIndex: number): Promise<(NCGTransferredEvent & TransactionLocation)[]> {
        const blockHash = await this._headlessGraphQLClient.getBlockHash(blockIndex);
        return await this._headlessGraphQLClient.getNCGTransferredEvents(blockHash, this._address);
    }
}
