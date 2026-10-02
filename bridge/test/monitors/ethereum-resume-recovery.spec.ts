import { ethers } from "ethers";
import { EthereumBurnEventMonitor } from "../../src/monitors/ethereum-burn-event-monitor";
import { wNCGTokenAbi } from "../../src/wrapped-ncg-token";
import { TransactionLocation } from "../../src/types/transaction-location";

const contract = {
    address: "0x1111111111111111111111111111111111111111",
    abi: wNCGTokenAbi,
};
const hash = (height: number, branch = "a") => `block-${branch}-${height}`;
const header = (height: number, branch = "a", parentBranch = branch) => ({
    number: height,
    hash: hash(height, branch),
    parentHash: hash(height - 1, parentBranch),
});
function burn(height: number, position = 0): ethers.providers.Log {
    return {
        blockNumber: height,
        blockHash: hash(height),
        transactionHash: `tx-${height}-${position}`,
        transactionIndex: position,
        logIndex: position,
        removed: false,
        address: contract.address,
        topics: [
            ethers.utils.id("Burn(address,bytes32,uint256)"),
            ethers.utils.hexZeroPad(contract.address, 32),
            ethers.constants.HashZero,
        ],
        data: ethers.utils.defaultAbiCoder.encode(["uint256"], [height + 1]),
    };
}
class ResumeMonitor extends EthereumBurnEventMonitor {
    epoch = 0;
    protected getReadEpoch() {
        return this.epoch;
    }
    resume(checkpoint: TransactionLocation) {
        return this.processRemains(checkpoint);
    }
}
function fixture(logs: ethers.providers.Log[] = [], confirmations = 10) {
    const archive = new Map<string, ReturnType<typeof header>>();
    const provider = {
        _isProvider: true,
        getBlock: jest.fn(async (indexOrHash: number | string) =>
            typeof indexOrHash === "number"
                ? header(indexOrHash)
                : archive.get(indexOrHash) ??
                  header(Number(indexOrHash.split("-").pop()))
        ),
        getBlockNumber: jest.fn(async () => 15 + confirmations),
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
    const create = (checkpoint: TransactionLocation | null = null) =>
        new ResumeMonitor(
            provider as unknown as ethers.providers.BaseProvider,
            contract,
            checkpoint,
            confirmations
        );
    return { provider, archive, create, monitor: create() };
}
const checkpoint = (
    txId: string | null = null,
    branch = "a"
): TransactionLocation => ({
    blockHash: hash(10, branch),
    txId,
});

describe("Ethereum checkpoint recovery", () => {
    afterEach(() => jest.restoreAllMocks());

    it("replays all ordered logs at a canonical null cursor, even without a parent header", async () => {
        const { provider, monitor } = fixture([burn(10, 1), burn(10)]);
        provider.getBlock.mockImplementation(
            async () =>
                ({ number: 10, hash: hash(10) } as ReturnType<typeof header>)
        );
        const result = await monitor.resume(checkpoint());
        expect(result.nextBlockIndex).toBe(20);
        expect(
            result.remainedEvents[0].events.map((event) => event.txId)
        ).toEqual(["tx-10-0", "tx-10-1"]);
        expect(provider.getBlock).toHaveBeenCalledTimes(3);
    });

    it.each([0, 1])(
        "resumes strictly after existing transaction position %s",
        async (position) => {
            const { monitor } = fixture([burn(10), burn(10, 1)]);
            const result = await monitor.resume(
                checkpoint(`tx-10-${position}`)
            );
            expect(
                result.remainedEvents[0].events.map((event) => event.txId)
            ).toEqual(position === 0 ? ["tx-10-1"] : []);
        }
    );

    it.each([{ logs: [] }, { logs: [burn(10)] }])(
        "fails closed when a canonical transaction cursor is absent from logs %j",
        async ({ logs }) => {
            const { monitor } = fixture(logs);
            await expect(
                monitor.resume(checkpoint("missing-tx"))
            ).rejects.toThrow("Checkpoint transaction missing-tx is missing");
        }
    );

    it.each([
        { ...burn(10), blockHash: hash(10, "b") },
        { ...burn(10), blockNumber: 9 },
    ])("rejects logs inconsistent with the checkpoint header", async (log) => {
        const { monitor, provider } = fixture();
        provider.getLogs.mockResolvedValue([log]);
        await expect(monitor.resume(checkpoint())).rejects.toThrow(
            /burn logs/i
        );
    });

    it("rejects canonical anchor changes during log retrieval", async () => {
        const { monitor, provider } = fixture([burn(10)]);
        provider.getLogs.mockImplementation(async () => {
            provider.getBlock.mockResolvedValue(header(10, "b"));
            return [burn(10)];
        });
        await expect(monitor.resume(checkpoint())).rejects.toThrow(
            "Chain or RPC endpoint changed"
        );
    });

    it("rejects endpoint A-B-A transitions even when both anchors and logs match", async () => {
        const { monitor, provider } = fixture();
        provider.getLogs.mockImplementation(async () => {
            monitor.epoch += 2;
            return [];
        });
        await expect(monitor.resume(checkpoint())).rejects.toThrow(
            "Chain or RPC endpoint changed"
        );
    });

    it("accepts a stable fallback selected by the first checkpoint read", async () => {
        const { monitor, provider } = fixture([burn(10)]);
        const original = provider.getBlock.getMockImplementation()!;
        provider.getBlock.mockImplementation(async (ref) => {
            if (ref === hash(10)) monitor.epoch += 1;
            return original(ref);
        });
        const result = await monitor.resume(checkpoint());
        expect(
            result.remainedEvents[0].events.map((event) => event.txId)
        ).toEqual(["tx-10-0"]);
        expect(monitor.epoch).toBe(1);
    });

    it("waits for the actual endpoint tip to confirm a saved block before replay", async () => {
        const { monitor, provider } = fixture([burn(999)]);
        const saved = { blockHash: hash(999), txId: null };
        provider.getBlockNumber
            .mockResolvedValueOnce(999)
            .mockResolvedValue(1009);
        await expect(monitor.resume(saved)).rejects.toThrow(
            "RPC tip 999 has fewer than 10 confirmations"
        );
        expect(provider.getLogs).not.toHaveBeenCalled();
        const result = await monitor.resume(saved);
        expect(result.nextBlockIndex).toBe(1009);
        expect(
            result.remainedEvents[0].events.map((event) => event.txId)
        ).toEqual(["tx-999-0"]);
    });

    it("retries a lagging startup tip without emitting an unconfirmed checkpoint", async () => {
        const { create, provider } = fixture([burn(999)]);
        provider.getBlockNumber
            .mockResolvedValueOnce(999)
            .mockResolvedValue(1009);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
        jest.spyOn(global, "setTimeout").mockImplementation(((
            fn: () => void
        ) => {
            fn();
            return 0;
        }) as unknown as typeof setTimeout);
        const loop = create({ blockHash: hash(999), txId: null }).loop();
        try {
            const first = (await loop.next()).value;
            expect(first.blockHash).toBe(hash(999));
            expect(
                first.events.map((event: TransactionLocation) => event.txId)
            ).toEqual(["tx-999-0"]);
            expect(provider.getBlockNumber).toHaveBeenCalledTimes(2);
            expect(provider.getLogs).toHaveBeenCalledTimes(1);
        } finally {
            await loop.return?.(undefined as never);
        }
    });

    it("waits for confirmations before committing an orphan rewind", async () => {
        const { monitor, provider, archive } = fixture();
        archive.set(hash(10, "b"), header(10, "b", "a"));
        provider.getBlockNumber.mockResolvedValueOnce(19).mockResolvedValue(20);
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "RPC tip 19 has fewer than 10 confirmations"
        );
        expect(provider.getBlock).toHaveBeenCalledTimes(1);
        expect(
            (await monitor.resume(checkpoint(null, "b"))).remainedEvents
        ).toEqual([{ blockHash: hash(9), events: [] }]);
    });

    it("rejects an endpoint change during the tip check after the first header", async () => {
        const { monitor, provider } = fixture();
        provider.getBlockNumber.mockImplementation(async () => {
            monitor.epoch += 1;
            return 25;
        });
        await expect(monitor.resume(checkpoint())).rejects.toThrow(
            "Chain or RPC endpoint changed"
        );
    });

    it.each([null, "old-tx"])(
        "rewinds an orphan %s cursor to its common ancestor and rescans all replaced blocks",
        async (txId) => {
            const { create, archive, provider } = fixture([
                burn(8),
                burn(10),
                burn(12),
            ]);
            provider.getBlockNumber.mockResolvedValue(35);
            archive.set(hash(10, "b"), header(10, "b"));
            archive.set(hash(9, "b"), header(9, "b"));
            archive.set(hash(8, "b"), header(8, "b", "a"));
            const loop = create(checkpoint(txId, "b")).loop();
            try {
                expect((await loop.next()).value).toEqual({
                    blockHash: hash(7),
                    events: [],
                });
                const first = (await loop.next()).value;
                expect(first.blockHash).toBe(hash(8));
                expect(
                    first.events.map((event: TransactionLocation) => event.txId)
                ).toEqual(["tx-8-0"]);
                expect((await loop.next()).value.blockHash).toBe(hash(10));
                expect((await loop.next()).value.blockHash).toBe(hash(12));
                expect(provider.getLogs).toHaveBeenCalledTimes(1);
                expect(provider.getLogs).toHaveBeenCalledWith(
                    expect.objectContaining({ fromBlock: 8, toBlock: 25 })
                );
            } finally {
                await loop.return?.(undefined as never);
            }
        }
    );

    it("requires archived headers instead of guessing the missing checkpoint height", async () => {
        const { monitor, provider } = fixture();
        provider.getBlock.mockResolvedValue(
            null as unknown as ReturnType<typeof header>
        );
        await expect(monitor.resume(checkpoint())).rejects.toThrow(
            "block header unavailable or invalid"
        );
        expect(provider.getLogs).not.toHaveBeenCalled();
    });

    it("rejects a response whose hash differs from the requested archived header", async () => {
        const { monitor } = fixture();
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "block header disagrees"
        );
    });

    it.each([undefined, -1, NaN])(
        "rejects unknown or invalid checkpoint height %s",
        async (number) => {
            const { monitor, provider } = fixture();
            provider.getBlock.mockResolvedValue({
                ...header(10),
                number,
            } as ReturnType<typeof header>);
            await expect(monitor.resume(checkpoint())).rejects.toThrow(
                "block header unavailable or invalid"
            );
        }
    );

    it("fails closed if an orphan parent cannot be retrieved", async () => {
        const { monitor, provider, archive } = fixture();
        archive.set(hash(10, "b"), header(10, "b"));
        const original = provider.getBlock.getMockImplementation()!;
        provider.getBlock.mockImplementation(async (ref) =>
            ref === hash(9, "b")
                ? (null as unknown as ReturnType<typeof header>)
                : original(ref)
        );
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "block header unavailable or invalid"
        );
        expect(provider.getLogs).not.toHaveBeenCalled();
    });

    it("fails closed when an orphan header omits its parent hash", async () => {
        const { monitor, archive } = fixture();
        archive.set(hash(10, "b"), { ...header(10, "b"), parentHash: "" });
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "parent hash unavailable"
        );
    });

    it("rejects a parent header at an inconsistent height", async () => {
        const { monitor, archive } = fixture();
        archive.set(hash(10, "b"), header(10, "b"));
        archive.set(hash(9, "b"), { ...header(9, "b"), number: 8 });
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "invalid parent height"
        );
    });

    it("checks endpoint stability during common-ancestor recovery", async () => {
        const { monitor, archive, provider } = fixture();
        archive.set(hash(10, "b"), header(10, "b", "a"));
        const original = provider.getBlock.getMockImplementation()!;
        provider.getBlock.mockImplementation(async (ref) => {
            if (ref === hash(9)) monitor.epoch += 1;
            return original(ref);
        });
        await expect(monitor.resume(checkpoint(null, "b"))).rejects.toThrow(
            "Chain or RPC endpoint changed"
        );
    });

    it("bounds orphan recovery instead of scanning an unbounded alternate branch", async () => {
        const { monitor, archive, provider } = fixture();
        provider.getBlockNumber.mockResolvedValue(2011);
        for (let height = 1000; height <= 2001; height++)
            archive.set(hash(height, "b"), header(height, "b"));
        await expect(
            monitor.resume({ blockHash: hash(2001, "b"), txId: null })
        ).rejects.toThrow("no common ancestor within 1000 blocks");
        expect(provider.getBlock.mock.calls.length).toBeLessThanOrEqual(2003);
        expect(provider.getLogs).not.toHaveBeenCalled();
    });
});
