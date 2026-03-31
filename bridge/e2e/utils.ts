import { ethers } from "ethers";
import {
    LambdaClient,
    InvokeCommand,
    InvocationType,
} from "@aws-sdk/client-lambda";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getWNCGBalance(
    address: string,
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string
): Promise<ethers.BigNumber> {
    const abi = ["function balanceOf(address owner) view returns (uint256)"];
    const contract = new ethers.Contract(contractAddress, abi, provider);
    return contract.balanceOf(address);
}

export async function waitForNCGReceipt(
    address: string,
    burnTxHash: string,
    graphqlClient: IHeadlessGraphQLClient,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const pollIntervalMs = opts.pollIntervalMs ?? 15 * 1000;
    const deadline = Date.now() + timeoutMs;

    console.log(
        `[waitForNCGReceipt] Waiting for NCG receipt for burn tx ${burnTxHash}`
    );

    while (Date.now() < deadline) {
        try {
            const tipIndex = await graphqlClient.getTipIndex();
            const tipHash = await graphqlClient.getBlockHash(tipIndex);
            const events = await graphqlClient.getNCGTransferredEvents(
                tipHash,
                address
            );

            for (const event of events) {
                if (event.memo === burnTxHash) {
                    console.log(
                        `[waitForNCGReceipt] Found NCG receipt: txId=${event.txId}, amount=${event.amount}`
                    );
                    return event.txId;
                }
            }
        } catch (e) {
            console.error("[waitForNCGReceipt] Error polling:", e);
        }

        await sleep(pollIntervalMs);
    }

    throw new Error(
        `[waitForNCGReceipt] Timed out waiting for NCG receipt for burn tx ${burnTxHash}`
    );
}

export async function waitForWNCGMint(
    recipientAddress: string,
    fromBlock: number,
    provider: ethers.providers.JsonRpcProvider,
    contractAddress: string,
    opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const pollIntervalMs = opts.pollIntervalMs ?? 15 * 1000;
    const deadline = Date.now() + timeoutMs;

    const abi = [
        "event Transfer(address indexed from, address indexed to, uint256 value)",
    ];
    const contract = new ethers.Contract(contractAddress, abi, provider);
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

    console.log(
        `[waitForWNCGMint] Waiting for WNCG mint to ${recipientAddress} from block ${fromBlock}`
    );

    while (Date.now() < deadline) {
        try {
            const currentBlock = await provider.getBlockNumber();
            const filter = contract.filters.Transfer(
                ZERO_ADDRESS,
                recipientAddress
            );
            const events = await contract.queryFilter(
                filter,
                fromBlock,
                currentBlock
            );

            if (events.length > 0) {
                const txHash = events[0].transactionHash;
                console.log(
                    `[waitForWNCGMint] Found WNCG mint tx: ${txHash}`
                );
                return txHash;
            }
        } catch (e) {
            console.error("[waitForWNCGMint] Error polling:", e);
        }

        await sleep(pollIntervalMs);
    }

    throw new Error(
        `[waitForWNCGMint] Timed out waiting for WNCG mint to ${recipientAddress}`
    );
}

export async function invokeLambda(lambdaArn: string): Promise<void> {
    const region = process.env.AWS_REGION ?? "us-east-1";
    const client = new LambdaClient({ region });

    console.log(`[invokeLambda] Invoking Lambda ${lambdaArn}`);

    const result = await client.send(
        new InvokeCommand({
            FunctionName: lambdaArn,
            InvocationType: InvocationType.RequestResponse,
        })
    );

    if (result.FunctionError) {
        const payload = result.Payload
            ? Buffer.from(result.Payload).toString("utf-8")
            : "(no payload)";
        throw new Error(
            `Lambda invocation failed: ${result.FunctionError} — ${payload}`
        );
    }

    console.log(`[invokeLambda] Lambda invocation succeeded`);
}
