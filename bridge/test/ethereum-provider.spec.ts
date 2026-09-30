import * as http from "http";
import { AddressInfo } from "net";
import {
    createEthereumFallbackProvider,
    ChainIdMismatchError,
} from "../src/ethereum-provider";

type JsonRpcHandler = (method: string, params: unknown[]) => unknown;

function startJsonRpcServer(
    handler: JsonRpcHandler
): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", () => {
                const { id, method, params } = JSON.parse(body);
                res.writeHead(200, { "Content-Type": "application/json" });
                try {
                    const result = handler(method, params ?? []);
                    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
                } catch (error) {
                    res.end(
                        JSON.stringify({
                            jsonrpc: "2.0",
                            id,
                            error: { code: -32000, message: String(error) },
                        })
                    );
                }
            });
        });

        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise<void>((r) => server.close(() => r())),
            });
        });
    });
}

function makeHandler(
    chainIdHex: string,
    blockNumberHex = "0x2a"
): JsonRpcHandler {
    return (method) => {
        if (method === "eth_chainId") {
            return chainIdHex;
        }
        if (method === "eth_blockNumber") {
            return blockNumberHex;
        }
        throw new Error(`unexpected JSON-RPC method in test: ${method}`);
    };
}

describe(createEthereumFallbackProvider.name, () => {
    // This is the reviewer's exact repro: the sub provider's connection
    // fails entirely (nothing is listening on this port on loopback, so it
    // fails fast with ECONNREFUSED rather than hanging), and a normal RPC
    // call must still succeed via the healthy main provider. Before the
    // fix, ethers v5's FallbackProvider.detectNetwork() would await BOTH
    // providers' getNetwork() before the FallbackProvider was usable at
    // all, so this would fail/hang even though quorum=1 should tolerate a
    // single unreachable provider for ordinary calls.
    it("still succeeds a normal call via the main provider when the sub provider's connection fails entirely", async () => {
        const main = await startJsonRpcServer(makeHandler("0x1"));
        // Nothing listens here, so connecting fails immediately.
        const subUrl = "http://127.0.0.1:1";

        try {
            const provider = await createEthereumFallbackProvider(
                main.url,
                subUrl,
                { subProviderProbeTimeoutMs: 500 }
            );

            expect(await provider.getBlockNumber()).toEqual(42);
        } finally {
            await main.close();
        }
    });

    // ethers v5's `getNetwork()` re-verifies the network on every call, not
    // just the first, so this must keep working on repeated calls too - not
    // only immediately after construction.
    it("keeps succeeding via the main provider on repeated calls, not just the first, while the sub provider stays down", async () => {
        const main = await startJsonRpcServer(makeHandler("0x1"));
        const subUrl = "http://127.0.0.1:1";

        try {
            const provider = await createEthereumFallbackProvider(
                main.url,
                subUrl,
                { subProviderProbeTimeoutMs: 500 }
            );

            expect(await provider.getBlockNumber()).toEqual(42);
            expect(await provider.getBlockNumber()).toEqual(42);
            expect(await provider.getNetwork()).toEqual(
                expect.objectContaining({ chainId: 1 })
            );
        } finally {
            await main.close();
        }
    });

    it("builds a working FallbackProvider when both providers are reachable and agree on the same chain", async () => {
        const main = await startJsonRpcServer(makeHandler("0x1"));
        const sub = await startJsonRpcServer(makeHandler("0x1"));

        try {
            const provider = await createEthereumFallbackProvider(
                main.url,
                sub.url
            );

            expect(await provider.getBlockNumber()).toEqual(42);
        } finally {
            await main.close();
            await sub.close();
        }
    });

    it("throws ChainIdMismatchError - never silently ignored - when the sub provider is reachable but reports a different chain", async () => {
        const main = await startJsonRpcServer(makeHandler("0x1"));
        const sub = await startJsonRpcServer(makeHandler("0x2"));

        try {
            await expect(
                createEthereumFallbackProvider(main.url, sub.url)
            ).rejects.toBeInstanceOf(ChainIdMismatchError);
        } finally {
            await main.close();
            await sub.close();
        }
    });
});
