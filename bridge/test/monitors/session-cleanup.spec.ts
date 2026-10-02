import { Monitor } from "../../src/monitors";

class SessionMonitor extends Monitor<never> {
    release = jest.fn();
    constructor() {
        super();
    }
    async *loop() {
        try {
            yield { blockHash: "checkpoint", events: [] };
        } finally {
            this.release();
        }
    }
    async consume() {
        // Exercise the actual consumer loop and await its result without starting
        // an unobserved promise via run().
        (this as any).running = true;
        await (this as any).startMonitoring();
    }
}

describe("monitor RPC session cleanup", () => {
    it("closes the suspended generator after stop", async () => {
        const monitor = new SessionMonitor();
        monitor.attach({ notify: async () => monitor.stop() });
        await monitor.consume();
        expect(monitor.release).toHaveBeenCalledTimes(1);
    });
    it("releases the session without repeating an observer after its failure", async () => {
        const monitor = new SessionMonitor();
        const notify = jest.fn(async () => {
            throw new Error("ambiguous payment response");
        });
        monitor.attach({ notify });
        await expect(monitor.consume()).rejects.toThrow(
            "ambiguous payment response"
        );
        expect(notify).toHaveBeenCalledTimes(1);
        expect(monitor.release).toHaveBeenCalledTimes(1);
    });
    it("closes cleanly when the generator ends", async () => {
        const monitor = new SessionMonitor();
        const notify = jest.fn(async () => undefined);
        monitor.attach({ notify });
        await monitor.consume();
        expect(notify).toHaveBeenCalledTimes(1);
        expect(monitor.release).toHaveBeenCalledTimes(1);
    });
});

class WaitingMonitor extends Monitor<never> {
    started = jest.fn();
    releases = jest.fn();
    constructor() {
        super();
    }
    pause(ms: number) {
        return this.wait(ms);
    }
    async *loop() {
        this.started();
        try {
            await this.wait(15000);
            yield { blockHash: "after-wait", events: [] };
        } finally {
            this.releases();
        }
    }
}
it("stop cancels idle timers, suppresses pending delivery and makes run idempotent", async () => {
    jest.useFakeTimers();
    try {
        const monitor = new WaitingMonitor();
        const notify = jest.fn();
        monitor.attach({ notify });
        monitor.run();
        monitor.run();
        expect(monitor.started).toHaveBeenCalledTimes(1);
        monitor.stop();
        monitor.run(); // pending stop must not start a second consumer
        expect(monitor.started).toHaveBeenCalledTimes(1);
        await monitor.pause(15000);
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(notify).not.toHaveBeenCalled();
        expect(monitor.releases).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
        monitor.run(); // allowed once cleanup has finished
        expect(monitor.started).toHaveBeenCalledTimes(2);
        monitor.stop();
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(monitor.releases).toHaveBeenCalledTimes(2);
    } finally {
        jest.useRealTimers();
    }
});
it("normal idle timeout removes its stop listener", async () => {
    jest.useFakeTimers();
    try {
        const monitor = new WaitingMonitor();
        const wait = monitor.pause(100);
        jest.advanceTimersByTime(100);
        await wait;
        monitor.stop();
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
    }
});
