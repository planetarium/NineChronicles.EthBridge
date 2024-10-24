import Web3 from "web3";
import { init } from "@sentry/node";
import { KmsProvider } from "@planetarium/aws-kms-provider";

import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import { EthereumBurnEventMonitor } from "./monitors/ethereum-burn-event-monitor";
import { NineChroniclesTransferredEventMonitor } from "./monitors/nine-chronicles-transferred-event-monitor";
import { WrappedNCGMinter } from "./wrapped-ncg-minter";
import { wNCGTokenAbi } from "./wrapped-ncg-token";
import { HeadlessGraphQLClient } from "./headless-graphql-client";
import { ContractDescription } from "./types/contract-description";
import { IMonitorStateStore } from "./interfaces/monitor-state-store";
import { Sqlite3MonitorStateStore } from "./sqlite3-monitor-state-store";
import { WebClient } from "@slack/web-api";
import { OpenSearchClient } from "./opensearch-client";
import { Configuration } from "./configuration";
import { NCGTransferredEventObserver } from "./observers/nine-chronicles";
import { EthereumBurnEventObserver } from "./observers/burn-event-observer";
import { KMSNCGSigner } from "./kms-ncg-signer";
import { NCGKMSTransfer } from "./ncg-kms-transfer";
import Decimal from "decimal.js";
import { IExchangeHistoryStore } from "./interfaces/exchange-history-store";
import { Sqlite3ExchangeHistoryStore } from "./sqlite3-exchange-history-store";
import consoleStamp from "console-stamp";
import { AddressBanPolicy } from "./policies/address-ban";
import {
    GasPriceLimitPolicy,
    GasPricePolicies,
    GasPriceTipPolicy,
    IGasPricePolicy,
} from "./policies/gas-price";
import { Integration } from "./integrations";
import { PagerDutyIntegration } from "./integrations/pagerduty";
import { SlackMessageSender } from "./slack-message-sender";
import {
    FixedExchangeFeeRatioPolicy,
    IExchangeFeeRatioPolicy,
} from "./policies/exchange-fee-ratio";
import { SlackChannel } from "./slack-channel";
import { AwsKmsSigner, AwsKmsSignerCredentials } from "./ethers-aws-kms-signer";
import { SafeWrappedNCGMinter } from "./safe-wrapped-ncg-minter";
import { ethers } from "ethers";
import { whitelistAccounts } from "./whitelist/whitelist-accounts";
import { SpreadsheetClient } from "./spreadsheet-client";
import { google } from "googleapis";
import { MultiPlanetary } from "./multi-planetary";

consoleStamp(console);

// The reason to subscribe 'uncaughtException', to leave only a error log,
// is to avoid that the bridge has been killed by unexpected error
// occurred from 'eth-block-tracker' package.
// See also https://github.com/planetarium/NineChronicles.EthBridge/issues/63#issuecomment-926558558.
process.on("uncaughtException", console.error);

(async () => {
    const GRAPHQL_API_ENDPOINT: string = Configuration.get(
        "GRAPHQL_API_ENDPOINT"
    );
    const NCG_MINTER: string = Configuration.get("NCG_MINTER");
    const KMS_PROVIDER_URL: string = Configuration.get("KMS_PROVIDER_URL");
    const KMS_PROVIDER_SUB_URL: string = Configuration.get(
        "KMS_PROVIDER_SUB_URL"
    );
    const KMS_PROVIDER_KEY_ID: string = Configuration.get(
        "KMS_PROVIDER_KEY_ID"
    );
    const KMS_PROVIDER_REGION: string = Configuration.get(
        "KMS_PROVIDER_REGION"
    );
    const KMS_PROVIDER_AWS_ACCESSKEY: string = Configuration.get(
        "KMS_PROVIDER_AWS_ACCESSKEY"
    );
    const KMS_PROVIDER_AWS_SECRETKEY: string = Configuration.get(
        "KMS_PROVIDER_AWS_SECRETKEY"
    );
    const KMS_PROVIDER_PUBLIC_KEY: string = Configuration.get(
        "KMS_PROVIDER_PUBLIC_KEY"
    );
    const WNCG_CONTRACT_ADDRESS: string = Configuration.get(
        "WNCG_CONTRACT_ADDRESS"
    );
    const MONITOR_STATE_STORE_PATH: string = Configuration.get(
        "MONITOR_STATE_STORE_PATH"
    );
    const EXCHANGE_HISTORY_STORE_PATH: string = Configuration.get(
        "EXCHANGE_HISTORY_STORE_PATH"
    );
    const MINIMUM_NCG: number = Configuration.get("MINIMUM_NCG", true, "float");
    const MAXIMUM_NCG: number = Configuration.get("MAXIMUM_NCG", true, "float");
    const MAXIMUM_WHITELIST_NCG: number = Configuration.get(
        "MAXIMUM_WHITELIST_NCG",
        true,
        "float"
    );
    const BASE_FEE_CRITERION: number = Configuration.get(
        "BASE_FEE_CRITERION",
        true,
        "float"
    );
    const BASE_FEE: number = Configuration.get("BASE_FEE", true, "float");
    const FEE_RANGE_DIVIDER_AMOUNT: number = Configuration.get(
        "FEE_RANGE_DIVIDER_AMOUNT",
        true,
        "float"
    );

    const FEE_RANGE1_RATIO: number = Configuration.get(
        "FEE_RANGE1_RATIO",
        true,
        "float"
    );
    const FEE_RANGE2_RATIO: number = Configuration.get(
        "FEE_RANGE2_RATIO",
        true,
        "float"
    );

    const SLACK_WEB_TOKEN: string = Configuration.get("SLACK_WEB_TOKEN");
    const FAILURE_SUBSCRIBERS: string = Configuration.get(
        "FAILURE_SUBSCRIBERS"
    );
    const OPENSEARCH_ENDPOINT: string = Configuration.get(
        "OPENSEARCH_ENDPOINT"
    );
    const OPENSEARCH_AUTH: string = Configuration.get("OPENSEARCH_AUTH");
    const OPENSEARCH_INDEX: string =
        Configuration.get("OPENSEARCH_INDEX", false) || "9c-eth-bridge";
    const SLACK_CHANNEL_NAME: string =
        Configuration.get("SLACK_CHANNEL_NAME", false) ||
        "#nine-chronicles-bridge-bot";
    const EXPLORER_ROOT_URL: string = Configuration.get("EXPLORER_ROOT_URL");
    const NCSCAN_URL: string | undefined = Configuration.get(
        "NCSCAN_URL",
        false
    );
    const USE_NCSCAN_URL: boolean = Configuration.get(
        "USE_NCSCAN_URL",
        false,
        "boolean"
    );
    const ETHERSCAN_ROOT_URL: string = Configuration.get("ETHERSCAN_ROOT_URL");
    const SENTRY_DSN: string | undefined = Configuration.get(
        "SENTRY_DSN",
        false
    );
    if (SENTRY_DSN !== undefined) {
        init({
            dsn: SENTRY_DSN,
        });
    }

    // Environment Variables for using Google Spread Sheet API
    const SLACK_URL: string = Configuration.get("SLACK_URL");

    const GOOGLE_SPREADSHEET_URL: string = Configuration.get(
        "GOOGLE_SPREADSHEET_URL"
    );
    const GOOGLE_SPREADSHEET_ID: string = Configuration.get(
        "GOOGLE_SPREADSHEET_ID"
    );
    const GOOGLE_CLIENT_EMAIL: string = Configuration.get(
        "GOOGLE_CLIENT_EMAIL"
    );
    const GOOGLE_CLIENT_PRIVATE_KEY: string = Configuration.get(
        "GOOGLE_CLIENT_PRIVATE_KEY"
    );
    const USE_GOOGLE_SPREAD_SHEET: boolean = Configuration.get(
        "USE_GOOGLE_SPREAD_SHEET",
        false,
        "boolean"
    );
    const SHEET_MINT: string = Configuration.get("SHEET_MINT");
    const SHEET_BURN: string = Configuration.get("SHEET_BURN");

    if (BASE_FEE >= BASE_FEE_CRITERION) {
        throw Error(
            `BASE_FEE(value: ${BASE_FEE}) should be less than BASE_FEE_CRITERION(value: ${BASE_FEE_CRITERION})`
        );
    }

    if (BASE_FEE_CRITERION > FEE_RANGE_DIVIDER_AMOUNT) {
        throw Error(
            `BASE_FEE_CRITERION(value: ${BASE_FEE_CRITERION}) should be less than or Equal FEE_RANGE_DIVIDER_AMOUNT(value: ${FEE_RANGE_DIVIDER_AMOUNT})`
        );
    }

    if (FEE_RANGE_DIVIDER_AMOUNT > MAXIMUM_NCG) {
        throw Error(
            `FEE_RANGE_DIVIDER_AMOUNT(value: ${FEE_RANGE_DIVIDER_AMOUNT}) should be less than or Equal MAXIMUM_NCG(value: ${MAXIMUM_NCG})`
        );
    }

    const ncgExchangeFeeRatioPolicy: IExchangeFeeRatioPolicy =
        new FixedExchangeFeeRatioPolicy(
            new Decimal(MAXIMUM_NCG),
            new Decimal(FEE_RANGE_DIVIDER_AMOUNT),
            {
                criterion: new Decimal(BASE_FEE_CRITERION),
                fee: new Decimal(BASE_FEE),
            },
            {
                range1: new Decimal(FEE_RANGE1_RATIO),
                range2: new Decimal(FEE_RANGE2_RATIO),
            }
        );

    const authorize = new google.auth.JWT(
        GOOGLE_CLIENT_EMAIL,
        undefined,
        GOOGLE_CLIENT_PRIVATE_KEY,
        [GOOGLE_SPREADSHEET_URL]
    );
    const googleSheet = google.sheets({
        version: "v4",
        auth: authorize,
    });

    const spreadsheetClient = new SpreadsheetClient(
        googleSheet,
        GOOGLE_SPREADSHEET_ID,
        USE_GOOGLE_SPREAD_SHEET,
        SLACK_URL,
        {
            mint: SHEET_MINT,
            burn: SHEET_BURN,
        },
        ncgExchangeFeeRatioPolicy
    );

    const PRIORITY_FEE: number = Configuration.get(
        "PRIORITY_FEE",
        true,
        "float"
    );

    const GAS_TIP_RATIO_STRING: string = Configuration.get(
        "GAS_TIP_RATIO",
        true,
        "string"
    );
    const GAS_TIP_RATIO = new Decimal(GAS_TIP_RATIO_STRING);

    const MAX_GAS_PRICE_STRING: string = Configuration.get(
        "MAX_GAS_PRICE",
        true,
        "string"
    );
    const MAX_GAS_PRICE = new Decimal(MAX_GAS_PRICE_STRING);

    const PAGERDUTY_ROUTING_KEY: string = Configuration.get(
        "PAGERDUTY_ROUTING_KEY",
        true,
        "string"
    );

    const STAGE_HEADLESSES: string[] =
        Configuration.get("STAGE_HEADLESSES").split(",");

    const USE_SAFE_WRAPPED_NCG_MINTER: boolean = Configuration.get(
        "USE_SAFE_WRAPPED_NCG_MINTER",
        false,
        "boolean"
    );
    const SAFE_OWNER_CREDENTIALS: AwsKmsSignerCredentials[] | null =
        USE_SAFE_WRAPPED_NCG_MINTER
            ? [1, 2, 3].map((value) => {
                  return {
                      region: Configuration.get(
                          `SAFE_OWNER_${value}_AWS_REGION`,
                          true,
                          "string"
                      ),
                      accessKeyId: Configuration.get(
                          `SAFE_OWNER_${value}_AWS_ACCESS_KEY_ID`,
                          true,
                          "string"
                      ),
                      secretAccessKey: Configuration.get(
                          `SAFE_OWNER_${value}_AWS_SECRET_ACCESS_KEY`,
                          true,
                          "string"
                      ),
                      keyId: Configuration.get(
                          `SAFE_OWNER_${value}_AWS_KEY_ID`,
                          true,
                          "string"
                      ),
                  };
              })
            : null;
    const SAFE_TX_SERVICE_URL: string | undefined = Configuration.get(
        "SAFE_TX_SERVICE_URL",
        USE_SAFE_WRAPPED_NCG_MINTER,
        "string"
    );
    const SAFE_ADDRESS: string | undefined = Configuration.get(
        "SAFE_ADDRESS",
        USE_SAFE_WRAPPED_NCG_MINTER,
        "string"
    );

    const PLANET_ODIN_ID: string | undefined = Configuration.get(
        "PLANET_ODIN_ID",
        true,
        "string"
    );
    const PLANET_HEIMDALL_ID: string | undefined = Configuration.get(
        "PLANET_HEIMDALL_ID",
        true,
        "string"
    );
    const ODIN_TO_HEIMDALL_VALUT_ADDRESS: string | undefined =
        Configuration.get("ODIN_TO_HEIMDALL_VALUT_ADDRESS", true, "string");

    const CONFIRMATIONS = 10;

    const monitorStateStore: IMonitorStateStore =
        await Sqlite3MonitorStateStore.open(MONITOR_STATE_STORE_PATH);
    const exchangeHistoryStore: IExchangeHistoryStore =
        await Sqlite3ExchangeHistoryStore.open(EXCHANGE_HISTORY_STORE_PATH);
    const slackWebClient = new WebClient(SLACK_WEB_TOKEN);
    const opensearchClient = new OpenSearchClient(
        OPENSEARCH_ENDPOINT,
        OPENSEARCH_AUTH,
        OPENSEARCH_INDEX
    );

    const GRAPHQL_REQUEST_RETRY = 5;
    const JWT_SECRET_KEY = Configuration.get("JWT_SECRET_KEY");
    const headlessGraphQLCLient = new HeadlessGraphQLClient(
        GRAPHQL_API_ENDPOINT,
        GRAPHQL_REQUEST_RETRY,
        JWT_SECRET_KEY
    );
    const stageGraphQLClients = STAGE_HEADLESSES.map(
        (endpoint) =>
            new HeadlessGraphQLClient(
                endpoint,
                GRAPHQL_REQUEST_RETRY,
                JWT_SECRET_KEY
            )
    );
    const integration: Integration = new PagerDutyIntegration(
        PAGERDUTY_ROUTING_KEY
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

    const wNCGToken: ContractDescription = {
        abi: wNCGTokenAbi,
        address: WNCG_CONTRACT_ADDRESS,
    };

    if (!web3.utils.isAddress(NCG_MINTER)) {
        throw Error("NCG_MINTER is invalid - it is not valid address format.");
    }

    const kmsAddresses = await kmsProvider.getAccounts();
    if (kmsAddresses.length != 1) {
        throw Error("NineChronicles.EthBridge is supported only one address.");
    }
    const kmsAddress = kmsAddresses[0];
    console.log(kmsAddress);
    const gasPriceLimitPolicy: IGasPricePolicy = new GasPriceLimitPolicy(
        MAX_GAS_PRICE
    );
    const gasPriceTipPolicy: IGasPricePolicy = new GasPriceTipPolicy(
        GAS_TIP_RATIO
    );
    const gasPricePolicy: IGasPricePolicy = new GasPricePolicies([
        gasPriceTipPolicy,
        gasPriceLimitPolicy,
    ]);

    const providerMain = new ethers.providers.JsonRpcProvider(KMS_PROVIDER_URL);
    const providerSub = new ethers.providers.JsonRpcProvider(
        KMS_PROVIDER_SUB_URL
    );

    const provider = new ethers.providers.FallbackProvider(
        [
            { provider: providerMain, priority: 1, weight: 2 },
            { provider: providerSub, priority: 2, weight: 1 },
        ],
        1
    );

    const FEE_COLLECTOR_ADDRESS: string = Configuration.get(
        "FEE_COLLECTOR_ADDRESS"
    );
    if (!web3.utils.isAddress(FEE_COLLECTOR_ADDRESS)) {
        throw Error(
            "FEE_COLLECTOR_ADDRESS is invalid - it is not valid address format."
        );
    }

    async function makeSafeWrappedNCGMinter(): Promise<SafeWrappedNCGMinter> {
        if (
            !USE_SAFE_WRAPPED_NCG_MINTER ||
            !SAFE_TX_SERVICE_URL ||
            !SAFE_OWNER_CREDENTIALS ||
            !SAFE_ADDRESS
        ) {
            throw new Error("Unsufficient environment variables were given.");
        }

        const [owner1Signer, owner2Signer, owner3Signer] =
            SAFE_OWNER_CREDENTIALS.map(
                (credentials) => new AwsKmsSigner(credentials, provider)
            );

        return await SafeWrappedNCGMinter.create(
            SAFE_TX_SERVICE_URL,
            SAFE_ADDRESS,
            WNCG_CONTRACT_ADDRESS,
            owner1Signer,
            owner2Signer,
            owner3Signer,
            provider,
            gasPricePolicy
        );
    }

    // Todo: Apply Multi-provider at WrappedNCGMinter
    const minter: IWrappedNCGMinter = USE_SAFE_WRAPPED_NCG_MINTER
        ? await makeSafeWrappedNCGMinter()
        : new WrappedNCGMinter(
              web3,
              wNCGToken,
              kmsAddress,
              gasPricePolicy,
              new Decimal(PRIORITY_FEE)
          );
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
        throw Error(
            "KMS_PROVIDER_PUBLIC_KEY variable seems invalid because it doesn't match to address from KMS."
        );
    }

    const ncgKmsTransfer = new NCGKMSTransfer(
        [headlessGraphQLCLient, ...stageGraphQLClients],
        kmsAddress,
        KMS_PROVIDER_PUBLIC_KEY,
        [NCG_MINTER],
        signer
    );

    // Nine Coparations' cold wallet addresses.
    const addressBanPolicy = new AddressBanPolicy([
        "0xa1ef9701F151244F9aA7131639990c4664d2aEeF",
        "0xf2fAe7aAF4c8AAC267EAB6962Fc294bc876d7b08",
        "0x4b56280B84a7DC0B1Da1CdE43Aa109a33354Da1f",
        "0xb3a2025bEbC87E2fF9DfD065F8e622b1583eDF19",
        "0x0bbBd789280AF719Ee886cb3A0430F63D04bDc2b",
        "0x7cA620bAc4b96dA636BD4Cb2141A42b55C5f6Fdd",
        "0xebCa4032529221a9BCd3fF3a17C26e7d4f829695",
        "0x310518163256A9642364FDadb0eB2b218cfa86c6",
        "0xEc20402FD4426CDeb233a7F04B6c42af9f3bb5B5",
        "0x47D082a115c63E7b58B1532d20E631538eaFADde",
        "0xB3bCa3b3c6069EF5Bdd6384bAD98F11378Dc360E",
        "0xa86E321048C397C0f7f23C65B1EE902AFE24644e",
    ]);

    const slackChannel = new SlackChannel(slackWebClient, SLACK_CHANNEL_NAME);
    const slackMessageSender = new SlackMessageSender(slackChannel);
    const planetIds = {
        odin: PLANET_ODIN_ID,
        heimdall: PLANET_HEIMDALL_ID,
    };
    const planetVaultAddress = {
        heimdall: ODIN_TO_HEIMDALL_VALUT_ADDRESS,
    };
    const multiPlanetary = new MultiPlanetary(planetIds, planetVaultAddress);

    const ethereumBurnEventObserver = new EthereumBurnEventObserver(
        ncgKmsTransfer,
        slackMessageSender,
        opensearchClient,
        spreadsheetClient,
        monitorStateStore,
        exchangeHistoryStore,
        EXPLORER_ROOT_URL,
        NCSCAN_URL,
        USE_NCSCAN_URL,
        ETHERSCAN_ROOT_URL,
        integration,
        multiPlanetary,
        FAILURE_SUBSCRIBERS
    );
    const ethereumBurnEventMonitor = new EthereumBurnEventMonitor(
        provider,
        wNCGToken,
        await monitorStateStore.load("ethereum"),
        CONFIRMATIONS
    );
    ethereumBurnEventMonitor.attach(ethereumBurnEventObserver);

    const ncgTransferredEventObserver = new NCGTransferredEventObserver(
        ncgKmsTransfer,
        minter,
        slackMessageSender,
        opensearchClient,
        spreadsheetClient,
        monitorStateStore,
        exchangeHistoryStore,
        EXPLORER_ROOT_URL,
        NCSCAN_URL,
        USE_NCSCAN_URL,
        ETHERSCAN_ROOT_URL,
        ncgExchangeFeeRatioPolicy,
        {
            maximum: MAXIMUM_NCG,
            whitelistMaximum: MAXIMUM_WHITELIST_NCG,
            minimum: MINIMUM_NCG,
        },
        addressBanPolicy,
        integration,
        FAILURE_SUBSCRIBERS,
        whitelistAccounts,
        FEE_COLLECTOR_ADDRESS
    );
    const nineChroniclesMonitor = new NineChroniclesTransferredEventMonitor(
        await monitorStateStore.load("nineChronicles"),
        headlessGraphQLCLient,
        kmsAddress
    );
    nineChroniclesMonitor.attach(ncgTransferredEventObserver);

    ethereumBurnEventMonitor.run();
    nineChroniclesMonitor.run();
})().catch((error) => {
    console.error(error);
    process.exit(-1);
});
