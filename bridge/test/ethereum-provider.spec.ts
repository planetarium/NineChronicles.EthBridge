import { ethers } from "ethers";
import { createEthereumFallbackProvider } from "../src/ethereum-provider";

// Routing, failure classification, cooldown, chain validation and single
// submission are tested with real ethers in primary-rpc-provider.spec.ts.
describe("Ethereum RPC configuration", () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([undefined, 11155111])(
        "uses the expected chain (%s) and keeps secondary idle",
        async (configuredChainId) => {
            const send = jest
                .spyOn(ethers.providers.JsonRpcProvider.prototype, "send")
                .mockImplementation(async function (
                    this: ethers.providers.JsonRpcProvider,
                    method: string
                ) {
                    expect(this.connection.url).toBe(
                        "https://nodereal.example"
                    );
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
        }
    );

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
