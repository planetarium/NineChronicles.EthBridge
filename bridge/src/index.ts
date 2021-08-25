import Web3 from "web3";
import { init } from "@sentry/node";
import { KmsProvider } from "@planetarium/aws-kms-provider";

import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { INCGTransfer } from "./interfaces/ncg-transfer";
import { EthereumBurnEventMonitor } from "./monitors/ethereum-burn-event-monitor";
import { NineChroniclesTransferredEventMonitor } from "./monitors/nine-chronicles-transferred-event-monitor";
import { WrappedNCGMinter } from "./wrapped-ncg-minter";
import { wNCGTokenAbi } from "./wrapped-ncg-token";
import { HeadlessGraphQLClient } from "./headless-graphql-client";
import { ContractDescription } from "./types/contract-description";
import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Sqlite3MonitorStateStore } from "./sqlite3-monitor-state-store";
import { WebClient } from "@slack/web-api"
import { URL } from "url";
import { Configuration } from "./configuration";
import { NCGTransferredEventObserver } from "./observers/nine-chronicles"
import { EthereumBurnEventObserver } from "./observers/burn-event-observer"
import { KMSNCGSigner } from "./kms-ncg-signer";
import { NCGKMSTransfer } from "./ncg-kms-transfer";
import Decimal from "decimal.js";

(async () => {
    const GRAPHQL_API_ENDPOINT: string = Configuration.get("GRAPHQL_API_ENDPOINT");
    const NCG_MINTER: string = Configuration.get("NCG_MINTER");
    const KMS_PROVIDER_URL: string = Configuration.get("KMS_PROVIDER_URL");
    const KMS_PROVIDER_KEY_ID: string = Configuration.get("KMS_PROVIDER_KEY_ID");
    const KMS_PROVIDER_REGION: string = Configuration.get("KMS_PROVIDER_REGION");
    const KMS_PROVIDER_AWS_ACCESSKEY: string = Configuration.get("KMS_PROVIDER_AWS_ACCESSKEY");
    const KMS_PROVIDER_AWS_SECRETKEY: string = Configuration.get("KMS_PROVIDER_AWS_SECRETKEY");
    const KMS_PROVIDER_PUBLIC_KEY: string = Configuration.get("KMS_PROVIDER_PUBLIC_KEY");
    const WNCG_CONTRACT_ADDRESS: string = Configuration.get("WNCG_CONTRACT_ADDRESS");
    const MONITOR_STATE_STORE_PATH: string = Configuration.get("MONITOR_STATE_STORE_PATH");
    const SLACK_WEB_TOKEN: string = Configuration.get("SLACK_WEB_TOKEN");
    const EXPLORER_ROOT_URL: string = Configuration.get("EXPLORER_ROOT_URL");
    const ETHERSCAN_ROOT_URL: string = Configuration.get("ETHERSCAN_ROOT_URL");
    const SENTRY_DSN: string | undefined = Configuration.get("SENTRY_DSN", false);
    if (SENTRY_DSN !== undefined) {
        init({
            dsn: SENTRY_DSN,
        });
    }

    const CONFIRMATIONS = 10;

    const monitorStateStore: IMonitorStateStore = await Sqlite3MonitorStateStore.open(MONITOR_STATE_STORE_PATH);
    const slackWebClient = new WebClient(SLACK_WEB_TOKEN);

    const headlessGraphQLCLient = new HeadlessGraphQLClient(GRAPHQL_API_ENDPOINT);
    const kmsProvider = new KmsProvider(KMS_PROVIDER_URL, {
      region: KMS_PROVIDER_REGION,
      keyIds: [KMS_PROVIDER_KEY_ID],
      credential: {
        accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
        secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY
      }
    });
    const web3 = new Web3(kmsProvider);
    const wNCGToken: ContractDescription = {
        abi: wNCGTokenAbi,
        address: WNCG_CONTRACT_ADDRESS,
    };

    if (!web3.utils.isAddress(NCG_MINTER)) {
        throw Error("NCG_MINTER variable seems invalid because it is not valid address format.");
    }

    const kmsAddresses = await kmsProvider.getAccounts();
    if(kmsAddresses.length != 1) {
      throw Error("NineChronicles.EthBridge is supported only one address.");
    }
    const kmsAddress = kmsAddresses[0];
    console.log(kmsAddress);
    const minter: IWrappedNCGMinter = new WrappedNCGMinter(web3, wNCGToken, kmsAddress);
    const signer = new KMSNCGSigner(KMS_PROVIDER_REGION, KMS_PROVIDER_KEY_ID, {
        accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
        secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY,
    });
    const derivedAddress = "0x" + web3.utils.keccak256("0x" + Buffer.from(KMS_PROVIDER_PUBLIC_KEY, "base64").toString("hex").slice(2)).slice(26);
    if (kmsAddress.toLowerCase() !== derivedAddress.toLowerCase()) {
        throw Error("KMS_PROVIDER_PUBLIC_KEY variable seems invalid because it doesn't match to address from KMS.");
    }

    const ncgKmsTransfer = new NCGKMSTransfer(
        headlessGraphQLCLient,
        kmsAddress,
        KMS_PROVIDER_PUBLIC_KEY,
        [NCG_MINTER],
        signer
    );

    const ethereumBurnEventObserver = new EthereumBurnEventObserver(ncgKmsTransfer, slackWebClient, monitorStateStore, EXPLORER_ROOT_URL, ETHERSCAN_ROOT_URL);
    const ethereumBurnEventMonitor = new EthereumBurnEventMonitor(web3, wNCGToken, await monitorStateStore.load("ethereum"), CONFIRMATIONS);
    ethereumBurnEventMonitor.attach(ethereumBurnEventObserver);

    const ncgExchangeFeeRatio = new Decimal(0.01);  // 1%
    const ncgTransferredEventObserver = new NCGTransferredEventObserver(ncgKmsTransfer, minter, slackWebClient, monitorStateStore, EXPLORER_ROOT_URL, ETHERSCAN_ROOT_URL, ncgExchangeFeeRatio);
    const nineChroniclesMonitor = new NineChroniclesTransferredEventMonitor(await monitorStateStore.load("nineChronicles"), headlessGraphQLCLient, kmsAddress);
    nineChroniclesMonitor.attach(ncgTransferredEventObserver);

    ethereumBurnEventMonitor.run();
    nineChroniclesMonitor.run();
})().catch(error => {
    console.error(error);
    process.exit(-1);
});
