import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { NCGKMSTransfer } from "../../src/ncg-kms-transfer";
import { Configuration } from "../../src/configuration";
import { HeadlessGraphQLClient } from "../../src/headless-graphql-client";
import { KMSNCGSigner } from "../../src/kms-ncg-signer";

describe(NCGKMSTransfer.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
        endpoint: "http://localhost:23061/graphql",
        getBlockHash: jest.fn(),
        getBlockIndex: jest.fn(),
        getNCGTransferredEvents: jest.fn(),
        getNextTxNonce: jest.fn((address) => Promise.resolve(0)),
        getTipIndex: jest.fn(),
        transfer: jest.fn(),
        createUnsignedTx: jest.fn(),
        attachSignature: jest.fn(),
        stageTx: jest.fn(),
    };
    const mockAddress = "0x0000000000000000000000000000000000000000";
    const mockPublicKey =
        "BB/RQoardpERFnzxZs05Tj0Lq2gpyOGJUZ4nn6Oq1XnlkPRq1LN5HQqPdIOgYV73MbaSfW+VwPVpbtf/ViX51OE=";
    const mockNcgMinterAddress = "0x99DF57BF45240C8a87615B0C884007501395d526";
    const KMS_PROVIDER_KEY_ID: string = Configuration.get(
        "TEST_KMS_PROVIDER_KEY_ID"
    );
    const KMS_PROVIDER_REGION: string = Configuration.get(
        "TEST_KMS_PROVIDER_REGION"
    );
    const KMS_PROVIDER_AWS_ACCESSKEY: string = Configuration.get(
        "TEST_KMS_PROVIDER_AWS_ACCESSKEY"
    );
    const KMS_PROVIDER_AWS_SECRETKEY: string = Configuration.get(
        "TEST_KMS_PROVIDER_AWS_SECRETKEY"
    );

    const signer = new KMSNCGSigner(KMS_PROVIDER_REGION, KMS_PROVIDER_KEY_ID, {
        accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
        secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY,
    });
    const headlessGraphQLCLient = new HeadlessGraphQLClient(
        Configuration.get("TEST_GRAPHQL_API_ENDPOINT"),
        5
    );
    const ncgKmsTransfer = new NCGKMSTransfer(
        [headlessGraphQLCLient],
        mockAddress,
        mockPublicKey,
        [mockNcgMinterAddress],
        signer
    );

    describe(NCGKMSTransfer.prototype.transfer, () => {
        it("should transfer", async () => {
            await ncgKmsTransfer.transfer(
                "0x590c887BDac8d957Ca5d3c1770489Cf2aFBd868E",
                "1000",
                "MEMO"
            );
        });
    });
});
