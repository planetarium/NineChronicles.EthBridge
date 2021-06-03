import { ConfirmationMonitor } from "./confirmation-monitor";
import { IHeadlessGraphQLClient } from "../interfaces/headless-graphql-client";
import { NCGTransferredEvent } from "../types/ncg-transferred-event";
import { TransactionLocation } from "../types/transaction-location";

export class NineChroniclesTransferredEventMonitor extends ConfirmationMonitor<NCGTransferredEvent> {
    private readonly _headlessGraphQLClient: IHeadlessGraphQLClient;
    private readonly _address: string;

    constructor(latestTransactionLocation: TransactionLocation | null, confirmations: number, headlessGraphQLClient: IHeadlessGraphQLClient, address: string) {
        super(latestTransactionLocation, confirmations);

        this._headlessGraphQLClient = headlessGraphQLClient;
        this._address = address;
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
