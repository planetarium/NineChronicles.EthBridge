import { TriggerableMonitor } from "../../src/monitors/triggerable-monitor";
import { TransactionLocation } from "../../src/types/transaction-location";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
class LifecycleMonitor extends TriggerableMonitor<{ id: string }> {
    releases = jest.fn();
    acquire = jest.fn(async (): Promise<() => void> => this.releases);
    tips = jest.fn().mockResolvedValueOnce(0).mockResolvedValue(1);
    recovery = jest.fn(async () => ({
        nextBlockIndex: 0,
        remainedEvents: [{ blockHash: "saved", events: [] }],
    }));
    logs = jest.fn(async () => [{ id: "event", txId: "tx", blockHash: "1" }]);
    batch = false;
    waits = 0;
    constructor(checkpoint: TransactionLocation | null = null) {
        super(checkpoint, 1);
    }
    protected beginReadSession() {
        return this.acquire();
    }
    protected processRemains() {
        return this.recovery();
    }
    protected triggerredBlocks(n: number) {
        return [n];
    }
    protected async getBlockIndex(h: string) {
        return Number(h);
    }
    protected async getBlockHash(n: number) {
        return String(n);
    }
    protected getTipIndex() {
        return this.tips();
    }
    protected getEvents() {
        return this.logs();
    }
    protected shouldCatchUp() {
        return this.batch;
    }
    protected async wait() {
        if (++this.waits > 2) throw new Error("test retry budget exceeded");
    }
    unsupportedRange() {
        return super.catchUp(1, 2);
    }
}

describe("shared scheduler lifecycle and startup failures", () => {
    beforeEach(() => {
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());
    it("does not acquire a session if stopped before iteration", async () => {
        const monitor = new LifecycleMonitor();
        monitor.stop();
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.acquire).not.toHaveBeenCalled();
    });
    it("releases a lease acquired after stop without starting any reads", async () => {
        const monitor = new LifecycleMonitor();
        const gate = deferred<() => void>();
        monitor.acquire.mockReturnValueOnce(gate.promise);
        const pending = monitor.loop().next();
        monitor.stop();
        gate.resolve(monitor.releases);
        expect((await pending).done).toBe(true);
        expect(monitor.tips).not.toHaveBeenCalled();
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it("suppresses checkpoint recovery results returned after stop", async () => {
        const monitor = new LifecycleMonitor({
            blockHash: "saved",
            txId: null,
        });
        monitor.recovery.mockImplementationOnce(async () => {
            monitor.stop();
            return {
                nextBlockIndex: 0,
                remainedEvents: [{ blockHash: "saved", events: [] }],
            };
        });
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it("does not trigger a block when stopped during the tip read", async () => {
        const monitor = new LifecycleMonitor();
        monitor.tips.mockReset().mockImplementation(async () => {
            monitor.stop();
            return 1;
        });
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.logs).not.toHaveBeenCalled();
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it("does not deliver single-block logs after stop during RPC", async () => {
        const monitor = new LifecycleMonitor();
        monitor.logs.mockImplementationOnce(async () => {
            monitor.stop();
            return [];
        });
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it("releases the session and returns on an RPC rejection after stop", async () => {
        const monitor = new LifecycleMonitor();
        monitor.logs.mockImplementationOnce(async () => {
            monitor.stop();
            throw new Error("late failure");
        });
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.waits).toBe(0);
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it("rejects accidental batch opt-in without a range implementation", async () => {
        const monitor = new LifecycleMonitor();
        await expect(monitor.unsupportedRange().next()).rejects.toThrow(
            "Range scanning is not supported"
        );
    });
    it("does not forward a batch result after stop and closes its child generator", async () => {
        class BatchMonitor extends LifecycleMonitor {
            childClosed = jest.fn();
            protected async *catchUp() {
                try {
                    this.stop();
                    yield { scanIndex: 1, blockHash: "1", events: [] };
                } finally {
                    this.childClosed();
                }
            }
        }
        const monitor = new BatchMonitor();
        monitor.batch = true;
        expect((await monitor.loop().next()).done).toBe(true);
        expect(monitor.childClosed).toHaveBeenCalledTimes(1);
        expect(monitor.releases).toHaveBeenCalledTimes(1);
    });
    it.each(["lease", "initial-tip", "checkpoint"])(
        "retries startup %s failure with a fresh session",
        async (failure) => {
            const monitor = new LifecycleMonitor(
                failure === "checkpoint"
                    ? { blockHash: "saved", txId: null }
                    : null
            );
            if (failure === "lease")
                monitor.acquire.mockRejectedValueOnce(new Error("offline"));
            else if (failure === "initial-tip")
                monitor.tips
                    .mockReset()
                    .mockRejectedValueOnce(new Error("offline"))
                    .mockResolvedValueOnce(0)
                    .mockResolvedValue(1);
            else monitor.recovery.mockRejectedValueOnce(new Error("offline"));
            const loop = monitor.loop();
            try {
                expect((await loop.next()).value.blockHash).toBe(
                    failure === "checkpoint" ? "saved" : "1"
                );
                expect(monitor.waits).toBe(1);
                expect(monitor.acquire).toHaveBeenCalledTimes(2);
            } finally {
                await loop.return?.(undefined as never);
            }
            expect(monitor.releases).toHaveBeenCalledTimes(
                failure === "lease" ? 1 : 2
            );
        }
    );
});
