import Web3 from "web3";
import { init } from "@sentry/node";

import { BurnEventResult } from "./types/burn-event-result";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { EthereumBurnEventMonitor } from "./monitors/ethereum-burn-event-monitor";
import { NineChroniclesTransferredEventMonitor } from "./monitors/nine-chronicles-transferred-event-monitor";
import { NCGTransfer } from "./ncg-transfer";
import { WrappedNCGMinter } from "./wrapped-ncg-minter";
import { wNCGTokenAbi } from "./wrapped-ncg-token";
import HDWalletProvider from "@truffle/hdwallet-provider";
import { HeadlessGraphQLClient } from "./headless-graphql-client";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";
import { IHeadlessHTTPClient } from "./interfaces/headless-http-client";
import { HeadlessHTTPClient } from "./headless-http-client";
import { ContractDescription } from "./types/contract-description";
import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Sqlite3MonitorStateStore } from "./sqlite3-monitor-state-store";
import { TransactionLocation } from "./types/transaction-location";
import { WebClient } from "@slack/web-api"
import { URL } from "url";
import { Configuration } from "./configuration";
import { WrappedEvent } from "./messages/wrapped-event";
import { UnwrappedEvent } from "./messages/unwrapped-event";

(async () => {
    const GRAPHQL_API_ENDPOINT: string = Configuration.get("GRAPHQL_API_ENDPOINT");
    const HTTP_ROOT_API_ENDPOINT: string = Configuration.get("HTTP_ROOT_API_ENDPOINT");
    const BRIDGE_9C_ADDRESS: string = Configuration.get("BRIDGE_9C_ADDRESS");
    const BRIDGE_9C_PRIVATE_KEY: string = Configuration.get("BRIDGE_9C_PRIVATE_KEY");
    const CHAIN_ID: number = Configuration.get("CHAIN_ID", true, "integer");
    const HD_WALLET_PROVIDER_URL: string = Configuration.get("HD_WALLET_PROVIDER_URL");
    const HD_WALLET_MNEMONIC: string = Configuration.get("HD_WALLET_MNEMONIC");
    const HD_WALLET_MNEMONIC_ADDRESS_NUMBER: number = Configuration.get("HD_WALLET_MNEMONIC_ADDRESS_NUMBER", true, "integer");
    const WNCG_CONTRACT_ADDRESS: string = Configuration.get("WNCG_CONTRACT_ADDRESS");
    const MONITOR_STATE_STORE_PATH: string = Configuration.get("MONITOR_STATE_STORE_PATH");
    const SLACK_WEB_TOKEN: string = Configuration.get("SLACK_WEB_TOKEN");
    const EXPLORER_ROOT_URL: string = Configuration.get("EXPLORER_ROOT_URL");
    const ETHERSCAN_ROOT_URL: string = Configuration.get("ETHERSCAN_ROOT_URL");
    const DEBUG: boolean = Configuration.get("DEBUG", false, "boolean");
    const SENTRY_DSN: string | undefined = Configuration.get("SENTRY_DSN", false);
    if (SENTRY_DSN !== undefined) {
        init({
            dsn: SENTRY_DSN,
        });
    }

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
    const unsubscribe = monitor.subscribe(async ({ returnValues,  txId, blockHash }) => {
        const { _sender: sender, _to: recipient, amount } = returnValues as BurnEventResult;
        const nineChroniclesTxId = await ncgTransfer.transfer(recipient, amount, null);
        await monitorStateStore.store(monitorStateStoreKeys.ethereum, { blockHash, txId });
        await slackWebClient.chat.postMessage({
            channel: "#nine-chronicles-bridge-bot",
            ...new WrappedEvent(EXPLORER_ROOT_URL, ETHERSCAN_ROOT_URL, sender, recipient, amount, nineChroniclesTxId, "").render()
        });
        console.log("Transferred", txId);
    });

    const headlessHttpClient: IHeadlessHTTPClient = new HeadlessHTTPClient(HTTP_ROOT_API_ENDPOINT);
    await headlessHttpClient.setPrivateKey(BRIDGE_9C_PRIVATE_KEY);

    const minter: IWrappedNCGMinter = new WrappedNCGMinter(web3, wNCGToken, hdWalletProvider.getAddress());
    const nineChroniclesMonitor = new NineChroniclesTransferredEventMonitor(await monitorStateStore.load(monitorStateStoreKeys.nineChronicles), 50, headlessGraphQLCLient, BRIDGE_9C_ADDRESS);
    // chain id, 1, means mainnet. See EIP-155, https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md#specification.
    // It should be not able to run in mainnet because it is for test.
    if (DEBUG && CHAIN_ID !== 1) {
        nineChroniclesMonitor.subscribe(async ({ blockHash, txId, sender, amount, memo: recipient, }) => {
            if (recipient === null || !web3.utils.isAddress(recipient)) {
                const nineChroniclesTxId = await ncgTransfer.transfer(sender, amount, "I'm bridge and you should transfer with memo having ethereum address to receive.");
                console.log("Valid memo doesn't exist so refund NCG. The transaction's id is", nineChroniclesTxId);
                return;
            }

            const { transactionHash } = await minter.mint(recipient, parseFloat(amount));
            console.log("Receipt", transactionHash);
            await monitorStateStore.store(monitorStateStoreKeys.nineChronicles, { blockHash, txId });
            await slackWebClient.chat.postMessage({
                channel: "#nine-chronicles-bridge-bot",
                ...new UnwrappedEvent(EXPLORER_ROOT_URL, ETHERSCAN_ROOT_URL, sender, recipient, amount, txId, transactionHash)
            });
        });
    }

    monitor.run();
    nineChroniclesMonitor.run();
})().catch(error => {
    console.error(error);
    process.exit(-1);
});
