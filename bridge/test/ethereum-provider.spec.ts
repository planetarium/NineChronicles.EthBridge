import { ethers } from "ethers";
import {
    createEthereumFallbackProvider,
    ChainIdMismatchError,
    ResilientFallbackProvider,
} from "../src/ethereum-provider";

describe("Ethereum RPC failover", () => {
    type RpcState = {
        down: boolean;
        chainId: string;
        requests: string[];
        logError?: unknown;
        logs?: ethers.providers.Log[];
    };
    const endpoints = new Map<string, RpcState>();

    beforeEach(() => {
        endpoints.clear();
        // Replace only transport: real JsonRpcProvider network detection and
        // FallbackProvider request routing still run, without sockets or keys.
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider,
            method: string
        ) {
            const state = endpoints.get(this.connection.url)!;
            state.requests.push(method);
            if (state.down) throw { code: "SERVER_ERROR", status: 503 };
            if (method === "eth_getLogs") {
                if (state.logError) throw state.logError;
                return state.logs ?? [];
            }
            return method === "eth_chainId"
                ? state.chainId
                : method === "net_version"
                ? String(parseInt(state.chainId, 16))
                : method === "eth_blockNumber"
                ? "0x64"
                : "0x2a";
        });
    });
    afterEach(() => jest.restoreAllMocks());

    async function rpc() {
        const state: RpcState = { down: false, chainId: "0x1", requests: [] };
        const url = `http://rpc-${endpoints.size}.invalid`;
        endpoints.set(url, state);
        return { state, url };
    }

    it.each([0, 1])(
        "starts and reads when endpoint %s is already down",
        async (downIndex) => {
            const endpoints = await Promise.all([rpc(), rpc()]);
            endpoints[downIndex].state.down = true;
            const provider = await createEthereumFallbackProvider(
                endpoints[0].url,
                endpoints[1].url
            );
            expect(await provider.getNetwork()).toMatchObject({ chainId: 1 });
            expect((await provider.getGasPrice()).toNumber()).toBe(42);
        }
    );

    it.each([0, 1])(
        "survives endpoint %s failing after startup",
        async (downIndex) => {
            const endpoints = await Promise.all([rpc(), rpc()]);
            const provider = await createEthereumFallbackProvider(
                endpoints[0].url,
                endpoints[1].url
            );
            await provider.getGasPrice();
            endpoints[downIndex].state.down = true;
            expect((await provider.getGasPrice()).toNumber()).toBe(42);
        }
    );

    it("fails closed when both RPC endpoints are down", async () => {
        const main = await rpc();
        const sub = await rpc();
        main.state.down = sub.state.down = true;
        await expect(
            createEthereumFallbackProvider(main.url, sub.url)
        ).rejects.toBeDefined();
    });

    it("rejects mismatched chains", async () => {
        const main = await rpc();
        const sub = await rpc();
        sub.state.chainId = "0xaa36a7";
        await expect(
            createEthereumFallbackProvider(main.url, sub.url)
        ).rejects.toBeDefined();
    });

    it("fails closed if a previously healthy endpoint changes chain", async () => {
        const main = await rpc();
        const sub = await rpc();
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        await provider.getNetwork();
        sub.state.chainId = "0xaa36a7";
        // ethers deduplicates network probes within one event-loop tick.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(provider.getNetwork()).rejects.toBeDefined();
    });

    it("rejects a wrong-chain sub even when the main endpoint is unavailable at startup", async () => {
        const main = await rpc();
        const sub = await rpc();
        main.state.down = true;
        sub.state.chainId = "0x38";
        await expect(
            createEthereumFallbackProvider(main.url, sub.url)
        ).rejects.toBeDefined();
    });

    it("supports an explicitly configured testnet", async () => {
        const main = await rpc();
        const sub = await rpc();
        main.state.chainId = sub.state.chainId = "0xaa36a7";
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url,
            { expectedChainId: 11155111 }
        );
        expect((await provider.getNetwork()).chainId).toBe(11155111);
    });

    it("rejects a recovering endpoint on a different chain", async () => {
        const main = await rpc();
        const sub = await rpc();
        sub.state.down = true;
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        await provider.getGasPrice();
        sub.state.chainId = "0x2";
        sub.state.down = false;
        await expect(provider.getNetwork()).rejects.toBeDefined();
    });

    it("allows an unavailable endpoint to recover on the same chain", async () => {
        const main = await rpc();
        const sub = await rpc();
        sub.state.down = true;
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        sub.state.down = false;
        main.state.down = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect((await provider.getGasPrice()).toNumber()).toBe(42);
    });

    it.each([0, -1, 1.5])(
        "rejects a non-positive-integer expectedChainId (%p)",
        async (expectedChainId) => {
            const main = await rpc();
            const sub = await rpc();
            await expect(
                createEthereumFallbackProvider(main.url, sub.url, {
                    expectedChainId,
                })
            ).rejects.toThrow(
                "expectedChainId must be a positive safe integer"
            );
        }
    );
    const filter = { fromBlock: 1, toBlock: 2 };
    const burnLog: ethers.providers.Log = {
        blockNumber: 2,
        blockHash: "0x" + "ab".repeat(32),
        transactionHash: "0x" + "cd".repeat(32),
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
        address: "0x" + "11".repeat(20),
        data: "0x",
        topics: [],
    };

    it("fails over a log read even when both endpoints pass network discovery", async () => {
        const main = await rpc();
        const sub = await rpc();
        main.state.logError = { code: "TIMEOUT" };
        sub.state.logs = [burnLog];
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        await expect(provider.getLogs(filter)).resolves.toEqual([burnLog]);
        expect(main.state.requests).toContain("eth_getLogs");
        expect(sub.state.requests).toContain("eth_getLogs");
    });

    it("propagates failure when all log reads fail instead of returning an empty batch", async () => {
        const main = await rpc();
        const sub = await rpc();
        main.state.logError = sub.state.logError = { code: "TIMEOUT" };
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        await expect(provider.getLogs(filter)).rejects.toMatchObject({
            code: "SERVER_ERROR",
        });
        expect(main.state.requests).toContain("eth_getLogs");
        expect(sub.state.requests).toContain("eth_getLogs");
    });

    it("rejects a changed chain before querying burn logs", async () => {
        const main = await rpc();
        const sub = await rpc();
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        sub.state.chainId = "0x38";
        sub.state.logs = [burnLog];
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(provider.getLogs(filter)).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(main.state.requests).not.toContain("eth_getLogs");
        expect(sub.state.requests).not.toContain("eth_getLogs");
    });

    it("rejects a wrong-chain recovering peer when the previously healthy peer is now unavailable", async () => {
        const main = await rpc();
        const sub = await rpc();
        sub.state.down = true;
        const provider = await createEthereumFallbackProvider(
            main.url,
            sub.url
        );
        main.state.down = true;
        sub.state.down = false;
        sub.state.chainId = "0x38";
        sub.state.logs = [burnLog];
        await new Promise((resolve) => setTimeout(resolve, 0));
        await expect(provider.getLogs(filter)).rejects.toMatchObject({
            code: "NETWORK_ERROR",
            event: "changed",
        });
        expect(sub.state.requests).not.toContain("eth_getLogs");
    });

    it.each([0, -1, 1.5, Number.NaN])(
        "rejects invalid expected chain ID %s before contacting RPCs",
        async (expectedChainId) => {
            const main = await rpc();
            const sub = await rpc();
            await expect(
                createEthereumFallbackProvider(main.url, sub.url, {
                    expectedChainId,
                })
            ).rejects.toThrow("positive safe integer");
            expect(main.state.requests).toEqual([]);
            expect(sub.state.requests).toEqual([]);
        }
    );
});

// Unlike the rest of this file, these tests construct ResilientFallbackProvider
// directly with plain mock providers (no expectedChainId pinned on either
// one), so both providers' own getNetwork() calls resolve successfully with
// genuinely different networks - the only way to reach the cross-provider
// comparison in detectNetwork() itself, as opposed to a single JsonRpcProvider
// rejecting its *own* request because it disagrees with a chain ID that was
// statically pinned on it via createEthereumFallbackProvider.
describe(ResilientFallbackProvider.name, () => {
    function mockProvider(network: Partial<ethers.providers.Network>) {
        return {
            getNetwork: jest.fn().mockResolvedValue(network),
        } as unknown as ethers.providers.Provider;
    }

    it("throws ChainIdMismatchError when two healthy providers report different chain IDs", async () => {
        const provider = new ResilientFallbackProvider(
            [
                {
                    provider: mockProvider({
                        chainId: 1,
                        name: "homestead",
                    }),
                    priority: 1,
                    weight: 1,
                },
                {
                    provider: mockProvider({
                        chainId: 56,
                        name: "bnb",
                    }),
                    priority: 2,
                    weight: 1,
                },
            ],
            1
        );

        await expect(provider.detectNetwork()).rejects.toThrow(
            ChainIdMismatchError
        );
    });

    it("ChainIdMismatchError's message names both disagreeing chain IDs", () => {
        const error = new ChainIdMismatchError(1, 56);
        expect(error.name).toBe("ChainIdMismatchError");
        expect(error.message).toBe(
            "Ethereum RPC endpoints disagree on their network: 1 vs 56"
        );
    });
});
