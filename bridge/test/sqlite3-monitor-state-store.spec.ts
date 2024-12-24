import { Sqlite3MonitorStateStore } from "../src/sqlite3-monitor-state-store";
import { tmpdir } from "os";
import { join } from "path";
import { promises } from "fs";
import { Database } from "sqlite3";

describe("Sqlite3MonitorStateStore", () => {
    let stateStore: Sqlite3MonitorStateStore;
    beforeEach(async () => {
        const path = await promises.mkdtemp(join(tmpdir(), "sqlite3-"));
        stateStore = await Sqlite3MonitorStateStore.open(join(path, "db"));
    });

    afterEach(() => {
        try {
            stateStore.close();
        } catch (_) {
            // Ignore exception to avoid already closed.
        }
    });

    it("should store correctly.", async () => {
        const blockHash =
                "46f1d8bbbafe28a5b7df63445b2eed41cc6620924b406a08487eeb356c7ebaad",
            txId =
                "cd72b717c746883390c330103d7c319294dfe6db9cbc85853dd8fdfc9355f281";
        await stateStore.store("9c-main", { blockHash, txId });
        expect(await stateStore.load("9c-main")).toEqual({ blockHash, txId });
    });

    it("should store null txid.", async () => {
        const blockHash =
                "46f1d8bbbafe28a5b7df63445b2eed41cc6620924b406a08487eeb356c7ebaad",
            txId = null;
        await stateStore.store("9c-main", { blockHash, txId });
        expect(await stateStore.load("9c-main")).toEqual({ blockHash, txId });
    });

    it("should overwrite if the network existed.", async () => {
        const blockHash =
                "46f1d8bbbafe28a5b7df63445b2eed41cc6620924b406a08487eeb356c7ebaad",
            txId =
                "cd72b717c746883390c330103d7c319294dfe6db9cbc85853dd8fdfc9355f281";
        await stateStore.store("9c-main", { blockHash, txId });
        const otherBlockHash =
                "6bb38316d91c3fa0188c11a2e123e66427d788f7e3dacfddaaa0ff9628593e21",
            otherTxId =
                "527011cad4f9173d46701044d42f8cc596e136301ae99e9ed954f66282d6ac98";
        await stateStore.store("9c-main", {
            blockHash: otherBlockHash,
            txId: otherTxId,
        });
        expect(await stateStore.load("9c-main")).toEqual({
            blockHash: otherBlockHash,
            txId: otherTxId,
        });
    });

    it("should return null if there is no transaction location.", async () => {
        expect(await stateStore.load("key")).toBeNull();
    });

    it("should throw error.", () => {
        expect(() => stateStore.close()).not.toThrowError();
        expect(() => stateStore.close()).toThrowError();
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
            Sqlite3MonitorStateStore["initialize"](mockDatabase)
        ).rejects.toThrow("SQLITE_ERROR: syntax error");

        expect(mockDatabase.run).toHaveBeenCalled();
    });
});
