import { ethers } from "ethers";
import { createEthereumFallbackProvider } from "../src/ethereum-provider";

describe("Ethereum RPC failover", () => {
    type RpcState = { down: boolean; chainId: string; requests: string[] };
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
});
