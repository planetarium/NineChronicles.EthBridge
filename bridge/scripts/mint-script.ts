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
let safeAddress: string;

// If you have an existing Safe, you can use it instead of deploying a new one
const EXISTING_SAFE_ADDRESS = ethers.utils.getAddress(
    process.env.SAFE_ADDRESS!
);

async function mint() {
    const program = new Command();
    program
        .name("ad-hoc mint script")
        .description("Transfer using gnosis safe")
        .version("0.0.1");

    program
        .command("mint")
        .description("mint ( ad-hoc mint )")
        .argument("<string>", "destination( address )")
        .argument("<string>", "amount( to transfer )")
        .action(async (address: string, amount: string) => {
            console.log("address", address);
            console.log("amount", amount);
            await main(address, amount);
        });

    program.parseAsync();
}

mint();

async function initalizeSafe(existingAddress = EXISTING_SAFE_ADDRESS) {
    console.log("initializeSafe safe address", EXISTING_SAFE_ADDRESS);
    safeAddress = existingAddress;
    const ethAdapterOwner1 = new EthersAdapter({
        ethers,
        signerOrProvider: owner1Signer,
    });

    safeSdkOwner1 = await Safe.create({
        ethAdapter: ethAdapterOwner1,
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
}

function sleep(sec: number) {
    return new Promise((resolve) => setTimeout(resolve, sec * 1000));
}

async function main(destination: string, amount: string) {
    const amountToNum = Number(amount);

    if (Number.isNaN(amountToNum)) {
        console.log(`amount:${amount} is not a number`);
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
        `Are you trying to Transfer WNCG. To: ${destination}, Amount: ${amount} ??`
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

        console.log(`Trnasfer WNCG to ${destination}, amount: ${amount} ...`);

        await initalizeSafe();

        const recipient = destination;
        const gasPrice = 40;

        const safeTxHash = await proposeMintTransaction(
            amount,
            ethers.utils.getAddress(recipient),
            gasPrice
        );
        const { safeTxHash: confirmedSafeTxHash } = await confirmTransaction(
            safeTxHash
        );
        await executeTransaction(confirmedSafeTxHash);
    });
}
