import axios, { AxiosResponse } from "axios";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { TxId } from "./types/txid";

interface GraphQLRequestBody {
    operationName: string | null;
    query: string;
    variables: Object;
}

export class NCGTransfer implements INCGTransfer {
    private readonly _apiEndpoint: string;

    /**
     * The address of sender;
     */
    private readonly _address: string;

    constructor(apiEndpoint: string, address: string) {
        this._apiEndpoint = apiEndpoint;
        this._address = address;
    }

    async transfer(address: string, amount: BigInt): Promise<TxId> {
        const nextTxNonce = await this.getNextTxNonce(this._address);
        const query = `mutation TransferGold($recipient: Address!, $amount: String!, $txNonce: Long!)
        { transfer(recipient: $recipient, amount: $amount, txNonce: $txNonce) }`;
        const response = await this.graphqlRequest({
            operationName: "TransferGold",
            query,
            variables: {
                recipient: address,
                amount: amount.toString(),
                txNonce: nextTxNonce,
            }});

        return response.data.data.transfer;
    }

    private async getNextTxNonce(address: string): Promise<number> {
        const query = "query GetNextTxNonce($address: Address!) { nextTxNonce(address: $address) } ";
        const response = await this.graphqlRequest({
            operationName: "GetNextTxNonce",
            query,
            variables: { address, }
        });

        return response.data.data.nextTxNonce;
    }

    private async graphqlRequest(body: GraphQLRequestBody): Promise<AxiosResponse> {
        return axios.post(this._apiEndpoint, body,
        {
            headers: {
                "Content-Type": "application/json",
            },
        });
    }
}
