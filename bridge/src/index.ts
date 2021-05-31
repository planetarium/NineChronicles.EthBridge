import { config } from "dotenv";

import Web3 from "web3";
import { init } from "@sentry/node";

import { BurnEventResult } from "./interfaces/burn-event-result";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { EthereumBurnEventMonitor } from "./ethereum-burn-event-monitor";
import { NCGTransfer } from "./ncg-transfer";
import { WrappedNCGMinter } from "./wrapped-ncg-minter";
import { wNCGTokenAbi } from "./wrapped-ncg-token";
import HDWalletProvider from "@truffle/hdwallet-provider";
import { HeadlessGraphQLClient } from "./headless-graphql-client";
import { NineChroniclesTransferredEventMonitor } from "./nine-chronicles-transferred-event-monitor";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";
import { IHeadlessHTTPClient } from "./interfaces/headless-http-client";
import { HeadlessHTTPClient } from "./headless-http-client";
import { ContractDescription } from "./interfaces/contract-description";
import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Sqlite3MonitorStateStore } from "./sqlite3-monitor-state-store";
import { TransactionLocation } from "./types/transaction-location";
import { WebClient } from "@slack/web-api"
import { URL } from "url";

config();

const WEB_SOCKET_PROVIDER_URI: string | undefined = process.env.WEB_SOCKET_PROVIDER_URI;
if (WEB_SOCKET_PROVIDER_URI === undefined) {
    console.error("Please set 'WEB_SOCKET_PROVIDER_URI' at .env");
    process.exit(-1);
}

const GRAPHQL_API_ENDPOINT: string | undefined = process.env.GRAPHQL_API_ENDPOINT;
if (GRAPHQL_API_ENDPOINT === undefined) {
    console.error("Please set 'GRAPHQL_API_ENDPOINT' at .env");
    process.exit(-1);
}

const HTTP_ROOT_API_ENDPOINT: string | undefined = process.env.HTTP_ROOT_API_ENDPOINT;
if (HTTP_ROOT_API_ENDPOINT === undefined) {
    console.error("Please set 'HTTP_ROOT_API_ENDPOINT' at .env");
    process.exit(-1);
}

const BRIDGE_9C_ADDRESS: string | undefined = process.env.BRIDGE_9C_ADDRESS;
if (BRIDGE_9C_ADDRESS === undefined) {
    console.error("Please set 'BRIDGE_9C_ADDRESS' at .env");
    process.exit(-1);
}

const BRIDGE_9C_PRIVATE_KEY: string | undefined = process.env.BRIDGE_9C_PRIVATE_KEY;
if (BRIDGE_9C_PRIVATE_KEY === undefined) {
    console.error("Please set 'BRIDGE_9C_PRIVATE_KEY' at .env");
    process.exit(-1);
}

const CHAIN_ID_STRING: string | undefined = process.env.CHAIN_ID;
if (CHAIN_ID_STRING === undefined) {
    console.error("Please set 'CHAIN_ID' at .env");
    process.exit(-1);
}

const CHAIN_ID = parseInt(CHAIN_ID_STRING);
if (CHAIN_ID === NaN) {
    console.error("Please set 'CHAIN_ID' with valid format at .env");
    process.exit(-1);
}

const HD_WALLET_PROVIDER_URL: string | undefined = process.env.HD_WALLET_PROVIDER_URL;
if (HD_WALLET_PROVIDER_URL === undefined) {
    console.error("Please set 'HD_WALLET_PROVIDER_URL' at .env");
    process.exit(-1);
}

const HD_WALLET_MNEMONIC: string | undefined = process.env.HD_WALLET_MNEMONIC;
if (HD_WALLET_MNEMONIC === undefined) {
    console.error("Please set 'HD_WALLET_MNEMONIC' at .env");
    process.exit(-1);
}

const HD_WALLET_MNEMONIC_ADDRESS_NUMBER_STRING: string | undefined = process.env.HD_WALLET_MNEMONIC_ADDRESS_NUMBER;
if (HD_WALLET_MNEMONIC_ADDRESS_NUMBER_STRING === undefined) {
    console.error("Please set 'HD_WALLET_MNEMONIC_ADDRESS_NUMBER' at .env");
    process.exit(-1);
}

const HD_WALLET_MNEMONIC_ADDRESS_NUMBER = parseInt(HD_WALLET_MNEMONIC_ADDRESS_NUMBER_STRING);
if (HD_WALLET_MNEMONIC_ADDRESS_NUMBER === NaN) {
    console.error("Please set 'HD_WALLET_MNEMONIC_ADDRESS_NUMBER' with valid format at .env");
    process.exit(-1);
}

const DEBUG: string | undefined = process.env.DEBUG;
if (DEBUG !== undefined && DEBUG !== 'TRUE') {
    console.error("Please set 'DEBUG' as 'TRUE' or remove 'DEBUG' at .env.");
    process.exit(-1);
}

const SENTRY_DSN: string | undefined = process.env.SENTRY_DSN;
if (SENTRY_DSN !== undefined) {
    init({
        dsn: SENTRY_DSN,
    });
}

const WNCG_CONTRACT_ADDRESS: string | undefined = process.env.WNCG_CONTRACT_ADDRESS;
if (WNCG_CONTRACT_ADDRESS === undefined) {
    console.error("Please set 'WNCG_CONTRACT_ADDRESS' at .env");
    process.exit(-1);
}

const MONITOR_STATE_STORE_PATH: string | undefined = process.env.MONITOR_STATE_STORE_PATH;
if (MONITOR_STATE_STORE_PATH === undefined) {
    console.error("Please set 'MONITOR_STATE_STORE_PATH' at .env");
    process.exit(-1);
}

const SLACK_WEB_TOKEN: string | undefined = process.env.SLACK_WEB_TOKEN;
if (SLACK_WEB_TOKEN === undefined) {
    console.error("Please set 'SLACK_WEB_TOKEN' at .env");
    process.exit(-1);
}

const EXPLORER_ROOT_URL: string | undefined = process.env.EXPLORER_ROOT_URL;
if (EXPLORER_ROOT_URL === undefined) {
    console.error("Please set 'EXPLORER_ROOT_URL' at .env");
    process.exit(-1);
}

const ETHERSCAN_ROOT_URL: string | undefined = process.env.ETHERSCAN_ROOT_URL;
if (ETHERSCAN_ROOT_URL === undefined) {
    console.error("Please set 'ETHERSCAN_ROOT_URL' at .env");
    process.exit(-1);
}

function combineUrl(url: string, additionalPath: string): string {
    return new URL(additionalPath, url).toString();
}

(async () => {
    const CONFIRMATIONS = 10;

    const monitorStateStore: IMonitorStateStore = await Sqlite3MonitorStateStore.open(MONITOR_STATE_STORE_PATH);
    const monitorStateStoreKeys = {
        ethereum: `ethereum_${CHAIN_ID}`,
        nineChronicles: "9c",
    };

    const slackWebClient = new WebClient(SLACK_WEB_TOKEN);

    const headlessGraphQLCLient = new HeadlessGraphQLClient(GRAPHQL_API_ENDPOINT);
    const ncgTransfer: INCGTransfer = new NCGTransfer(headlessGraphQLCLient, BRIDGE_9C_ADDRESS);
    const hdWalletProvider = new HDWalletProvider({
        mnemonic: HD_WALLET_MNEMONIC,
        addressIndex: HD_WALLET_MNEMONIC_ADDRESS_NUMBER,
        providerOrUrl: HD_WALLET_PROVIDER_URL,
        numberOfAddresses: HD_WALLET_MNEMONIC_ADDRESS_NUMBER + 1,
        chainId: CHAIN_ID,
    });
    const wNCGToken: ContractDescription = {
        abi: wNCGTokenAbi,
        address: WNCG_CONTRACT_ADDRESS,
    };
    const web3 = new Web3(hdWalletProvider);

    const monitor = new EthereumBurnEventMonitor(web3, wNCGToken, await monitorStateStore.load(monitorStateStoreKeys.ethereum), CONFIRMATIONS);
    const unsubscribe = monitor.subscribe(async eventLog => {
        const burnEventResult = eventLog.returnValues as BurnEventResult;
        const txId = await ncgTransfer.transfer(burnEventResult._sender, burnEventResult.amount, null);
        await monitorStateStore.store(monitorStateStoreKeys.ethereum, { blockHash: eventLog.blockHash, txId: eventLog.transactionHash });
        await slackWebClient.chat.postMessage({
            channel: "#nine-chronicles-bridge-bot",
            text: "wNCG → NCG event occurred.",
            attachments: [
                {
                    author_name: 'Bridge Event',
                    color: "#42f5aa",
                    fields: [
                        {
                            title: "9c network transaction",
                            value: combineUrl(EXPLORER_ROOT_URL, `/transaction/?${txId}`),
                        },
                        {
                            title: "Ethereum network transaction",
                            value: combineUrl(ETHERSCAN_ROOT_URL, `/tx/${eventLog.transactionHash}`),
                        },
                        {
                            title: "sender (Ethereum)",
                            value: burnEventResult._sender,
                        },
                        {
                            title: "recipient (NineChronicles)",
                            value: burnEventResult._to,
                        },
                        {
                            title: "amount",
                            value: burnEventResult.amount
                        }
                    ],
                    fallback: `wNCG ${burnEventResult._sender} → NCG ${burnEventResult._to}`
                }
            ]
        });
        console.log("Transferred", txId);
    });

    const headlessHttpClient: IHeadlessHTTPClient = new HeadlessHTTPClient(HTTP_ROOT_API_ENDPOINT);
    await headlessHttpClient.setPrivateKey(BRIDGE_9C_PRIVATE_KEY);

    const minter: IWrappedNCGMinter = new WrappedNCGMinter(web3, wNCGToken, hdWalletProvider.getAddress());
    const nineChroniclesMonitor = new NineChroniclesTransferredEventMonitor(await monitorStateStore.load(monitorStateStoreKeys.nineChronicles), 50, headlessGraphQLCLient, BRIDGE_9C_ADDRESS);
    // chain id, 1, means mainnet. See EIP-155, https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md#specification.
    // It should be not able to run in mainnet because it is for test.
    if (DEBUG === 'TRUE' && CHAIN_ID !== 1) {
        nineChroniclesMonitor.subscribe(async event => {
            if (event.memo === null || !web3.utils.isAddress(event.memo)) {
                const txId = await ncgTransfer.transfer(event.sender, event.amount, "I'm bridge and you should transfer with memo having ethereum address to receive.");
                console.log("Valid memo doesn't exist so refund NCG. The transaction's id is", txId);
                return;
            }

            const mintTxReceipt = await minter.mint(event.memo, parseFloat(event.amount));
            console.log("Receipt", mintTxReceipt.transactionHash);
            await monitorStateStore.store(monitorStateStoreKeys.nineChronicles, { blockHash: event.blockHash, txId: event.txId });
            await slackWebClient.chat.postMessage({
                channel: "#nine-chronicles-bridge-bot",
                text: "NCG → wNCG event occurred.",
                attachments: [
                    {
                        author_name: 'Bridge Event',
                        color: "#42f5aa",
                        fields: [
                            {
                                title: "9c network transaction",
                                value: combineUrl(EXPLORER_ROOT_URL, `/transaction/?${event.txId}`),
                            },
                            {
                                title: "Ethereum network transaction",
                                value: combineUrl(ETHERSCAN_ROOT_URL, `/tx/${mintTxReceipt.transactionHash}`),
                            },
                            {
                                title: "sender (NineChronicles)",
                                value: event.sender,
                            },
                            {
                                title: "recipient (Ethereum)",
                                value: event.memo,
                            },
                            {
                                title: "amount",
                                value: event.amount
                            }
                        ],
                        fallback: `NCG ${event.sender} → wNCG ${event.memo}`
                    }
                ]
            });
        });
    }

    monitor.run();
    nineChroniclesMonitor.run();
})();
