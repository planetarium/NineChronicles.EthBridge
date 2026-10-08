import { ethers } from "ethers";
import { PrimaryRpcProvider } from "../src/primary-rpc-provider";
import {
    MintOutcomeUnknownError,
    pinnedUntilBroadcast,
} from "../src/mint-safety";

// Real ethers signing and BaseProvider.sendTransaction over the routing
// provider; only the JSON-RPC transport is replaced.
const PRIMARY = "http://primary.invalid";
const SECONDARY = "http://secondary.invalid";
const TO = "0x1111111111111111111111111111111111111111";

type Call = { url: string; method: string; params: any[] };

describe("mint broadcast through real ethers signing", () => {
    let calls: Call[];
    let handlers: Record<string, (url: string, params: any[]) => unknown>;
    let wallet: ethers.Wallet;
    let provider: PrimaryRpcProvider;

    beforeEach(() => {
        calls = [];
        handlers = {};
        jest.spyOn(
            ethers.providers.JsonRpcProvider.prototype,
            "send"
        ).mockImplementation(async function (
            this: ethers.providers.JsonRpcProvider,
            method: string,
            params: any[]
        ) {
            const url = this.connection.url;
            calls.push({ url, method, params });
            const handler = handlers[method];
            if (handler) return handler(url, params);
            switch (method) {
                case "eth_chainId":
                    return "0x1";
                case "eth_blockNumber":
                    return "0x10";
                case "eth_getTransactionCount":
                    return "0x5";
                case "eth_getBlockByNumber":
                    // A pre-London block: ethers' fee data stays legacy.
                    return {
                        number: "0x10",
                        hash: `0x${"11".repeat(32)}`,
                        parentHash: `0x${"22".repeat(32)}`,
                        timestamp: "0x1",
                        nonce: "0x0000000000000000",
                        difficulty: "0x0",
                        gasLimit: "0x1c9c380",
                        gasUsed: "0x0",
                        miner: `0x${"00".repeat(20)}`,
                        extraData: "0x",
                        transactions: [],
                    };
                case "eth_gasPrice":
                    return "0x1";
                case "eth_sendRawTransaction":
                    return ethers.utils.keccak256(params[0]);
                default:
                    throw new Error(`unexpected ${method}`);
            }
        });
        provider = new PrimaryRpcProvider(PRIMARY, SECONDARY, {
            expectedChainId: 1,
        });
        wallet = new ethers.Wallet(`0x${"42".repeat(32)}`, provider);
    });
    afterEach(() => jest.restoreAllMocks());

    const mint = () =>
        pinnedUntilBroadcast(
            provider,
            () =>
                wallet.sendTransaction({
                    to: TO,
                    value: 0,
                    gasLimit: 21000,
                    gasPrice: 1,
                }),
            { attempts: 3, delayMs: 0 }
        );
    const of = (method: string) => calls.filter((c) => c.method === method);

    it("re-reads the nonce on the other endpoint and broadcasts there after a pre-broadcast failure", async () => {
        let failed = false;
        handlers.eth_getTransactionCount = (url) => {
            if (url === PRIMARY && !failed) {
                failed = true;
                throw { code: "TIMEOUT" };
            }
            return url === SECONDARY ? "0x7" : "0x5";
        };
        const response = await mint();
        expect(response.nonce).toBe(7);
        expect(of("eth_sendRawTransaction").map((c) => c.url)).toEqual([
            SECONDARY,
        ]);
        expect(provider.broadcastAttempts).toBe(1);
    });

    it("never re-signs after a definitive rejection", async () => {
        handlers.eth_sendRawTransaction = () => {
            throw { code: -32000, message: "nonce too low" };
        };
        await expect(mint()).rejects.toMatchObject({
            code: "NONCE_EXPIRED",
            broadcastRejected: true,
        });
        expect(of("eth_getTransactionCount")).toHaveLength(1);
        expect(of("eth_sendRawTransaction")).toHaveLength(1);
    });

    it("returns the signed hash when every endpoint is ambiguous, without re-signing", async () => {
        const raws = new Set<string>();
        handlers.eth_sendRawTransaction = (_url, params) => {
            raws.add(params[0]);
            throw { code: "TIMEOUT" };
        };
        const response = await mint();
        expect(raws.size).toBe(1);
        expect(response.hash).toBe(ethers.utils.keccak256([...raws][0]));
        expect(of("eth_sendRawTransaction")).toHaveLength(2);
        expect(of("eth_getTransactionCount")).toHaveLength(1);
    });

    it("turns a post-broadcast hash mismatch into an unknown outcome", async () => {
        let signedHash = "";
        handlers.eth_sendRawTransaction = (_url, params) => {
            signedHash = ethers.utils.keccak256(params[0]);
            return `0x${"00".repeat(32)}`;
        };
        const error = await mint().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(MintOutcomeUnknownError);
        expect(error).toMatchObject({ transactionHash: signedHash });
        expect(of("eth_sendRawTransaction")).toHaveLength(1);
    });
});
