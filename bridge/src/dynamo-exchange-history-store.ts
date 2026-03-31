import {
    ExchangeHistory,
    IExchangeHistoryStore,
} from "./interfaces/exchange-history-store";
import { TransactionStatus } from "./types/transaction-status";
import {
    DynamoDBClient,
    PutItemCommand,
    GetItemCommand,
    UpdateItemCommand,
    ScanCommand,
    QueryCommand,
    ConditionalCheckFailedException,
} from "@aws-sdk/client-dynamodb";

export class DynamoExchangeHistoryStore implements IExchangeHistoryStore {
    private readonly _client: DynamoDBClient;
    private readonly _tableName: string;

    private constructor(client: DynamoDBClient, tableName: string) {
        this._client = client;
        this._tableName = tableName;
    }

    static create(): DynamoExchangeHistoryStore {
        const tableName =
            process.env.DYNAMODB_TABLE_EXCHANGE_HISTORY ??
            "bridge-exchange-histories";
        const client = new DynamoDBClient({});
        return new DynamoExchangeHistoryStore(client, tableName);
    }

    async put(history: ExchangeHistory): Promise<void> {
        const { network, tx_id, sender, recipient, timestamp, amount, status } =
            history;

        try {
            await this._client.send(
                new PutItemCommand({
                    TableName: this._tableName,
                    Item: {
                        tx_id: { S: tx_id },
                        network: { S: network },
                        sender: { S: sender },
                        recipient: { S: recipient },
                        timestamp: { S: timestamp },
                        amount: { N: String(amount) },
                        status: { S: status },
                    },
                    ConditionExpression: "attribute_not_exists(tx_id)",
                })
            );
        } catch (e) {
            if (e instanceof ConditionalCheckFailedException) {
                // Already exists — idempotent, ignore
                return;
            }
            throw e;
        }
    }

    async exist(tx_id: string): Promise<boolean> {
        const result = await this._client.send(
            new GetItemCommand({
                TableName: this._tableName,
                Key: {
                    tx_id: { S: tx_id },
                },
            })
        );

        return result.Item !== undefined;
    }

    async transferredAmountInLast24Hours(
        network: string,
        sender: string
    ): Promise<number> {
        const cutoff = new Date(
            Date.now() - 24 * 60 * 60 * 1000
        ).toISOString();

        const result = await this._client.send(
            new QueryCommand({
                TableName: this._tableName,
                IndexName: "network-timestamp-index",
                KeyConditionExpression:
                    "network = :network AND #ts > :cutoff",
                FilterExpression: "sender = :sender",
                ExpressionAttributeNames: {
                    "#ts": "timestamp",
                },
                ExpressionAttributeValues: {
                    ":network": { S: network },
                    ":cutoff": { S: cutoff },
                    ":sender": { S: sender },
                },
            })
        );

        const items = result.Items ?? [];
        return items.reduce(
            (
                sum: number,
                item: Record<string, { N?: string; S?: string }>
            ) => {
                return sum + parseFloat(item.amount?.N ?? "0");
            },
            0
        );
    }

    async updateStatus(
        tx_id: string,
        status: TransactionStatus.COMPLETED | TransactionStatus.FAILED
    ): Promise<void> {
        await this._client.send(
            new UpdateItemCommand({
                TableName: this._tableName,
                Key: {
                    tx_id: { S: tx_id },
                },
                UpdateExpression: "SET #s = :status",
                ExpressionAttributeNames: {
                    "#s": "status",
                },
                ExpressionAttributeValues: {
                    ":status": { S: status },
                },
            })
        );
    }

    async getPendingTransactions(): Promise<ExchangeHistory[]> {
        const result = await this._client.send(
            new ScanCommand({
                TableName: this._tableName,
                FilterExpression: "#s = :pending",
                ExpressionAttributeNames: {
                    "#s": "status",
                },
                ExpressionAttributeValues: {
                    ":pending": { S: TransactionStatus.PENDING },
                },
            })
        );

        const items = result.Items ?? [];
        return items.map(
            (item: Record<string, { N?: string; S?: string }>) => ({
                network: item.network?.S ?? "",
                tx_id: item.tx_id?.S ?? "",
                sender: item.sender?.S ?? "",
                recipient: item.recipient?.S ?? "",
                timestamp: item.timestamp?.S ?? "",
                amount: parseFloat(item.amount?.N ?? "0"),
                status: (item.status?.S ??
                    TransactionStatus.PENDING) as TransactionStatus,
            })
        );
    }
}
