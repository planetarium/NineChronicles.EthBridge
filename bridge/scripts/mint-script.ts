import { ethers } from "ethers";
import EthersAdapter from "@safe-global/safe-ethers-lib";
import SafeServiceClient from "@safe-global/safe-service-client";
import Safe from "@safe-global/safe-core-sdk";
import {
    SafeTransaction,
    SafeTransactionDataPartial,
} from "@safe-global/safe-core-sdk-types";
import { AwsKmsSigner } from "ethers-aws-kms-signer";
import { Command } from "commander";
import readline from "readline";
import { WebClient } from "@slack/web-api";
import { Decimal } from "decimal.js";
import {
    IGasPricePolicy,
    GasPriceTipPolicy,
    GasPriceLimitPolicy,
    GasPricePolicies,
} from "../src/policies/gas-price";

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);

// Create a wallet instance from the sender's private key
const owner1Signer = new AwsKmsSigner(
    {
        accessKeyId: process.env.SAFE_OWNER_1_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.SAFE_OWNER_1_AWS_SECRET_ACCESS_KEY,
        region: process.env.SAFE_OWNER_1_AWS_REGION!,
        keyId: process.env.SAFE_OWNER_1_AWS_KEY_ID!,
    },
    provider
);
const owner2Signer = new AwsKmsSigner(
    {
        accessKeyId: process.env.SAFE_OWNER_2_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.SAFE_OWNER_2_AWS_SECRET_ACCESS_KEY,
        region: process.env.SAFE_OWNER_2_AWS_REGION!,
        keyId: process.env.SAFE_OWNER_2_AWS_KEY_ID!,
    },
    provider
);
const owner3Signer = new AwsKmsSigner(
    {
        accessKeyId: process.env.SAFE_OWNER_3_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.SAFE_OWNER_3_AWS_SECRET_ACCESS_KEY,
        region: process.env.SAFE_OWNER_3_AWS_REGION!,
        keyId: process.env.SAFE_OWNER_3_AWS_KEY_ID!,
    },
    provider
);

const ethAdapterOwner1 = new EthersAdapter({
    ethers,
    signerOrProvider: owner1Signer,
});

const txServiceUrl = process.env.SAFE_TX_SERVICE_URL!;
const safeService = new SafeServiceClient({
    txServiceUrl,
    ethAdapter: ethAdapterOwner1,
});
let safeSdkOwner1: Safe;
let safeSdkOwner2: Safe;
let safeAddress: string;

// If you have an existing Safe, you can use it instead of deploying a new one
const EXISTING_SAFE_ADDRESS = ethers.utils.getAddress(
    process.env.SAFE_ADDRESS!
);

const SAFE_ABI = [
    "function getThreshold() view returns (uint256)",
    "function getOwners() view returns (address[])",
    "function nonce() view returns (uint256)",
    "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
];
const USE_SAFE_API = process.env.USE_SAFE_API?.toLowerCase() !== "false";
const SAFE_CONTRACT = new ethers.Contract(EXISTING_SAFE_ADDRESS, SAFE_ABI, owner1Signer);

const tipRatio = new Decimal(process.env.GAS_TIP_RATIO || "1.1"); // 기본 10% tip
const maxGasPrice = new Decimal(process.env.MAX_GAS_PRICE || "200"); // Gwei 기준

const gasPricePolicy: IGasPricePolicy = new GasPricePolicies([
    new GasPriceTipPolicy(tipRatio),
    new GasPriceLimitPolicy(maxGasPrice),
]);

async function mint() {
    const program = new Command();
    program
        .name("ad-hoc mint script")
        .description("Transfer using gnosis safe")
        .version("0.0.1");

    program
        .command("mint")
        .description("mint ( ad-hoc mint )")
        .argument("<address>", "destination( address )")
        .argument("<amount>", "amount( to transfer )")
        .argument(
            // optional argument gasPrice
            "[gasPrice]",
            "gasPrice(optional, default: 50)",
            Number(process.env.GAS_PRICE) || 50
        )
        .action(async (address: string, amount: string, gasPrice: string) => {
            await main(address, amount, gasPrice);
        });

    program.parseAsync();
}

mint();

async function sendSlackMessage(text: string): Promise<void> {
    const slackWebClient = new WebClient(process.env.SLACK_WEB_TOKEN);
    const slackChannel = process.env.SLACK_CHANNEL_NAME!;

    await slackWebClient.chat.postMessage({
        channel: slackChannel,
        text,
    });
}

async function initalizeSafe(existingAddress = EXISTING_SAFE_ADDRESS) {
    console.log("initializeSafe safe address", EXISTING_SAFE_ADDRESS);
    safeAddress = existingAddress;
    const ethAdapterOwner1 = new EthersAdapter({
        ethers,
        signerOrProvider: owner1Signer,
    });

    const ethAdapterOwner2 = new EthersAdapter({
        ethers,
        signerOrProvider: owner2Signer,
    });

    safeSdkOwner1 = await Safe.create({
        ethAdapter: ethAdapterOwner1,
        safeAddress,
    });

    safeSdkOwner2 = await Safe.create({
        ethAdapter: ethAdapterOwner2,
        safeAddress,
    });
}

async function proposeMintTransaction(
    amount: string,
    to: string,
    gasPrice: number
) {
    const WNCG_CONTRACT_ADDRESS = ethers.utils.getAddress(
        process.env.WNCG_CONTRACT_ADDRESS!
    );
    const mintAmount = ethers.utils.parseUnits(amount, 18);

    const contract = new ethers.Contract(
        WNCG_CONTRACT_ADDRESS,
        ["function mint(address account, uint256 amount) public"],
        owner1Signer
    );

    const data = contract.interface.encodeFunctionData("mint", [
        to,
        mintAmount,
    ]);

    const safeTransactionData: SafeTransactionDataPartial = {
        to: WNCG_CONTRACT_ADDRESS,
        value: "0",
        data,
        gasPrice,
    };

    // Create a Safe transaction with the provided parameters
    const safeTransaction: SafeTransaction =
        await safeSdkOwner1.createTransaction({ safeTransactionData });

    // Deterministic hash based on transaction parameters
    const safeTxHash = await safeSdkOwner1.getTransactionHash(safeTransaction);

    // Sign transaction to verify that the transaction is coming from owner 1
    const senderSignature = await safeSdkOwner1.signTransactionHash(safeTxHash);

    const owner1SignerAddress = await owner1Signer.getAddress();

    // set address check Summed
    const checkSummedSenderAddress =
        ethers.utils.getAddress(owner1SignerAddress);
    const checkSummedSafeAddress = ethers.utils.getAddress(safeAddress);

    console.log({
        safeAddress: checkSummedSafeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: checkSummedSenderAddress,
        senderSignature: senderSignature.data,
    });
    await safeService.proposeTransaction({
        safeAddress: checkSummedSafeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: checkSummedSenderAddress,
        senderSignature: senderSignature.data,
    });

    return safeTxHash;
}

async function proposeMintTransactionDirect(amount: string, to: string): Promise<any> {
    Decimal.set({ toExpPos: 900000000000000 });

    const rawGasPrice = new Decimal((await provider.getGasPrice()).toString());
    const calculatedGasPrice = gasPricePolicy.calculateGasPrice(rawGasPrice);
    console.log("Original gasPrice:", rawGasPrice.toFixed());
    console.log("Calculated gasPrice:", calculatedGasPrice);

    const WNCG_CONTRACT_ADDRESS = ethers.utils.getAddress(process.env.WNCG_CONTRACT_ADDRESS!);
    const mintAmount = ethers.utils.parseUnits(amount, 18);

    const contract = new ethers.Contract(
        WNCG_CONTRACT_ADDRESS,
        ["function mint(address account, uint256 amount) public"],
        owner1Signer
    );

    const data = contract.interface.encodeFunctionData("mint", [to, mintAmount]);

    const nonce = await SAFE_CONTRACT.nonce();
    const safeTxGas = 50000;
    const baseGas = 0;
    const gasToken = ethers.constants.AddressZero;
    const refundReceiver = ethers.constants.AddressZero;

    const safeTransactionData: SafeTransactionDataPartial = {
        to: WNCG_CONTRACT_ADDRESS,
        value: "0",
        data,
        operation: 0,
        safeTxGas,
        baseGas,
        gasPrice: calculatedGasPrice.toNumber(),
        gasToken,
        refundReceiver,
        nonce: nonce.toNumber(),
    };

    const safeTransaction = await safeSdkOwner1.createTransaction({ safeTransactionData });
    const txHash = await safeSdkOwner1.getTransactionHash(safeTransaction);
    const signature1 = await safeSdkOwner1.signTransactionHash(txHash);
    console.log('signature1', signature1)

    const pendingTx = {
        to: WNCG_CONTRACT_ADDRESS,
        value: "0",
        data,
        nonce: nonce.toNumber(),
        safeTxHash: txHash,
        signatures: new Map([[await owner1Signer.getAddress(), signature1.data]]),
    };

    console.log("Transaction proposed directly:", {
        to: WNCG_CONTRACT_ADDRESS,
        data,
        nonce: nonce.toNumber(),
        txHash,
    });

    return pendingTx;
}

async function confirmTransactionDirect(pendingTx: any) {
    console.log("confirmTransactionDirect", pendingTx);

    if (!pendingTx) {
        throw new Error("No pending transaction to confirm");
    }

    const ethAdapterOwner2 = new EthersAdapter({
        ethers,
        signerOrProvider: owner2Signer,
    });

    const safeSdkOwner2 = await Safe.create({
        ethAdapter: ethAdapterOwner2,
        safeAddress,
    });

    const owner2Address = await owner2Signer.getAddress();

    const signature2 = await safeSdkOwner2.signTransactionHash(pendingTx.safeTxHash);
    pendingTx.signatures.set(owner2Address, signature2.data);

    console.log("Transaction confirmed directly");
    return pendingTx
}

async function executeTransactionDirect(pendingTx: any): Promise<string> {
    if (!pendingTx || !SAFE_CONTRACT) throw new Error("Missing pendingTx or contract");

    const operation = 0;
    const safeTxGas = 50000;
    const baseGas = 0;

    const rawGasPrice = new Decimal((await provider.getGasPrice()).toString());
    const calculatedGasPrice = gasPricePolicy.calculateGasPrice(rawGasPrice);
    const gasPrice = calculatedGasPrice.toNumber();
    console.log("Original gasPrice:", rawGasPrice.toFixed());
    console.log("Calculated gasPrice:", calculatedGasPrice);

    const gasToken = ethers.constants.AddressZero;
    const refundReceiver = ethers.constants.AddressZero;

    const owners = await SAFE_CONTRACT.getOwners();
    const threshold = await SAFE_CONTRACT.getThreshold();

    console.log(
        `Safe threshold: ${threshold}, owners count: ${owners.length}`
    );

    const signedOwners = [...pendingTx.signatures.keys()]

    console.log(
        `Collected ${signedOwners.length}/${threshold} required signatures`
    );

    if (signedOwners.length < threshold.toNumber()) {
        throw new Error(
            `Not enough signatures: ${signedOwners.length}/${threshold} (required)`
        );
    }

    const sortedOwners = [...owners].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
    );

    console.log(`Sorted owners: ${sortedOwners}`);

    let signatures = "0x";
    for (const owner of sortedOwners) {
        if (pendingTx.signatures.has(owner)) {
            const sigData = pendingTx.signatures.get(owner)!;
            signatures += sigData.slice(2);
        }
    }

    console.log(signatures)
    console.log(`Executing transaction with signatures: ${signatures}`);

    const tx = await SAFE_CONTRACT.execTransaction(
        pendingTx.to,
        pendingTx.value,
        pendingTx.data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        signatures
    );

    const receipt = await tx.wait();
    console.log("Transaction executed directly:", receipt.transactionHash);

    pendingTx = null;

    return receipt.transactionHash;
}


async function confirmTransaction(safeTxHash: string) {
    console.log("confirmTransaction", safeTxHash);

    const ethAdapterOwner2 = new EthersAdapter({
        ethers,
        signerOrProvider: owner2Signer,
    });

    const safeSdkOwner2 = await Safe.create({
        ethAdapter: ethAdapterOwner2,
        safeAddress,
    });

    const signature = await safeSdkOwner2.signTransactionHash(safeTxHash);
    const response = await safeService.confirmTransaction(
        safeTxHash,
        signature.data
    );

    console.log("Transaction confirmed:", response);
    return { safeTxHash, confirmationResponse: response };
}

async function executeTransaction(
    safeTxHash: string,
    safeSdk: Safe = safeSdkOwner1
) {
    let safeBalance = await safeSdk.getBalance();

    console.log(
        `[Before Transaction] Safe Balance: ${ethers.utils.formatUnits(
            safeBalance,
            "ether"
        )} ETH`
    );

    const safeTransaction = await safeService.getTransaction(safeTxHash);
    const executeTxResponse = await safeSdk.executeTransaction(safeTransaction);
    const receipt = await executeTxResponse.transactionResponse?.wait();

    if (receipt === undefined) {
        throw new Error("Transaction receipt is undefined");
    }

    console.log("Transaction executed:");
    console.log(
        `${process.env.ETHERSCAN_ROOT_URL}/tx/${receipt?.transactionHash}`
    );

    safeBalance = await safeSdk.getBalance();

    console.log(
        `[After Transaction] Safe Balance: ${ethers.utils.formatUnits(
            safeBalance,
            "ether"
        )} ETH`
    );

    return receipt?.transactionHash;
}

function sleep(sec: number) {
    return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

async function main(destination: string, amount: string, gasPrice: string) {
    const amountToNum = Number(amount);
    const gasPriceToNum = Number(gasPrice);

    if (Number.isNaN(amountToNum)) {
        console.log(`amount:${amount} is not a number`);
        console.log("Cancel Minting...");
        process.exit(1);
    }

    if (Number.isNaN(gasPriceToNum)) {
        console.log(`gasPrice:${gasPrice} is not a number`);
        console.log("Cancel Minting...");
        process.exit(1);
    }

    // Validation Check of Transfer Amount
    if (
        amountToNum > Number(process.env.MAX_TRANSFER_AMOUNT) ||
        amountToNum === 0
    ) {
        console.log("Invalid Amount Input");
        console.log("Cancel Minting...");
        process.exit(1);
    }

    try {
        console.log("destination??", destination);
        ethers.utils.getAddress(destination);
    } catch (e) {
        console.error(e);
        console.log("Cancel Minting...");
        process.exit(1);
    }

    await sleep(1);
    console.clear();

    console.log(
        "==========================================================================================================="
    );
    console.log(
        `Are you trying to Transfer WNCG. To: ${destination}, Amount: ${amount}, gasPrice: ${gasPriceToNum} ??`
    );
    console.log('If Correct, Enter "yes", If not Enter anything');

    const reader = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    await reader.on("line", async (input) => {
        reader.close();

        if (input.toLowerCase() !== "yes") {
            console.log("Cancel Minting....");
            process.exit(1);
        }

        console.log(
            `Trnasfer WNCG to ${destination}, amount: ${amount}, gasPrice: ${gasPriceToNum} ...`
        );

        await initalizeSafe();

        // const safeTxHash = await proposeMintTransaction(
        //     amount,
        //     ethers.utils.getAddress(destination),
        //     gasPriceToNum
        // );
        // const { safeTxHash: confirmedSafeTxHash } = await confirmTransaction(
        //     safeTxHash
        // );
        //
        // const transactionHash = await executeTransaction(confirmedSafeTxHash);
        //
        // const slackMessageText = `:ncg: WNCG minted from 9c-ETH bridge account. ${process.env.FAILURE_SUBSCRIBERS}\n
        // userETHAddress: ${destination}\n
        // amount: ${amount.toString()}\n
        // txId: ${transactionHash}`;
        // await sendSlackMessage(slackMessageText);

        let safeTxHash: string;

        if (USE_SAFE_API) {
            safeTxHash = await proposeMintTransaction(
                amount,
                ethers.utils.getAddress(destination),
                gasPriceToNum
            );
            await confirmTransaction(safeTxHash);
            const transactionHash = await executeTransaction(safeTxHash);
            const slackMessageText = `:ncg: WNCG minted from 9c-ETH bridge account. ${process.env.FAILURE_SUBSCRIBERS}\n
        userETHAddress: ${destination}\n
        amount: ${amount.toString()}\n
        txId: ${transactionHash}`;
            await sendSlackMessage(slackMessageText);
        } else {
            const txObj = await proposeMintTransactionDirect(
                amount,
                ethers.utils.getAddress(destination),
            );
            const txOjb2 = await confirmTransactionDirect(txObj);
            const transactionHash = await executeTransactionDirect(txOjb2);
            const slackMessageText = `:ncg: WNCG minted from 9c-ETH bridge account. ${process.env.FAILURE_SUBSCRIBERS}\n
        userETHAddress: ${destination}\n
        amount: ${amount.toString()}\n
        txId: ${transactionHash}`;
            await sendSlackMessage(slackMessageText);
        }
    });
}
