"use strict";
import { NCGKMSTransfer } from "../src/ncg-kms-transfer";
import { KmsProvider } from "@planetarium/aws-kms-provider";
import Web3 from "web3";
import { HeadlessGraphQLClient } from "../src/headless-graphql-client";
import { KMSNCGSigner } from "../src/kms-ncg-signer";
import { isAddress } from "web3-utils";
import { Command } from "commander";
import readline from "readline";
import { WebClient } from "@slack/web-api";

async function transfer() {
    const program = new Command();
    program
        .name("ad-hoc transfer script")
        .description("Transfer token")
        .version("0.0.1");

    program
        .command("transfer")
        .description("transfer ( ad-hoc transfer )")
        .argument("<address>", "destination( 9c address )")
        .argument("<amount>", "amount( to transfer )")
        .argument("<planetName>", "planetName")
        .argument("<operator>", "operator who run this command")
        .action(
            async (
                address: string,
                amount: string,
                planetName: string,
                operator: string
            ) => {
                await transferNcg(address, amount, planetName, operator);
            }
        );

    program.parseAsync();
}

transfer();

async function sendSlackMessage(text: string): Promise<void> {
    const slackWebClient = new WebClient(process.env.SLACK_WEB_TOKEN);
    const slackChannel = process.env.SLACK_CHANNEL_NAME!;

    await slackWebClient.chat.postMessage({
        channel: slackChannel,
        text,
    });
}

async function transferNcg(
    user9cAddress: string,
    amount: string,
    planetName: string,
    operator: string
) {
    if (!["odin", "heimdall"].includes(planetName)) {
        console.log(`Wrong planeName ${planetName} Cancel transfer ...`);
        const slackMessageText = `Wrong planeName  ( ${planetName} ) inserted. ${process.env.FAILURE_SUBSCRIBERS}`;
        await sendSlackMessage(slackMessageText);

        process.exit(1);
    }

    if (Number(amount) > 1000000) {
        console.log("Cannot transfer over 1000000 - Cancel transfer ...");
        process.exit(1);
    }

    const isValidAddress = (address: string) => {
        const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
        return (
            address.startsWith("0x") &&
            isAddress(address) &&
            address !== ZERO_ADDRESS
        );
    };
    if (!isValidAddress(user9cAddress)) {
        console.log("isValidAddress - Cancel transfer...");
        process.exit(1);
    }

    const GRAPHQL_API_ENDPOINT = process.env.GRAPHQL_API_ENDPOINT!;
    const NCG_MINTER = process.env.NCG_MINTER!;

    const KMS_PROVIDER_URL = process.env.KMS_PROVIDER_URL!;
    const KMS_PROVIDER_REGION = process.env.KMS_PROVIDER_REGION!;
    const KMS_PROVIDER_KEY_ID = process.env.KMS_PROVIDER_KEY_ID!;
    const KMS_PROVIDER_AWS_ACCESSKEY = process.env.KMS_PROVIDER_AWS_ACCESSKEY!;
    const KMS_PROVIDER_AWS_SECRETKEY = process.env.KMS_PROVIDER_AWS_SECRETKEY!;
    const KMS_PROVIDER_PUBLIC_KEY = process.env.KMS_PROVIDER_PUBLIC_KEY!;
    const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY!;

    const GRAPHQL_REQUEST_RETRY = 5;
    const headlessGraphQLCLient = new HeadlessGraphQLClient(
        GRAPHQL_API_ENDPOINT,
        GRAPHQL_REQUEST_RETRY,
        JWT_SECRET_KEY
    );

    const kmsProvider = new KmsProvider(KMS_PROVIDER_URL, {
        region: KMS_PROVIDER_REGION,
        keyIds: [KMS_PROVIDER_KEY_ID],
        credential: {
            accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
            secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY,
        },
    });
    const web3 = new Web3(kmsProvider);

    const kmsAddresses = await kmsProvider.getAccounts();
    if (kmsAddresses.length != 1) {
        console.log("NineChronicles.EthBridge is supported only one address.");
        const slackMessageText = `More than 1 KMS account found. Aborted ${process.env.FAILURE_SUBSCRIBERS}`;
        await sendSlackMessage(slackMessageText);
        process.exit(1);
    }
    const kmsAddress = kmsAddresses[0];
    console.log("kmsAddress", kmsAddress);

    const signer = new KMSNCGSigner(KMS_PROVIDER_REGION, KMS_PROVIDER_KEY_ID, {
        accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
        secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY,
    });
    const derivedAddress =
        "0x" +
        web3.utils
            .keccak256(
                "0x" +
                    Buffer.from(KMS_PROVIDER_PUBLIC_KEY, "base64")
                        .toString("hex")
                        .slice(2)
            )
            .slice(26);
    if (kmsAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
        console.log(
            "KMS_PROVIDER_PUBLIC_KEY variable seems invalid because it doesn't match to address from KMS."
        );
        const slackMessageText = `KMS_PROVIDER_PUBLIC_KEY variable seems invalid because it doesn't match to address from KMS. ${process.env.FAILURE_SUBSCRIBERS}`;
        await sendSlackMessage(slackMessageText);

        process.exit(1);
    }

    const ncgKmsTransfer = new NCGKMSTransfer(
        [headlessGraphQLCLient],
        kmsAddress,
        KMS_PROVIDER_PUBLIC_KEY,
        [NCG_MINTER],
        signer
    );

    console.log(
        "==========================================================================================================="
    );
    console.log(
        `Are you trying to Transfer NCG. To: ${user9cAddress}, Amount: ${amount} PlanetName: ${planetName} ??`
    );
    console.log('If Correct, Enter "yes", If not Enter anything');

    const reader = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    await reader.on("line", async (input) => {
        reader.close();

        if (input.toLowerCase() !== "yes") {
            console.log("Cancel Transferring....");
            process.exit(1);
        }

        console.log(
            `Transferring NCG to ${user9cAddress}, amount: ${amount}, PlanetName: ${planetName} ...`
        );

        const recipient =
            planetName === "odin"
                ? user9cAddress
                : process.env.ODIN_TO_HEIMDALL_VALUT_ADDRESS!;

        const memo = planetName === "odin" ? null : user9cAddress;

        const txId = await ncgKmsTransfer.transfer(
            recipient,
            amount.toString(),
            memo
        );

        console.log("txId", txId);

        const slackMessageText = `:ncg: NCG transferred from 9c-ETH bridge account sent. Operator: ${operator}\n
        user9cAddress: ${user9cAddress}\n
        amount: ${amount.toString()}\n
        planet: ${planetName}\n
        txId: ${txId}`;
        await sendSlackMessage(slackMessageText);
    });
}
