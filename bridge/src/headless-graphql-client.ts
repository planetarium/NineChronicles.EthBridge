import axios, { AxiosResponse } from "axios";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { INCGTransferredEvent } from "./interfaces/ncg-transferred-event";
import { BlockHash } from "./types/block-hash";
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

    async getTipIndex(): Promise<number> {
        const query = `query
        { chainQuery { blockQuery { blocks(desc: true, limit: 1) { index } } } }`;
        const { data } = await axios.post(this._apiEndpoint, {
            operation: null,
            query,
            variables: {},
        }, {
            headers: {
                "Content-Type": "application/json",
            },
        });

        return data.data.chainQuery.blockQuery.blocks[0].index;
    }

    async getBlockHash(index: number): Promise<BlockHash> {
        const query = `query GetBlockHash($index: ID!)
        { chainQuery { blockQuery { block(index: $index) { hash } } } }`;
        const { data } = await axios.post(this._apiEndpoint, {
            operation: "GetBlockHash",
            query,
            variables: {
                index,
            },
        }, {
            headers: {
                "Content-Type": "application/json",
            },
        });

        return data.data.chainQuery.blockQuery.block.hash;
    }

    async getNCGTransferredEvents(blockHash: string, recipient: string | null = null): Promise<INCGTransferredEvent[]> {
        const query = `query GetNCGTransferEvents($blockHash: ByteString!, $recipient: Address!)
        { transferNCGHistories(blockHash: $blockHash, recipient: $recipient) { blockHash txId sender recipient amount } }`;
        const { data } = await axios.post(this._apiEndpoint, {
            operation: "GetNCGTransferEvents",
            query,
            variables: { blockHash, recipient },
        }, {
            headers: {
                "Content-Type": "application/json",
            },
        });

        return data.data.transferNCGHistories;
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