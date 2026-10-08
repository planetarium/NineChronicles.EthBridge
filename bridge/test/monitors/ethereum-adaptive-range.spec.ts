import { ethers } from "ethers";
import { EthereumBurnEventMonitor } from "../../src/monitors/ethereum-burn-event-monitor";
import { wNCGTokenAbi } from "../../src/wrapped-ncg-token";

const contract = {
    address: "0x1111111111111111111111111111111111111111",
    abi: wNCGTokenAbi,
};
const hash = (n: number, branch = "a") => `${branch}-${n}`;
function burn(n: number, position = 0): ethers.providers.Log {
    return {
        blockNumber: n,
        blockHash: hash(n),
        transactionIndex: position,
        logIndex: position,
        transactionHash: `tx-${n}-${position}`,
        removed: false,
        address: contract.address,
        ...new ethers.Contract(
            contract.address,
            contract.abi
        ).interface.encodeEventLog("Burn", [
            contract.address,
            ethers.constants.HashZero,
            n + 1,
        ]),
    };
}
class TestMonitor extends EthereumBurnEventMonitor {
    epoch = 0;
    protected getReadEpoch() {
        return this.epoch;
    }
    range(from: number, tip: number) {
        return this.catchUp(from, tip);
    }
    one(n: number) {
        return this.getEvents(n);
    }
    header(n: number) {
        return this.getBlockHash(n);
    }
    height(h: string) {
        return this.getBlockIndex(h);
    }
    tip() {
        return this.getTipIndex();
    }
    waits = 0;
    protected async wait() {
        if (++this.waits > 5) throw new Error("test retry budget exceeded");
    }
}
function fixture(
    logs: ethers.providers.Log[] = [],
    tip = 10010,
    size?: number
) {
    const provider = {
        _isProvider: true,
        getBlockNumber: jest
            .fn()
            .mockResolvedValueOnce(10)
            .mockResolvedValue(tip),
        getBlock: jest.fn(async (id: number | string) => {
            const n = typeof id === "number" ? id : Number(id.split("-")[1]);
            return { number: n, hash: hash(n) };
        }),
        getLogs: jest.fn(
            async ({
                fromBlock,
                toBlock,
            }: {
                fromBlock: number;
                toBlock: number;
            }) =>
                logs.filter(
                    (log) =>
                        log.blockNumber >= fromBlock &&
                        log.blockNumber <= toBlock
                )
        ),
    };
    const monitor = new TestMonitor(
        provider as unknown as ethers.providers.BaseProvider,
        contract,
        null,
        10,
        size
    );
    return { provider, monitor };
}
async function collect<T>(loop: AsyncIterable<T>) {
    const result: T[] = [];
    for await (const item of loop) result.push(item);
    return result;
}

describe("Ethereum adaptive scan safety and RPC budgets", () => {
    beforeEach(() => {
        jest.spyOn(console, "debug").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it("scans 10,000 empty confirmed blocks with 15 headers, 5 logs and 5 scan-tip reads", async () => {
        const { provider, monitor } = fixture();
        const loop = monitor.loop();
        try {
            for (let end = 2000; end <= 10000; end += 2000)
                expect((await loop.next()).value).toEqual({
                    blockHash: hash(end),
                    events: [],
                });
            expect(provider.getBlock).toHaveBeenCalledTimes(15);
            expect(provider.getLogs).toHaveBeenCalledTimes(5);
            expect(provider.getBlockNumber).toHaveBeenCalledTimes(6); // includes initialization
            expect(
                provider.getLogs.mock.calls.map(([f]) => [
                    f.fromBlock,
                    f.toBlock,
                ])
            ).toEqual([
                [1, 2000],
                [2001, 4000],
                [4001, 6000],
                [6001, 8000],
                [8001, 10000],
            ]);
            expect(monitor.waits).toBe(0); // no delay while backlog remains
        } finally {
            await loop.return?.(undefined as never);
        }
    });
    it.each([1])(
        "keeps a %s-block gap on the single-block path without extra headers or batching delay",
        async (gap) => {
            const { provider, monitor } = fixture([], 10 + gap);
            const loop = monitor.loop();
            try {
                for (let n = 1; n <= gap; n++)
                    expect((await loop.next()).value.blockHash).toBe(hash(n));
                expect(provider.getBlock).toHaveBeenCalledTimes(gap * 2);
                expect(
                    provider.getLogs.mock.calls.map(([f]) => [
                        f.fromBlock,
                        f.toBlock,
                    ])
                ).toEqual(
                    Array.from({ length: gap }, (_, i) => [i + 1, i + 1])
                );
                expect(monitor.waits).toBe(0);
            } finally {
                await loop.return?.(undefined as never);
            }
        }
    );
    it.each([2, 10])(
        "batches a small %s-block empty gap immediately with three headers and one log query",
        async (gap) => {
            const { provider, monitor } = fixture([], 10 + gap);
            const loop = monitor.loop();
            try {
                expect((await loop.next()).value).toEqual({
                    blockHash: hash(gap),
                    events: [],
                });
                expect(provider.getBlock).toHaveBeenCalledTimes(3);
                expect(provider.getLogs).toHaveBeenCalledTimes(1);
                expect(monitor.waits).toBe(0);
            } finally {
                await loop.return?.(undefined as never);
            }
        }
    );
    it.each([2, 10])(
        "does not increase headers for a dense %s-block gap",
        async (gap) => {
            const { provider, monitor } = fixture(
                Array.from({ length: gap }, (_, i) => burn(i + 1)),
                10 + gap
            );
            const loop = monitor.loop();
            try {
                for (let n = 1; n <= gap; n++)
                    expect((await loop.next()).value.events[0].txId).toBe(
                        `tx-${n}-0`
                    );
                // The previous cache needed 2N+2 headers; batching keeps that ceiling
                // even when every block has a payout, while polling the tip only once.
                expect(provider.getBlock).toHaveBeenCalledTimes(2 * gap + 2);
                expect(provider.getLogs).toHaveBeenCalledTimes(1);
                expect(provider.getBlockNumber).toHaveBeenCalledTimes(2); // initialization + scan
            } finally {
                await loop.return?.(undefined as never);
            }
        }
    );
    it("orders event blocks and same-block transactions and never clears an occupied end cursor", async () => {
        const { monitor } = fixture([burn(20), burn(3, 1), burn(3, 0)]);
        const result = await collect(monitor.range(11, 30));
        expect(result.map((x) => x.scanIndex)).toEqual([13, 30]);
        expect(result.flatMap((x) => x.events.map((e) => e.txId))).toEqual([
            "tx-3-0",
            "tx-3-1",
            "tx-20-0",
        ]);
    });
    it("orders multiple burn logs from one transaction by log index", async () => {
        const first = burn(3, 0);
        const second = {
            ...burn(3, 1),
            transactionHash: first.transactionHash,
            transactionIndex: 0,
        };
        const { monitor } = fixture([second, first]);
        const [block] = await collect(monitor.range(11, 30));
        expect(block.events.map((e) => e.logIndex)).toEqual([0, 1]);
    });
    it("yields a single verified empty suffix after event blocks", async () => {
        const { monitor } = fixture([burn(3)]);
        const result = await collect(monitor.range(11, 30));
        expect(result.map((x) => [x.scanIndex, x.events.length])).toEqual([
            [13, 1],
            [30, 0],
        ]);
    });
    it.each([false, true])(
        "discards a changed batch before any delivery (empty: %s)",
        async (empty) => {
            const { provider, monitor } = fixture(empty ? [] : [burn(3)]);
            const read = provider.getLogs.getMockImplementation()!;
            provider.getLogs.mockImplementation(async (f) => {
                provider.getBlock.mockImplementation(async (id) => ({
                    number: Number(id),
                    hash: hash(Number(id), "b"),
                }));
                return read(f);
            });
            await expect(monitor.range(11, 30).next()).rejects.toThrow(
                "Chain or RPC endpoint changed"
            );
        }
    );
    it("detects A-B-A endpoint changes despite identical headers", async () => {
        const { provider, monitor } = fixture();
        provider.getLogs.mockImplementation(async () => {
            monitor.epoch += 2;
            return [];
        });
        await expect(monitor.range(11, 30).next()).rejects.toThrow(
            "RPC endpoint changed"
        );
    });
    it("re-queries uncommitted empty gaps after a mid-batch failure without replaying its paid prefix", async () => {
        const logs = [burn(2), burn(37), burn(50)];
        const { provider, monitor } = fixture(logs, 60);
        const loop = monitor.loop();
        try {
            expect((await loop.next()).value.events[0].txId).toBe("tx-2-0");
            const original = provider.getBlock.getMockImplementation()!;
            let failed = false;
            provider.getBlock.mockImplementation(async (id) => {
                if (id === 37 && !failed) {
                    failed = true;
                    logs.push(burn(5));
                    throw new Error("timeout");
                }
                return original(id);
            });
            const delivered = [];
            for (let i = 0; i < 3; i++)
                delivered.push((await loop.next()).value.events[0].txId);
            expect(delivered).toEqual(["tx-5-0", "tx-37-0", "tx-50-0"]);
            expect(
                provider.getLogs.mock.calls.map(([f]) => [
                    f.fromBlock,
                    f.toBlock,
                ])
            ).toEqual([
                [1, 50],
                [3, 50],
            ]);
            expect(monitor.waits).toBe(1);
        } finally {
            await loop.return?.(undefined as never);
        }
    });
    it("re-reads an empty suffix if the anchor changes while the observer processes an event", async () => {
        const logs = [burn(2)];
        const { provider, monitor } = fixture(logs, 60);
        const loop = monitor.loop();
        try {
            expect((await loop.next()).value.blockHash).toBe(hash(2));
            logs.push(burn(4));
            provider.getBlock.mockRejectedValueOnce(
                new Error("anchor unavailable")
            );
            expect((await loop.next()).value.events[0].txId).toBe("tx-4-0");
            expect((await loop.next()).value).toEqual({
                blockHash: hash(50),
                events: [],
            });
        } finally {
            await loop.return?.(undefined as never);
        }
    });
    it("rejects a block's logs even if the range anchor is stable", async () => {
        const { monitor } = fixture([{ ...burn(3), blockHash: "other" }]);
        await expect(monitor.range(11, 30).next()).rejects.toThrow(
            "Burn logs disagree"
        );
        await expect(monitor.one(3)).rejects.toThrow("Burn logs disagree");
    });
    it("single-block reads use two headers and recheck after logs", async () => {
        const { provider, monitor } = fixture([burn(3)]);
        await monitor.header(3);
        expect((await monitor.one(3))[0].txId).toBe("tx-3-0");
        expect(provider.getBlock).toHaveBeenCalledTimes(2);
        provider.getBlock.mockClear();
        await monitor.one(3); // cannot reuse an earlier consumed header
        expect(provider.getBlock).toHaveBeenCalledTimes(2);
        expect(await monitor.height(hash(3))).toBe(3);
    });
    it("rejects a single-block reorg during logs before delivering its events", async () => {
        const { provider, monitor } = fixture();
        provider.getLogs.mockImplementation(async () => {
            provider.getBlock.mockResolvedValue({ number: 3, hash: "changed" });
            return [];
        });
        await expect(monitor.one(3)).rejects.toThrow(
            "Chain or RPC endpoint changed"
        );
    });
    it("shrinks explicit range limits, then probes a doubled size after each success", async () => {
        const { provider, monitor } = fixture([], 110, 64);
        provider.getLogs.mockImplementation(async (f) => {
            if (f.toBlock - f.fromBlock + 1 > 16)
                throw { code: -32005, message: "block range too wide" };
            return [];
        });
        expect((await collect(monitor.range(11, 110)))[0].scanIndex).toBe(26);
        expect((await collect(monitor.range(27, 110)))[0].scanIndex).toBe(42);
        expect(
            provider.getLogs.mock.calls.map(([f]) => [f.fromBlock, f.toBlock])
        ).toEqual([
            [1, 64],
            [1, 32],
            [1, 16],
            // A success probes double the working size, capped at the start.
            [17, 48],
            [17, 32],
        ]);
    });
    it.each([
        new Error("timeout"),
        { code: -32005, message: "limit exceeded" },
    ])("does not split a transport/quota failure: %j", async (error) => {
        const { provider, monitor } = fixture();
        provider.getLogs.mockRejectedValue(error);
        await expect(monitor.range(11, 30).next()).rejects.toBe(error);
        expect(provider.getLogs).toHaveBeenCalledTimes(1);
    });
    it("propagates range errors at the minimum size", async () => {
        const { provider, monitor } = fixture([], 30, 1);
        provider.getLogs.mockRejectedValue(new Error("block range too wide"));
        await expect(monitor.range(11, 30).next()).rejects.toThrow(
            "block range too wide"
        );
        expect(provider.getLogs).toHaveBeenCalledTimes(1);
    });
    it.each([
        { blockNumber: 0 },
        { blockNumber: 21 },
        { blockNumber: NaN },
        { logIndex: -1 },
        { logIndex: 0.5 },
        { transactionIndex: -1 },
        { transactionIndex: NaN },
        { removed: true },
        { address: ethers.constants.AddressZero },
        { topics: [] },
    ])("fails closed on invalid RPC logs: %j", async (patch) => {
        const { provider, monitor } = fixture();
        provider.getLogs.mockResolvedValue([{ ...burn(3), ...patch }]);
        await expect(monitor.range(11, 30).next()).rejects.toThrow(
            "invalid or duplicate"
        );
    });
    it("rejects repeated log identities", async () => {
        const { monitor } = fixture([burn(3), burn(3)]);
        await expect(monitor.range(11, 30).next()).rejects.toThrow(
            "invalid or duplicate"
        );
    });
    it.each([-1, NaN, 1.2])("rejects invalid tip %s", async (tip) => {
        const { provider, monitor } = fixture();
        provider.getBlockNumber.mockReset().mockResolvedValue(tip);
        await expect(monitor.tip()).rejects.toThrow("invalid tip");
    });
    it.each([0, -1, NaN, 1.5])("rejects invalid chunk size %s", (size) =>
        expect(() => fixture([], 30, size)).toThrow("catchUpChunkSize")
    );
    it("rejects invalid confirmation depth", () => {
        const { provider } = fixture();
        expect(
            () =>
                new EthereumBurnEventMonitor(
                    provider as unknown as ethers.providers.BaseProvider,
                    contract,
                    null,
                    -1
                )
        ).toThrow("confirmations");
    });
    it.each([false, true])(
        "stops during pending batch I/O without yielding (events: %s)",
        async (occupied) => {
            const { provider, monitor } = fixture(occupied ? [burn(3)] : []);
            const original = provider.getBlock.getMockImplementation()!;
            let reads = 0;
            provider.getBlock.mockImplementation(async (id) => {
                if (++reads === (occupied ? 4 : 3)) monitor.stop();
                return original(id);
            });
            expect((await monitor.range(11, 30).next()).done).toBe(true);
        }
    );
});
