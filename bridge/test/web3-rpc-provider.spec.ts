import Decimal from "decimal.js";
import { WrappedNCGMinter } from "../src/wrapped-ncg-minter";
import { wNCGTokenAbi } from "../src/wrapped-ncg-token";
import { ethers } from "ethers";
import Web3 from "web3";
import { Web3RpcProvider } from "../src/web3-rpc-provider";

describe("legacy Web3 RPC routing", () => {
    const address = "0x1111111111111111111111111111111111111111";
    const hash = "0x" + "ab".repeat(32);
    const rpc = { send: jest.fn() };
    const signer = {
        getAddress: jest.fn(),
        sendTransaction: jest.fn(),
    };
    const adapter = new Web3RpcProvider(
        rpc,
        signer as unknown as ethers.Signer
    );

    beforeEach(() => {
        jest.resetAllMocks();
        signer.getAddress.mockResolvedValue(address);
        signer.sendTransaction.mockResolvedValue({ hash });
    });

    it("serves Web3 accounts from KMS without starting an RPC block tracker", async () => {
        const web3 = new Web3(adapter);
        expect(await web3.eth.getAccounts()).toEqual([address]);
        expect(rpc.send).not.toHaveBeenCalled();
    });

    it("prefers a single failover round for Web3's own polling", async () => {
        const polling = {
            send: jest.fn(),
            sendWithoutRetry: jest.fn().mockResolvedValue("0x2a"),
        };
        const web3 = new Web3(
            new Web3RpcProvider(polling, signer as unknown as ethers.Signer)
        );
        expect(await web3.eth.getGasPrice()).toBe("42");
        expect(polling.sendWithoutRetry).toHaveBeenCalledWith(
            "eth_gasPrice",
            []
        );
        expect(polling.send).not.toHaveBeenCalled();
    });

    it("routes actual Web3 reads through the shared provider", async () => {
        rpc.send.mockResolvedValue("0x2a");
        expect(await new Web3(adapter).eth.getGasPrice()).toBe("42");
        expect(rpc.send).toHaveBeenCalledWith("eth_gasPrice", []);
    });

    it.each([undefined, "0x5208"])(
        "submits a legacy transaction once (gas %s)",
        async (gas) => {
            const transaction = {
                from: address,
                to: address,
                data: "0x1234",
                gasPrice: "0x2a",
                ...(gas === undefined ? {} : { gas }),
            };
            const callback = jest.fn();
            adapter.send(
                {
                    jsonrpc: "2.0",
                    id: 7,
                    method: "eth_sendTransaction",
                    params: [transaction],
                },
                callback
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(callback).toHaveBeenCalledWith(null, {
                jsonrpc: "2.0",
                id: 7,
                result: hash,
            });
            expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
            expect(signer.sendTransaction).toHaveBeenCalledWith({
                from: address,
                to: address,
                data: "0x1234",
                gasPrice: "0x2a",
                ...(gas === undefined ? {} : { gasLimit: gas }),
            });
            expect(rpc.send).not.toHaveBeenCalled();
        }
    );

    it("propagates an ambiguous broadcast error without signing or sending again", async () => {
        const error = Object.assign(new Error("lost response"), {
            code: "TIMEOUT",
        });
        signer.sendTransaction.mockRejectedValue(error);
        const callback = jest.fn();
        adapter.send(
            {
                jsonrpc: "2.0",
                id: 8,
                method: "eth_sendTransaction",
                params: [{ from: address, to: address }],
            },
            callback
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(callback).toHaveBeenCalledWith(error);
        expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
        expect(rpc.send).not.toHaveBeenCalled();
    });
});

describe("Web3 adapter with real ethers signing", () => {
    const recipient = "0x1111111111111111111111111111111111111111";
    const blockHash = "0x" + "ab".repeat(32);
    let wallet: ethers.Wallet;
    let provider: ethers.providers.JsonRpcProvider;
    let adapter: Web3RpcProvider;
    let submitted: string[];
    let broadcastError: unknown;
    beforeEach(() => {
        submitted = [];
        broadcastError = undefined;
        provider = new ethers.providers.JsonRpcProvider(
            "http://rpc.invalid",
            1
        );
        wallet = new ethers.Wallet("0x" + "11".repeat(32), provider);
        jest.spyOn(provider, "send").mockImplementation(
            async (method, params) => {
                if (method === "eth_chainId") return "0x1";
                if (method === "eth_blockNumber") return "0x64";
                if (method === "eth_gasPrice") return "0x2a";
                if (method === "eth_estimateGas") return "0xc350";
                if (method === "eth_getTransactionCount") return "0x7";
                if (method === "eth_sendRawTransaction") {
                    submitted.push(params[0]);
                    if (broadcastError) throw broadcastError;
                    return ethers.utils.keccak256(params[0]);
                }
                if (method === "eth_getBlockByNumber")
                    return {
                        hash: blockHash,
                        parentHash: blockHash,
                        number: "0x64",
                        timestamp: "0x1",
                        nonce: "0x0000000000000000",
                        difficulty: "0x0",
                        gasLimit: "0x1c9c380",
                        gasUsed: "0x0",
                        miner: recipient,
                        extraData: "0x",
                        transactions: [],
                    };
                if (method === "eth_getTransactionReceipt")
                    return {
                        transactionHash: params[0],
                        transactionIndex: "0x0",
                        blockHash,
                        blockNumber: "0x64",
                        from: wallet.address,
                        to: recipient,
                        cumulativeGasUsed: "0xc350",
                        gasUsed: "0xc350",
                        contractAddress: null,
                        logs: [],
                        status: "0x1",
                        logsBloom: "0x" + "00".repeat(256),
                    };
                throw new Error(`Unexpected method ${method}`);
            }
        );
        adapter = new Web3RpcProvider(provider, wallet);
    });
    afterEach(() => {
        provider.removeAllListeners();
        jest.restoreAllMocks();
    });

    it("signs Web3-formatted gas, nonce, chain and type without changing the payload", async () => {
        const transaction = Object.freeze({
            from: wallet.address,
            to: recipient,
            gas: "0x5208",
            gasPrice: "0x2a",
            nonce: "0x9",
            chainId: "0x1",
            type: "0x0",
            value: "0x3",
        });
        const hash = await adapter.request({
            method: "eth_sendTransaction",
            params: [transaction],
        });
        expect(submitted).toHaveLength(1);
        const parsed = ethers.utils.parseTransaction(submitted[0]);
        expect(hash).toBe(parsed.hash);
        expect(parsed.from).toBe(wallet.address);
        expect(parsed.to).toBe(recipient);
        expect(parsed.chainId).toBe(1);
        expect(parsed.nonce).toBe(9);
        expect(parsed.gasLimit.toNumber()).toBe(21000);
        expect(parsed.gasPrice!.toNumber()).toBe(42);
        expect(parsed.value.toNumber()).toBe(3);
        expect(transaction.gas).toBe("0x5208");
        expect(transaction.type).toBe("0x0");
    });
    it("completes a real Web3 sendTransaction and returns its receipt", async () => {
        const web3 = new Web3(adapter);
        const transaction = {
            from: wallet.address,
            to: recipient,
            gas: 21000,
            gasPrice: "42",
            nonce: 9,
            chainId: 1,
            type: 0,
        };
        const receipt = await web3.eth.sendTransaction(transaction);
        expect(submitted).toHaveLength(1);
        const parsed = ethers.utils.parseTransaction(submitted[0]);
        expect(receipt.transactionHash).toBe(parsed.hash);
        expect(receipt.status).toBe(true);
        expect(parsed.chainId).toBe(1);
        expect(parsed.nonce).toBe(9);
    });
    it("completes the legacy minter through real Web3 contract encoding and ethers signing", async () => {
        const minter = new WrappedNCGMinter(
            new Web3(adapter),
            { address: recipient, abi: wNCGTokenAbi },
            wallet.address,
            { calculateGasPrice: (price) => price },
            new Decimal(0)
        );
        const amount = new Decimal(10).pow(18);
        const hash = await minter.mint(recipient, amount);
        expect(submitted).toHaveLength(1);
        const parsed = ethers.utils.parseTransaction(submitted[0]);
        expect(hash).toBe(parsed.hash);
        expect(parsed.from).toBe(wallet.address);
        expect(parsed.to).toBe(recipient);
        expect(parsed.chainId).toBe(1);
        expect(parsed.nonce).toBe(7);
        expect(parsed.gasPrice!.toNumber()).toBe(42);
        expect(parsed.gasLimit.toNumber()).toBe(50000);
        const decoded = new ethers.Contract(
            recipient,
            wNCGTokenAbi
        ).interface.decodeFunctionData("mint", parsed.data);
        expect(decoded[0]).toBe(recipient);
        expect(decoded[1].toString()).toBe(amount.toString());
    });
    it("rejects a different sender before signing or broadcasting", async () => {
        await expect(
            adapter.request({
                method: "eth_sendTransaction",
                params: [
                    {
                        from: recipient,
                        to: recipient,
                        gas: "0x5208",
                        gasPrice: "0x2a",
                        type: "0x0",
                    },
                ],
            })
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
        expect(submitted).toEqual([]);
    });
    it("rejects a transaction for another chain before broadcasting", async () => {
        await expect(
            adapter.request({
                method: "eth_sendTransaction",
                params: [
                    {
                        from: wallet.address,
                        to: recipient,
                        gas: "0x5208",
                        gasPrice: "0x2a",
                        type: "0x0",
                        chainId: "0x38",
                    },
                ],
            })
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
        expect(submitted).toEqual([]);
    });
    it("does not sign or broadcast again after the raw submission times out", async () => {
        broadcastError = Object.assign(new Error("response lost"), {
            code: "TIMEOUT",
        });
        const sign = jest.spyOn(wallet, "signTransaction");
        await expect(
            adapter.request({
                method: "eth_sendTransaction",
                params: [
                    {
                        from: wallet.address,
                        to: recipient,
                        gas: "0x5208",
                        gasPrice: "0x2a",
                        type: "0x0",
                    },
                ],
            })
        ).rejects.toBe(broadcastError);
        expect(submitted).toHaveLength(1);
        expect(sign).toHaveBeenCalledTimes(1);
    });
    it("supports sendAsync and a missing request ID/params", async () => {
        const response = await new Promise((resolve, reject) =>
            adapter.sendAsync(
                { jsonrpc: "2.0", method: "eth_accounts" },
                (error, result) => (error ? reject(error) : resolve(result))
            )
        );
        expect(response).toEqual({
            jsonrpc: "2.0",
            id: 0,
            result: [wallet.address],
        });
    });
    it("rejects unsupported string request IDs before RPC or signing", () => {
        const callback = jest.fn();
        adapter.send(
            {
                jsonrpc: "2.0",
                id: "external-id",
                method: "eth_sendTransaction",
                params: [{}],
            },
            callback
        );
        expect(callback).toHaveBeenCalledWith(
            expect.objectContaining({
                message: "Web3 RPC request IDs must be numeric",
            })
        );
        expect(submitted).toEqual([]);
        expect(provider.send).not.toHaveBeenCalled();
    });
});
