import { Sqlite3ExchangeHistoryStore } from "../src/sqlite3-exchange-history-store";
import { tmpdir } from "os";
import { join } from "path";
import { promises } from "fs";
import { ExchangeHistory } from "../src/interfaces/exchange-history-store";
import { TransactionStatus } from "../src/types/transaction-status";
import { Database } from "sqlite3";

describe("Sqlite3ExchangeHistoryStore", () => {
    let store: Sqlite3ExchangeHistoryStore;
    beforeEach(async () => {
        const path = await promises.mkdtemp(join(tmpdir(), "sqlite3-"));
        console.log(path);
        store = await Sqlite3ExchangeHistoryStore.open(join(path, "db"));
    });

    afterEach(() => {
        try {
            store.close();
        } catch (_) {
            // Ignore exception to avoid already closed.
        }
    });

    describe("exist", () => {
        it("should return false if it doesn't exist.", async () => {
            expect(await store.exist("TX-ID")).toBeFalsy();
        });

        it("should return true if it exist.", async () => {
            await store.put({
                amount: 0,
                network: "9c-main",
                recipient: "ADDRESS",
                sender: "ADDRESS",
                timestamp: "timestamp",
                tx_id: "TX-ID",
                status: TransactionStatus.PENDING,
            });

            expect(await store.exist("TX-ID")).toBeTruthy();
        });
    });

    describe("transferredAmountInLast24Hours", () => {
        it("should return 0 if there is no record.", async () => {
            const network = "9c-main",
                sender = "0x2734048eC2892d111b4fbAB224400847544FC872";

            expect(
                await store.transferredAmountInLast24Hours(network, sender)
            ).toEqual(0);
        });

        it("should return sum of the transactions.", async () => {
            const network = "9c-main",
                sender = "0x2734048eC2892d111b4fbAB224400847544FC872";

            const amounts: number[] = [100, 600, 900, 10000];
            const histories: ExchangeHistory[] = amounts.map(
                (amount, index) => {
                    return {
                        network,
                        tx_id: `TX-${index}`,
                        sender,
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        timestamp: new Date().toISOString(),
                        amount,
                        status: TransactionStatus.PENDING,
                    };
                }
            );

            for (const history of histories) {
                await store.put(history);
            }

            const totalAmount = amounts.reduce((x, y) => x + y);

            expect(
                await store.transferredAmountInLast24Hours(network, sender)
            ).toEqual(totalAmount);
        });

        it("should except later than last 24 hours", async () => {
            const network = "9c-main",
                sender = "0x2734048eC2892d111b4fbAB224400847544FC872",
                recipient = "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e";

            const amounts: number[] = [100, 600, 900, 10000];

            const histories: ExchangeHistory[] = amounts.map(
                (amount, index) => {
                    return {
                        network,
                        tx_id: `TX-${index}`,
                        sender,
                        recipient,
                        timestamp: new Date().toISOString(),
                        amount,
                        status: TransactionStatus.PENDING,
                    };
                }
            );

            histories.push({
                network,
                tx_id: "TX-STALED",
                sender,
                recipient,
                timestamp: new Date(
                    new Date().getTime() - 24 * 60 * 60 * 1000
                ).toISOString(),
                amount: 1000,
                status: TransactionStatus.PENDING,
            });

            for (const history of histories) {
                await store.put(history);
            }

            const totalAmount = amounts.reduce((x, y) => x + y);

            expect(
                await store.transferredAmountInLast24Hours(network, sender)
            ).toEqual(totalAmount);
        });
    });

    describe("transaction status management", () => {
        it("should manage transaction status correctly", async () => {
            const tx: ExchangeHistory = {
                network: "ethereum",
                tx_id: "TX-STATUS-TEST",
                sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                timestamp: new Date().toISOString(),
                amount: 1.0,
                status: TransactionStatus.PENDING,
            };
            await store.put(tx);

            let checkAfterPut = await (store as any)._database.all(
                "SELECT * FROM exchange_histories WHERE tx_id = ?",
                ["TX-STATUS-TEST"]
            );
            console.log("After PUT:", checkAfterPut);

            await store.updateStatus(
                "TX-STATUS-TEST",
                TransactionStatus.FAILED
            );
            let checkAfterUpdate = await (store as any)._database.all(
                "SELECT * FROM exchange_histories WHERE tx_id = ?",
                ["TX-STATUS-TEST"]
            );
            console.log("After UPDATE:", checkAfterUpdate);
        });

        it("should handle non-existent transaction", async () => {
            await store.updateStatus(
                "NON-EXISTENT-TX",
                TransactionStatus.COMPLETED
            );

            const pendingTxs = await store.getPendingTransactions();
            expect(pendingTxs).toHaveLength(0);
        });
    });

    it("should throw error.", () => {
        expect(() => store.close()).not.toThrowError();
        expect(() => store.close()).toThrowError();
    });

    it("should reject when database.run fails", async () => {
        // Mock Database class
        const mockDatabase = {
            run: jest.fn().mockImplementation((query, callback) => {
                const error = new Error("SQLITE_ERROR: syntax error");
                callback(error);
            }),
        } as unknown as Database;

        await expect(
            Sqlite3ExchangeHistoryStore["initialize"](mockDatabase)
        ).rejects.toThrow("SQLITE_ERROR: syntax error");

        expect(mockDatabase.run).toHaveBeenCalled();
    });
});
