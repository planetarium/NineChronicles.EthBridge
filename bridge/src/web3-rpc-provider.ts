import { ethers } from "ethers";
import { JsonRpcPayload } from "web3-core-helpers";

// A structural response works with both Web3 dependency versions in the lockfile.
type RpcResponse = { jsonrpc: string; id: number; result: any };

/** Let the legacy Web3 minter share the same RPC routing as the Safe minter. */
export class Web3RpcProvider {
    constructor(
        private readonly rpc: {
            send(method: string, params: any[]): Promise<any>;
        },
        private readonly signer: ethers.Signer
    ) {}

    async request(payload: { method: string; params?: any[] }): Promise<any> {
        const params = payload.params ?? [];
        if (payload.method === "eth_accounts") {
            return [await this.signer.getAddress()];
        }
        if (payload.method === "eth_sendTransaction") {
            const { gas, ...transaction } = params[0];
            if (gas !== undefined) transaction.gasLimit = gas;
            // Web3 formats quantities as hex strings; ethers requires numeric
            // transaction type and chain ID, and a safely representable nonce.
            for (const field of ["type", "chainId", "nonce"]) {
                if (transaction[field] !== undefined) {
                    transaction[field] = ethers.BigNumber.from(
                        transaction[field]
                    ).toNumber();
                }
            }
            // Sign and submit exactly once. A timeout after broadcasting is
            // ambiguous and must reach the caller, never re-enter mint().
            const response = await this.signer.sendTransaction(transaction);
            return response.hash;
        }
        return this.rpc.send(payload.method, params);
    }

    send(
        payload: JsonRpcPayload,
        callback: (error: Error | null, response?: RpcResponse) => void
    ): void {
        if (payload.id !== undefined && typeof payload.id !== "number") {
            callback(new Error("Web3 RPC request IDs must be numeric"));
            return;
        }
        const id = payload.id ?? 0;
        this.request(payload).then(
            (result) => callback(null, { jsonrpc: "2.0", id, result }),
            (error) => callback(error)
        );
    }

    sendAsync(
        payload: JsonRpcPayload,
        callback: (error: Error | null, response?: RpcResponse) => void
    ): void {
        this.send(payload, callback);
    }
}
