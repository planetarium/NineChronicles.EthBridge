"use strict";
import { NCGKMSTransfer } from "../src/ncg-kms-transfer";
import { KmsProvider, KmsSigner } from "@planetarium/aws-kms-provider";
import Web3 from "web3";
import { HeadlessGraphQLClient } from "../src/headless-graphql-client";
import { KMSNCGSigner } from "../src/kms-ncg-signer";
import { isAddress } from "web3-utils";
import { Command } from "commander";
import readline from "readline";
import { WebClient } from "@slack/web-api";

async function feeTransfer() {
    const program = new Command();
    program
        .name("ad-hoc transfer script")
        .description("Transfer token by Fee Collector Account")
        .version("0.0.1");

    program
        .command("feeTransfer")
        .description("feeTransfer ( transfer to 9c address or swap to ether )")
        .argument(
            "<address>",
            "destination( address, 9c address or ether address )"
        )
        .argument("<amount>", "amount( to transfer )")
        .action(async (address: string, amount: string) => {
            await transferNcg(address, amount);
        });

    program.parseAsync();
}

feeTransfer();

async function sendSlackMessage(text: string): Promise<void> {
    const slackWebClient = new WebClient(process.env.SLACK_WEB_TOKEN);
    const slackChannel = process.env.SLACK_CHANNEL_NAME!;

    await slackWebClient.chat.postMessage({
        channel: slackChannel,
        text,
    });
}

async function transferNcg(address: string, amount: string) {
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
    if (!isValidAddress(address)) {
        console.log("isValidAddress - Cancel transfer...");
        process.exit(1);
    }

    const BRIDGE_ADDRESS = process.env.BRIDGE_ADDRESS!;

    const GRAPHQL_API_ENDPOINT = process.env.GRAPHQL_API_ENDPOINT!;
    const NCG_MINTER = process.env.NCG_MINTER!;

    const KMS_PROVIDER_URL = process.env.KMS_PROVIDER_URL!;
    const FEE_KMS_REGION = process.env.FEE_KMS_REGION!;
    const FEE_KMS_KEY_ID = process.env.FEE_KMS_KEY_ID!;
    const FEE_KMS_AWS_ACCESSKEY = process.env.FEE_KMS_AWS_ACCESSKEY!;
    const FEE_KMS_AWS_SECRETKEY = process.env.FEE_KMS_AWS_SECRETKEY!;
    const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY!;

    const kmsSigner = new KmsSigner(FEE_KMS_REGION, FEE_KMS_KEY_ID, {
        accessKeyId: FEE_KMS_AWS_ACCESSKEY,
        secretAccessKey: FEE_KMS_AWS_SECRETKEY,
    });
    const KMS_PROVIDER_PUBLIC_KEY = (await kmsSigner.getPublicKey())
        .slice(23)
        .toString("base64");

    const headlessGraphQLCLient = new HeadlessGraphQLClient(
        GRAPHQL_API_ENDPOINT,
        5,
        JWT_SECRET_KEY
    );

    const kmsProvider = new KmsProvider(KMS_PROVIDER_URL, {
        region: FEE_KMS_REGION,
        keyIds: [FEE_KMS_KEY_ID],
        credential: {
            accessKeyId: FEE_KMS_AWS_ACCESSKEY,
            secretAccessKey: FEE_KMS_AWS_SECRETKEY,
        },
    });
    const web3 = new Web3(kmsProvider);

    const kmsAddresses = await kmsProvider.getAccounts();
    if (kmsAddresses.length != 1) {
        console.log("NineChronicles.EthBridge Fee Collector is supported only one address.");
        process.exit(1);
    }
    const kmsAddress = kmsAddresses[0];
    console.log("kmsAddress", kmsAddress);

    const signer = new KMSNCGSigner(FEE_KMS_REGION, FEE_KMS_KEY_ID, {
        accessKeyId: FEE_KMS_AWS_ACCESSKEY,
        secretAccessKey: FEE_KMS_AWS_SECRETKEY,
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
        process.exit(1);
    }

    const ncgKmsTransfer = new NCGKMSTransfer(
        [headlessGraphQLCLient],
        kmsAddress,
        KMS_PROVIDER_PUBLIC_KEY,
        [NCG_MINTER],
        signer
    );

    const reader = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    await reader.question(
        "ENTER transfer case ( 1. transfer to other 9c address, 2. swap to ether ) : ",
        async (input) => {
            console.log("after input transferCase", input);

            if (input !== "1" && input !== "2") {
                console.log("Cancel Transferring....");
                process.exit(1);
            }

            const transferCase =
                input === "1"
                    ? "transfer to other 9c address"
                    : "swap to ether";

            console.log(
                "==========================================================================================================="
            );
            console.log(
                `Are you trying to ${transferCase}. Address: ${address}, Amount: ${amount} ??`
            );

            await reader.question(
                'If Correct, Enter "yes", If not Enter anything : ',
                async (additionalInput) => {
                    if (additionalInput.toLowerCase() !== "yes") {
                        console.log("Cancel Transferring....");
                        process.exit(1);
                    }

                    let txId = "";

                    if (input === "1") {
                        // send to other 9c address
                        txId = await ncgKmsTransfer.transfer(
                            address,
                            amount.toString(),
                            null
                        );
                    } else {
                        // swap to ether and send to ether address
                        txId = await ncgKmsTransfer.transfer(
                            BRIDGE_ADDRESS, // Recipient : bridge address
                            amount.toString(),
                            address
                        );
                    }

                    console.log("txId", txId);
                    reader.close();

                    const slackMessageText = `:ncg: NCG transferred ( ${transferCase} ) from 9c-ETH bridge fee account sent.${process.env.FAILURE_SUBSCRIBERS} \n
                    destinationAddress: ${address}\n
                    amount: ${amount.toString()}\n
                    txId: ${txId}`;
                    await sendSlackMessage(slackMessageText);
                }
            );
        }
    );
}
