import { config } from "dotenv";

import Web3 from "web3";
import { BurnEventResult } from "./interfaces/burn-event-result";
import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { EthereumBurnEventMonitor } from "./ethereum-burn-event-monitor";
import { NCGTransfer } from "./ncg-transfer";
import { WrappedNCGMinter } from "./wrapped-ncg-minter";
import { wNCGToken } from "./wrapped-ncg-token";
import HDWalletProvider from "@truffle/hdwallet-provider";
import { HeadlessGraphQLCLient } from "./headless-graphql-client";
import { NineChroniclesTransferEventMonitor } from "./nine-chronicles-transfer-event-monitor";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";

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

const BRIDGE_9C_ADDRESS: string | undefined = process.env.BRIDGE_9C_ADDRESS;
if (BRIDGE_9C_ADDRESS === undefined) {
    console.error("Please set 'BRIDGE_9C_ADDRESS' at .env");
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

(async () => {
    const CONFIRMATIONS = 10;

    const headlessGraphQLCLient = new HeadlessGraphQLCLient(GRAPHQL_API_ENDPOINT);
    const ncgTransfer: INCGTransfer = new NCGTransfer(headlessGraphQLCLient, BRIDGE_9C_ADDRESS);
    const hdWalletProvider = new HDWalletProvider({
        mnemonic: HD_WALLET_MNEMONIC,
        addressIndex: HD_WALLET_MNEMONIC_ADDRESS_NUMBER,
        providerOrUrl: HD_WALLET_PROVIDER_URL,
        numberOfAddresses: HD_WALLET_MNEMONIC_ADDRESS_NUMBER + 1,
        chainId: CHAIN_ID,
    });
    const web3 = new Web3(hdWalletProvider);

    const monitor = new EthereumBurnEventMonitor(web3, wNCGToken, await web3.eth.getBlockNumber(), CONFIRMATIONS);
    const unsubscribe = monitor.subscribe(async eventLog => {
        const burnEventResult = eventLog.returnValues as BurnEventResult;
        const txId = await ncgTransfer.transfer(burnEventResult._sender, BigInt(burnEventResult.amount));
        console.log("Transferred", txId);
    });

    const minter: IWrappedNCGMinter = new WrappedNCGMinter(web3, wNCGToken, hdWalletProvider.getAddress());
    const latestBlockNumber = await headlessGraphQLCLient.getTipIndex();  // TODO: load from persistent storage.
    let latestMintedBlockHash: BlockHash, latestMintedTxId: TxId;
    const nineChroniclesBridgeAddress = "0x0000000000000000000000000000000000000000";  // TODO: determine bridge address.
    const nineChroniclesMonitor = new NineChroniclesTransferEventMonitor(latestBlockNumber, 50, headlessGraphQLCLient, nineChroniclesBridgeAddress);
    // chain id, 1, means mainnet. See EIP-155, https://github.com/ethereum/EIPs/blob/master/EIPS/eip-155.md#specification.
    // It should be not able to run in mainnet because it is for test.
    if (DEBUG === 'TRUE' && CHAIN_ID !== 1) {
        nineChroniclesMonitor.subscribe(async event => {
            console.log("Receipt", await minter.mint(event.sender, parseFloat(event.amount)));
            latestMintedBlockHash = event.blockHash;
            latestMintedTxId = event.txId;
        });
    }

    monitor.run();
    nineChroniclesMonitor.run();
})();
