import { Sqlite3MonitorStateStore } from "../src/sqlite3-monitor-state-store";
import { tmpdir } from "os";
import { join } from "path";
import { promises } from "fs";
import { assert } from "chai";

describe("Sqlite3MonitorStateStore", () => {
    let stateStore: Sqlite3MonitorStateStore;
    beforeEach(async () => {
        const path = await promises.mkdtemp(join(tmpdir(), "sqlite3-"));
        stateStore = new Sqlite3MonitorStateStore(join(path, "db"));
    });

    afterEach(() => {
        try {
            stateStore.close();
        } catch (_) {
            // Ignore exception to avoid already closed.
        }
    });

    it("should store correctly.", async () => {
        const blockHash = "46f1d8bbbafe28a5b7df63445b2eed41cc6620924b406a08487eeb356c7ebaad",
            txId = "cd72b717c746883390c330103d7c319294dfe6db9cbc85853dd8fdfc9355f281";
        await stateStore.store("9c-main", blockHash, txId);
        assert.equal(await stateStore.load("9c-main"), { blockHash, txId, });
    });

    it("should overwrite if the network existed.", async () => {
        const blockHash = "46f1d8bbbafe28a5b7df63445b2eed41cc6620924b406a08487eeb356c7ebaad",
            txId = "cd72b717c746883390c330103d7c319294dfe6db9cbc85853dd8fdfc9355f281";
        await stateStore.store("9c-main", blockHash, txId);
        const otherBlockHash = "6bb38316d91c3fa0188c11a2e123e66427d788f7e3dacfddaaa0ff9628593e21",
            otherTxId = "527011cad4f9173d46701044d42f8cc596e136301ae99e9ed954f66282d6ac98";
        await stateStore.store("9c-main", otherBlockHash, otherTxId);
        assert.equal(await stateStore.load("9c-main"), { blockHash: otherBlockHash, txId: otherTxId, });
    });

    it("should throw error.", () => {
        assert.doesNotThrow(() => stateStore.close());
        assert.throws(() => stateStore.close());
    });
});
