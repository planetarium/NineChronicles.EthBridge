import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Database } from "sqlite3";

export class Sqlite3MonitorStateStore implements IMonitorStateStore {
    private readonly _database: Database;
    private closed: boolean;

    constructor(path: string) {
        this._database = new Database(path);
        Sqlite3MonitorStateStore.initialize(this._database);
        this.closed = false;
    }

    private static initialize(database: Database) {
        const CREATE_TABLE_QUERY = `CREATE TABLE IF NOT EXISTS monitor_states (
            network TEXT PRIMARY KEY,
            block_hash TEXT NOT NULL,
            tx_id TEXT NOT NULL,
        )`;
        database.run(CREATE_TABLE_QUERY);
    }

    store(network: string, blockHash: string, txId: string): Promise<void> {
        this.checkClosed();

        return new Promise((resolve, reject) => {
            this._database.run(
                "INSERT OR REPLACE INTO monitor_states(network, block_hash, tx_id) VALUES (?, ?, ?)",
                [network, blockHash, txId],
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

    load(network: string): Promise<{ blockHash: string, txId: string }> {
        this.checkClosed();

        return new Promise((resolve, reject) => {
            this._database.get("SELECT block_hash, tx_id FROM monitor_states WHERE network = ?", [network], (error, row) => {
                if (error !== null) {
                    reject(error);
                } else {
                    resolve({ blockHash: row.block_hash, txId: row.tx_id });
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
