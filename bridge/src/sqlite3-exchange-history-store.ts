import {
    ExchangeHistory,
    IExchangeHistoryStore,
} from "./interfaces/exchange-history-store";
import { Database } from "sqlite3";
import { promisify } from "util";

export class Sqlite3ExchangeHistoryStore implements IExchangeHistoryStore {
    private readonly _database: Database;
    private closed: boolean;

    private constructor(database: Database) {
        this._database = database;
        this.closed = false;
    }
    put(history: ExchangeHistory): Promise<void> {
        this.checkClosed();

        const { network, tx_id, sender, recipient, amount, timestamp } =
            history;

        const run: (sql: string, params: any[]) => Promise<void> = promisify(
            this._database.run.bind(this._database)
        );
        return run(
            "INSERT INTO exchange_histories(network, tx_id, sender, recipient, amount, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
            [network, tx_id, sender, recipient, amount, timestamp]
        );
    }

    async exist(tx_id: string): Promise<boolean> {
        this.checkClosed();

        const get: (
            sql: string,
            params: any[]
        ) => Promise<{ tx_id: string | null }> = promisify(
            this._database.get.bind(this._database)
        );
        const row = await get(
            "SELECT tx_id FROM exchange_histories WHERE tx_id = ?",
            [tx_id]
        );
        return row !== undefined;
    }

    async transferredAmountInLast24Hours(
        network: string,
        sender: string
    ): Promise<number> {
        this.checkClosed();
        const get: (
            sql: string,
            params: any[]
        ) => Promise<{ total_amount: string | null }> = promisify(
            this._database.get.bind(this._database)
        );
        const row = await get(
            "SELECT SUM(amount) as total_amount FROM exchange_histories WHERE network = ? AND sender = ? AND datetime(timestamp) > datetime('now', '-1 day');",
            [network, sender]
        );

        return parseInt(row["total_amount"] ?? "0");
    }

    static async open(path: string): Promise<Sqlite3ExchangeHistoryStore> {
        const database = new Database(path);
        await this.initialize(database);
        return new Sqlite3ExchangeHistoryStore(database);
    }

    private static async initialize(database: Database): Promise<void> {
        const CREATE_TABLE_QUERY = `CREATE TABLE IF NOT EXISTS exchange_histories (
            network TEXT NOT NULL,
            tx_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            recipient TEXT NOT NULL,
            amount TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            PRIMARY KEY(network, tx_id)
        );
        CREATE INDEX IF NOT EXISTS exchange_history_idx ON exchange_histories(sender);`;
        return new Promise((resolve, error) => {
            database.run(CREATE_TABLE_QUERY, (e) => {
                if (e) {
                    error();
                } else {
                    resolve();
                }
            });
        });
    }

    close(): void {
        this.checkClosed();

        this._database.close();
        this.closed = true;
    }

    private checkClosed(): void {
        if (this.closed) {
            throw new Error(
                "This internal SQLite3 database is already closed."
            );
        }
    }
}
