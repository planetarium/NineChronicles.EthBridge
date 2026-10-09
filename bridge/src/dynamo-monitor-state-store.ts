import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { TransactionLocation } from "./types/transaction-location";
import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
} from "@aws-sdk/client-dynamodb";

export class DynamoMonitorStateStore implements IMonitorStateStore {
    private readonly _client: DynamoDBClient;
    private readonly _tableName: string;

    private constructor(client: DynamoDBClient, tableName: string) {
        this._client = client;
        this._tableName = tableName;
    }

    static create(): DynamoMonitorStateStore {
        const tableName =
            process.env.DYNAMODB_TABLE_MONITOR_STATE ?? "bridge-monitor-state";
        const client = new DynamoDBClient({});
        return new DynamoMonitorStateStore(client, tableName);
    }

    async store(
        network: string,
        transactionLocation: TransactionLocation
    ): Promise<void> {
        await this._client.send(
            new PutItemCommand({
                TableName: this._tableName,
                Item: {
                    network: { S: network },
                    block_hash: { S: transactionLocation.blockHash },
                    tx_id: transactionLocation.txId
                        ? { S: transactionLocation.txId }
                        : { NULL: true },
                },
            })
        );
    }

    async load(network: string): Promise<TransactionLocation | null> {
        const result = await this._client.send(
            new GetItemCommand({
                TableName: this._tableName,
                Key: {
                    network: { S: network },
                },
            })
        );

        if (!result.Item) {
            return null;
        }

        return {
            blockHash: result.Item.block_hash.S!,
            txId: result.Item.tx_id?.S ?? null,
        };
    }
}
