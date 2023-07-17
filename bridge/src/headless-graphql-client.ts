import axios, { AxiosResponse } from "axios";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { NCGTransferredEvent } from "./types/ncg-transferred-event";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

interface GraphQLRequestBody {
    operationName: string | null;
    query: string;
    variables: Record<string, unknown>;
}

export class HeadlessGraphQLClient implements IHeadlessGraphQLClient {
    private readonly _apiEndpoint: string;
    private readonly _maxRetry: number;

    constructor(apiEndpoint: string, maxRetry: number) {
        this._apiEndpoint = apiEndpoint;
        this._maxRetry = maxRetry;
    }

    get endpoint(): string {
        return this._apiEndpoint;
    }

    async getBlockIndex(blockHash: BlockHash): Promise<number> {
        const query = `query GetBlockHash($hash: ID!)
        { chainQuery { blockQuery { block(hash: $hash) { index } } } }`;
        const { data } = await this.graphqlRequest({
            operationName: "GetBlockHash",
            query,
            variables: {
                hash: blockHash,
            },
        });

        return data.data.chainQuery.blockQuery.block.index;
    }

    async getTipIndex(): Promise<number> {
        const query = `query
        { chainQuery { blockQuery { blocks(desc: true, limit: 1) { index } } } }`;
        const { data } = await this.graphqlRequest({
            operationName: null,
            query,
            variables: {},
        });

        return data.data.chainQuery.blockQuery.blocks[0].index;
    }

    async getBlockHash(index: number): Promise<BlockHash> {
        const query = `query GetBlockHash($index: ID!)
        { chainQuery { blockQuery { block(index: $index) { hash } } } }`;
        const { data } = await this.graphqlRequest({
            operationName: "GetBlockHash",
            query,
            variables: {
                index,
            },
        });

        return data.data.chainQuery.blockQuery.block.hash;
    }

    async getNCGTransferredEvents(
        blockHash: string,
        recipient: string | null = null
    ): Promise<NCGTransferredEvent[]> {
        const query = `query GetNCGTransferEvents($blockHash: ByteString!, $recipient: Address!)
        { transferNCGHistories(blockHash: $blockHash, recipient: $recipient) { blockHash txId sender recipient amount memo } }`;
        const { data } = await this.graphqlRequest({
            operationName: "GetNCGTransferEvents",
            query,
            variables: { blockHash, recipient },
        });

        return data.data.transferNCGHistories;
    }

    async transfer(
        recipient: string,
        amount: string,
        txNonce: number,
        memo: string | null
    ): Promise<TxId> {
        const query = `mutation TransferGold($recipient: Address!, $amount: String!, $txNonce: Long!, $memo: String)
        { transfer(recipient: $recipient, amount: $amount, txNonce: $txNonce, memo: $memo) }`;
        const response = await this.graphqlRequest({
            operationName: "TransferGold",
            query,
            variables: {
                recipient,
                amount,
                txNonce,
                memo,
            },
        });

        return response.data.data.transfer;
    }

    async getNextTxNonce(address: string): Promise<number> {
        const query =
            "query GetNextTxNonce($address: Address!) { nextTxNonce(address: $address) } ";
        const response = await this.graphqlRequest({
            operationName: "GetNextTxNonce",
            query,
            variables: { address },
        });

        return response.data.data.nextTxNonce;
    }

    async getGenesisHash(): Promise<string> {
        const query =
            "query GetGenesisHash { chainQuery { blockQuery { block(index: 0) { hash } } } }";
        const response = await this.graphqlRequest({
            operationName: "GetGenesisHash",
            query,
            variables: {},
        });

        return response.data.data.chainQuery.blockQuery.block.hash;
    }

    async createUnsignedTx(
        plainValue: string,
        publicKey: string
    ): Promise<string> {
        const query = `query CreateUnsignedTx($publicKey: String!, $plainValue: String!)
        {
          transaction {
            createUnsignedTx(publicKey: $publicKey, plainValue: $plainValue)
          }
        } `;
        const response = await this.graphqlRequest({
            operationName: "CreateUnsignedTx",
            query,
            variables: { publicKey, plainValue },
        });

        return response.data.data.transaction.createUnsignedTx;
    }

    async attachSignature(
        unsignedTransaction: string,
        signature: string
    ): Promise<string> {
        const query = `query AttachSignature($unsignedTransaction: String!, $signature: String!)
        {
          transaction {
            attachSignature(unsignedTransaction: $unsignedTransaction, signature: $signature)
          }
        } `;
        const response = await this.graphqlRequest({
            operationName: "AttachSignature",
            query,
            variables: { unsignedTransaction, signature },
        });

        return response.data.data.transaction.attachSignature;
    }

    async stageTx(payload: string): Promise<boolean> {
        const query = `mutation StageTx($payload: String!) { stageTx(payload: $payload) }`;
        const response = await this.graphqlRequest({
            operationName: "StageTx",
            query,
            variables: { payload },
        });

        return response.data.data.stageTx;
    }

    private async graphqlRequest(
        body: GraphQLRequestBody,
        retry: number = this._maxRetry
    ): Promise<AxiosResponse> {
        try {
            const response = await axios.post(this._apiEndpoint, body, {
                headers: {
                    "Content-Type": "application/json",
                },
                timeout: 10 * 1000,
            });

            if (response.data.errors) throw response.data.errors;

            return response;
        } catch (error) {
            console.error(`Retrying left ${retry - 1}... error:`, error);
            if (retry > 0) {
                await delay(500);
                const response = await this.graphqlRequest(body, retry - 1);
                return response;
            }

            throw error;
        }
    }
}
