import { ethers } from "ethers";
import { createEthereumFallbackProvider } from "../src/ethereum-provider";

// Routing, failure classification, cooldown, chain validation and single
// submission are tested with real ethers in primary-rpc-provider.spec.ts.
describe("Ethereum RPC configuration", () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([undefined, 11155111])(
        "uses the expected chain (%s) and only checks the secondary's chain once",
        async (configuredChainId) => {
            const urls: string[] = [];
            const send = jest
                .spyOn(ethers.providers.JsonRpcProvider.prototype, "send")
                .mockImplementation(async function (
                    this: ethers.providers.JsonRpcProvider,
                    method: string
                ) {
                    urls.push(this.connection.url);
                    expect(method).toBe("eth_chainId");
                    return ethers.utils.hexValue(configuredChainId ?? 1);
                });
            const provider =
                configuredChainId === undefined
                    ? await createEthereumFallbackProvider(
                          "https://nodereal.example",
                          "https://infura.example"
                      )
                    : await createEthereumFallbackProvider(
                          "https://nodereal.example",
                          "https://infura.example",
                          { expectedChainId: configuredChainId }
                      );
            expect((await provider.getNetwork()).chainId).toBe(
                configuredChainId ?? 1
            );
            expect(send).toHaveBeenCalled();
            expect(
                urls.filter((url) => url === "https://infura.example")
            ).toHaveLength(1);
        }
    );

    it("refuses to start with a fallback on another chain", async () => {
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider
        ) {
            return this.connection.url === "https://infura.example"
                ? "0xaa36a7"
                : "0x1";
        });
        await expect(
            createEthereumFallbackProvider(
                "https://nodereal.example",
                "https://infura.example"
            )
        ).rejects.toMatchObject({ code: "NETWORK_ERROR", event: "changed" });
    });

    it("starts with only a warning when the fallback is unreachable", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider
        ) {
            if (this.connection.url === "https://infura.example")
                throw { code: "SERVER_ERROR", status: 503 };
            return "0x1";
        });
        await expect(
            createEthereumFallbackProvider(
                "https://nodereal.example",
                "https://infura.example"
            )
        ).resolves.toBeDefined();
        expect(warn).toHaveBeenCalled();
    });

    it("enables about a minute of backoff rounds for reads and re-sends", async () => {
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockResolvedValue("0x1");
        const provider = await createEthereumFallbackProvider(
            "https://nodereal.example",
            "https://infura.example"
        );
        expect(provider["retryRounds"]).toBe(7);
        expect(provider["retryBaseDelayMs"]).toBe(1000);
        expect(provider["retryMaxDelayMs"]).toBe(30000);
        expect(provider.createReadProvider()["retryRounds"]).toBe(7);
    });

    it("allows single-endpoint deployments while secondary is not configured", async () => {
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockResolvedValue("0x1");
        const provider = await createEthereumFallbackProvider(
            "https://nodereal.example",
            undefined,
            { expectedChainId: undefined }
        );
        expect((await provider.getNetwork()).chainId).toBe(1);
    });
});
