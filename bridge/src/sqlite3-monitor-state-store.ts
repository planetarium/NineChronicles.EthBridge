import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Database } from "sqlite3";
import { TransactionLocation } from "./types/transaction-location";

export class Sqlite3MonitorStateStore implements IMonitorStateStore {
    private readonly _database: Database;
    private closed: boolean;

    private constructor(database: Database) {
        this._database = database;
        this.closed = false;
    }

    static async open(path: string): Promise<Sqlite3MonitorStateStore> {
        const database = new Database(path);
        await this.initialize(database);
        return new Sqlite3MonitorStateStore(database);
    }

    private static async initialize(database: Database): Promise<void> {
        const CREATE_TABLE_QUERY = `CREATE TABLE IF NOT EXISTS monitor_states (
            network TEXT PRIMARY KEY,
            block_hash TEXT NOT NULL,
            tx_id TEXT NOT NULL
        )`;
        return new Promise((resolve, error) => {
            database.run(CREATE_TABLE_QUERY, e => {
                if (e) {
                    error();
                } else {
                    resolve();
                }
            });
        });
    }

    store(network: string, transactionLocation: TransactionLocation): Promise<void> {
        this.checkClosed();

        return new Promise((resolve, reject) => {
            this._database.run(
                "INSERT OR REPLACE INTO monitor_states(network, block_hash, tx_id) VALUES (?, ?, ?)",
                [network, transactionLocation.blockHash, transactionLocation.txId],
                error => {
                    if (error !== null) {
                        reject(error);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    load(network: string): Promise<TransactionLocation | null> {
        this.checkClosed();

        return new Promise((resolve, reject) => {
            this._database.get("SELECT block_hash, tx_id FROM monitor_states WHERE network = ?", [network], (error, row) => {
                if (error !== null) {
                    reject(error);
                } else {
                    if (row === undefined) {
                        resolve(null);
                    } else {
                        resolve({ blockHash: row.block_hash, txId: row.tx_id });
                    }
                }
            })
        });
    }

    close(): void {
        this.checkClosed();

        this._database.close();
        this.closed = true;
    }

    private checkClosed(): void {
        if (this.closed) {
            throw new Error("This internal SQLite3 database is already closed.");
        }
    }
}
