import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { NCGKMSTransfer } from "../../src/ncg-kms-transfer";
import { Configuration } from "../../src/configuration";
import { HeadlessGraphQLClient } from "../../src/headless-graphql-client";
import { KMSNCGSigner } from "../../src/kms-ncg-signer";

describe(NCGKMSTransfer.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
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
    const mockPublicKey = "022fe4852e1584fa7a74b06c40dd73b54d9b931f061bb79626943d8c5e3b72522f";
    const mockNcgMinterAddress = "0x0000000000000000000000000000000000000000";
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
    const headlessGraphQLCLient = new HeadlessGraphQLClient("http://localhost:23061/graphql");
    const ncgKmsTransfer = new NCGKMSTransfer(
        headlessGraphQLCLient,
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
