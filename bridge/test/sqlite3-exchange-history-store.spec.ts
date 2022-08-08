import { Sqlite3ExchangeHistoryStore } from "../src/sqlite3-exchange-history-store";
import { tmpdir } from "os";
import { join } from "path";
import { promises } from "fs";
import { ExchangeHistory } from "../src/interfaces/exchange-history-store";

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
            store.put({
                amount: 0,
                network: "9c-main",
                recipient: "ADDRESS",
                sender: "ADDRESS",
                timestamp: "timestamp",
                tx_id: "TX-ID",
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

    it("should throw error.", () => {
        expect(() => store.close()).not.toThrowError();
        expect(() => store.close()).toThrowError();
    });
});
