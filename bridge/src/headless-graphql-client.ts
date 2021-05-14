import axios, { AxiosResponse } from "axios";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { TxId } from "./types/txid";

interface GraphQLRequestBody {
    operationName: string | null;
    query: string;
    variables: Object;
}

export class HeadlessGraphQLCLient implements IHeadlessGraphQLClient {
    private readonly _apiEndpoint: string;

    constructor(apiEndpoint: string) {
        this._apiEndpoint = apiEndpoint;
    }

    async transfer(recipient: string, amount: string, txNonce: number): Promise<TxId> {
        const query = `mutation TransferGold($recipient: Address!, $amount: String!, $txNonce: Long!)
        { transfer(recipient: $recipient, amount: $amount, txNonce: $txNonce) }`;
        const response = await this.graphqlRequest({
            operationName: "TransferGold",
            query,
            variables: {
                recipient,
                amount,
                txNonce,
            }});

        return response.data.data.transfer;
    }

    async getNextTxNonce(address: string): Promise<number> {
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
