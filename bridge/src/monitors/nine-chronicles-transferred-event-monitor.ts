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

    protected async getEvents(from: number, to: number) {
        const events = [];
        for (let i = from; i <= to; ++i) {
            const blockHash = await this._headlessGraphQLClient.getBlockHash(i);
            events.push(...(await (await this._headlessGraphQLClient.getNCGTransferredEvents(blockHash, this._address))));
        }

        return events;
    }
}
