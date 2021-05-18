import { ConfirmationMonitor } from "./confirmation-monitor";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { INCGTransferredEvent } from "./interfaces/ncg-transferred-event";

export class NineChroniclesTransferredEventMonitor extends ConfirmationMonitor<INCGTransferredEvent> {
    private readonly _headlessGraphQLClient: IHeadlessGraphQLClient;
    private readonly _address: string;

    constructor(latestBlockNumber: number, confirmations: number, headlessGraphQLClient: IHeadlessGraphQLClient, address: string) {
        super(latestBlockNumber, confirmations);

        this._headlessGraphQLClient = headlessGraphQLClient;
        this._address = address;
    }

    protected getTipIndex(): Promise<number> {
        return this._headlessGraphQLClient.getTipIndex();
    }

    protected async getEvents(from: number, to: number): Promise<INCGTransferredEvent[]> {
        const events = [];
        for (let i = from; i <= to; ++i) {
            const blockHash = await this._headlessGraphQLClient.getBlockHash(i);
            events.push(...(await this._headlessGraphQLClient.getNCGTransferredEvents(blockHash, this._address)));
        }

        return events;
    }
}
