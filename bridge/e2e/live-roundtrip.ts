/**
 * Live Bridge E2E Roundtrip Test
 *
 * Phase 1 (ETH -> 9c): Burns WNCG on Ethereum, invokes Lambda, waits for NCG receipt on 9c.
 * Phase 2 (9c -> ETH): Transfers NCG on 9c back to bridge, invokes Lambda, waits for WNCG mint on ETH.
 *
 * Required env vars:
 *   KMS_PROVIDER_URL          - Ethereum RPC
 *   WNCG_CONTRACT_ADDRESS     - WNCG contract on Ethereum
 *   GRAPHQL_API_ENDPOINT      - 9c GraphQL endpoint
 *   E2E_TEST_PRIVATE_KEY      - Plain ETH private key for test account
 *   E2E_TEST_9C_PRIVATE_KEY   - Plain 9c private key (hex)
 *   E2E_TEST_9C_ADDRESS       - 9c test account address (0x-prefixed hex)
 *   BRIDGE_LAMBDA_ARN         - Lambda ARN to invoke
 *   KMS_PROVIDER_PUBLIC_KEY   - Bridge's ETH address public key (base64)
 *   NCG_MINTER                - NCG minter address for transfer action
 */

import { ethers } from "ethers";
import Web3 from "web3";
import crypto from "crypto";
import { RawPrivateKey } from "@planetarium/account";
import { signTransaction } from "@planetarium/sign";
import { encodeUnsignedTx } from "@planetarium/tx";
import { RecordView, encode } from "@planetarium/bencodex";
import { HeadlessGraphQLClient } from "../src/headless-graphql-client";
import {
    sleep,
    getWNCGBalance,
    waitForNCGReceipt,
    waitForWNCGMint,
    invokeLambda,
} from "./utils";

const BURN_WNCG_AMOUNT = ethers.utils.parseEther("120"); // 120 WNCG
const GRAPHQL_REQUEST_RETRY = 5;
const PHASE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const wNCGTokenAbi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function burn(uint256 amount, bytes32 _to) external",
    "event Burn(address indexed _sender, bytes32 indexed _to, uint256 amount)",
];

function requireEnv(name: string): string {
    const val = process.env[name];
    if (!val) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return val;
}

async function burnWNCG(
    wallet: ethers.Wallet,
    contractAddress: string,
    amount: ethers.BigNumber,
    recipient9cAddress: string
): Promise<{ txHash: string; blockNumber: number }> {
    const contract = new ethers.Contract(
        contractAddress,
        wNCGTokenAbi,
        wallet
    );

    // recipient9cAddress is a 0x-prefixed 40-char hex address; pad to bytes32
    const recipient = recipient9cAddress.toLowerCase().startsWith("0x")
        ? recipient9cAddress
        : "0x" + recipient9cAddress;
    const recipientBytes32 = ethers.utils.hexZeroPad(recipient, 32);

    console.log(
        `[Phase 1] Burning ${ethers.utils.formatEther(amount)} WNCG to 9c address ${recipient9cAddress}`
    );

    const tx = await contract.burn(amount, recipientBytes32);
    console.log(`[Phase 1] Burn tx submitted: ${tx.hash}`);

    const receipt = await tx.wait(1);
    console.log(
        `[Phase 1] Burn tx confirmed at block ${receipt.blockNumber}: ${tx.hash}`
    );

    return { txHash: tx.hash, blockNumber: receipt.blockNumber };
}

async function transferNCGToBridge(
    privateKeyHex: string,
    senderAddress: string,
    bridgeAddress: string,
    amount: string,
    memo: string,
    graphqlClient: HeadlessGraphQLClient,
    ncgMinter: string
): Promise<string> {
    const account = RawPrivateKey.fromHex(privateKeyHex);
    const publicKey = await account.getPublicKey();
    const publicKeyBytes = publicKey.toBytes("uncompressed");

    const recipient = Buffer.from(
        Web3.utils.hexToBytes(bridgeAddress)
    );
    const sender = Buffer.from(
        Web3.utils.hexToBytes(senderAddress)
    );

    const nonce = BigInt(await graphqlClient.getNextTxNonce(senderAddress));
    const genesisHash = Buffer.from(
        await graphqlClient.getGenesisHash(),
        "hex"
    );

    const ncgAmount = Math.floor(parseFloat(amount) * 100);
    const updatedAddresses = new Set([recipient, sender]);

    const action = new RecordView(
        {
            type_id: "transfer_asset5",
            values: {
                amount: [
                    new RecordView(
                        {
                            decimalPlaces: Buffer.from([0x02]),
                            minters: [
                                Buffer.from(
                                    Web3.utils.hexToBytes(ncgMinter)
                                ),
                            ],
                            ticker: "NCG",
                        },
                        "text"
                    ),
                    BigInt(ncgAmount),
                ],
                memo,
                recipient,
                sender,
            },
        },
        "text"
    );

    const MEAD_CURRENCY = {
        ticker: "Mead",
        decimalPlaces: 18,
        minters: null,
        totalSupplyTrackable: false,
        maximumSupply: null,
    };

    const unsignedTx = encodeUnsignedTx({
        nonce,
        publicKey: Buffer.from(publicKeyBytes),
        signer: sender,
        timestamp: new Date(),
        updatedAddresses,
        genesisHash,
        maxGasPrice: {
            currency: MEAD_CURRENCY,
            rawValue: 10n ** 13n,
        },
        gasLimit: 4n,
        actions: [action],
    });

    const tx = await signTransaction(
        Buffer.from(encode(unsignedTx)).toString("hex"),
        account
    );

    const staged = await graphqlClient.stageTx(
        Buffer.from(tx, "hex").toString("base64")
    );
    if (!staged) {
        throw new Error("[Phase 2] Failed to stage NCG transfer transaction");
    }

    const txId = crypto
        .createHash("sha256")
        .update(tx, "hex")
        .digest()
        .toString("hex");

    console.log(`[Phase 2] NCG transfer staged: txId=${txId}`);
    return txId;
}

async function main(): Promise<void> {
    console.log("[E2E] Starting live bridge roundtrip test");

    const KMS_PROVIDER_URL = requireEnv("KMS_PROVIDER_URL");
    const WNCG_CONTRACT_ADDRESS = requireEnv("WNCG_CONTRACT_ADDRESS");
    const GRAPHQL_API_ENDPOINT = requireEnv("GRAPHQL_API_ENDPOINT");
    const E2E_TEST_PRIVATE_KEY = requireEnv("E2E_TEST_PRIVATE_KEY");
    const E2E_TEST_9C_PRIVATE_KEY = requireEnv("E2E_TEST_9C_PRIVATE_KEY");
    const E2E_TEST_9C_ADDRESS = requireEnv("E2E_TEST_9C_ADDRESS");
    const BRIDGE_LAMBDA_ARN = requireEnv("BRIDGE_LAMBDA_ARN");
    const KMS_PROVIDER_PUBLIC_KEY = requireEnv("KMS_PROVIDER_PUBLIC_KEY");
    const NCG_MINTER = requireEnv("NCG_MINTER");

    // Derive bridge ETH address from public key
    const web3 = new Web3();
    const bridgeEthAddress =
        "0x" +
        web3.utils
            .keccak256(
                "0x" +
                    Buffer.from(KMS_PROVIDER_PUBLIC_KEY, "base64")
                        .toString("hex")
                        .slice(2)
            )
            .slice(26);

    console.log(`[E2E] Bridge ETH address: ${bridgeEthAddress}`);

    const provider = new ethers.providers.JsonRpcProvider(KMS_PROVIDER_URL);
    const wallet = new ethers.Wallet(E2E_TEST_PRIVATE_KEY, provider);
    const graphqlClient = new HeadlessGraphQLClient(
        GRAPHQL_API_ENDPOINT,
        GRAPHQL_REQUEST_RETRY,
        process.env.JWT_SECRET_KEY
    );

    // Pre-flight balance check
    const balance = await getWNCGBalance(
        wallet.address,
        provider,
        WNCG_CONTRACT_ADDRESS
    );
    console.log(
        `[E2E] Test account WNCG balance: ${ethers.utils.formatEther(balance)} WNCG`
    );

    if (balance.lt(BURN_WNCG_AMOUNT)) {
        console.warn(
            `[E2E] Insufficient WNCG balance (${ethers.utils.formatEther(balance)} < 120). Skipping test.`
        );
        process.exit(0);
    }

    // ── Phase 1: ETH → 9c ────────────────────────────────────────────────────

    console.log("\n[E2E] === Phase 1: ETH → 9c ===");

    const currentBlock = await provider.getBlockNumber();

    const { txHash: burnTxHash } = await burnWNCG(
        wallet,
        WNCG_CONTRACT_ADDRESS,
        BURN_WNCG_AMOUNT,
        E2E_TEST_9C_ADDRESS
    );

    // Give the RPC a moment to settle before invoking Lambda
    await sleep(5000);
    await invokeLambda(BRIDGE_LAMBDA_ARN);

    console.log("[Phase 1] Waiting for NCG receipt on 9c...");
    const ncgTxId = await waitForNCGReceipt(
        E2E_TEST_9C_ADDRESS,
        burnTxHash,
        graphqlClient,
        { timeoutMs: PHASE_TIMEOUT_MS }
    );
    console.log(`[Phase 1] SUCCESS — NCG received: txId=${ncgTxId}`);

    // ── Phase 2: 9c → ETH ────────────────────────────────────────────────────

    console.log("\n[E2E] === Phase 2: 9c → ETH ===");

    // Transfer the received NCG back to the bridge (120 NCG)
    const ncgAmount = "120.00";
    const ncg9cTxId = await transferNCGToBridge(
        E2E_TEST_9C_PRIVATE_KEY,
        E2E_TEST_9C_ADDRESS,
        bridgeEthAddress,
        ncgAmount,
        wallet.address, // ETH address as memo so bridge mints to our test wallet
        graphqlClient,
        NCG_MINTER
    );

    console.log(
        `[Phase 2] NCG transfer to bridge submitted: txId=${ncg9cTxId}`
    );

    // Wait a bit for transaction to propagate
    await sleep(10000);
    await invokeLambda(BRIDGE_LAMBDA_ARN);

    console.log("[Phase 2] Waiting for WNCG mint on Ethereum...");
    const mintTxHash = await waitForWNCGMint(
        wallet.address,
        currentBlock,
        provider,
        WNCG_CONTRACT_ADDRESS,
        { timeoutMs: PHASE_TIMEOUT_MS }
    );
    console.log(`[Phase 2] SUCCESS — WNCG minted: txHash=${mintTxHash}`);

    // ── Summary ──────────────────────────────────────────────────────────────

    console.log("\n[E2E] === ROUNDTRIP COMPLETE ===");
    console.log(`  ETH burn tx:       ${burnTxHash}`);
    console.log(`  9c NCG receipt tx: ${ncgTxId}`);
    console.log(`  9c NCG transfer:   ${ncg9cTxId}`);
    console.log(`  ETH WNCG mint tx:  ${mintTxHash}`);
}

main().catch((error) => {
    console.error("[E2E] FAILED:", error);
    process.exit(1);
});
