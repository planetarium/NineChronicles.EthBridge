import { NCGKMSTransfer } from "../../src/ncg-kms-transfer";
import { Configuration } from "../../src/configuration";
import { HeadlessGraphQLClient } from "../../src/headless-graphql-client";
import { KMSNCGSigner } from "../../src/kms-ncg-signer";

describe(NCGKMSTransfer.name, () => {
    const KMS_PROVIDER_ADDRESS: string = Configuration.get(
        "TEST_KMS_PROVIDER_ADDRESS"
    );
    const KMS_PROVIDER_PUBLIC_KEY: string = Configuration.get(
        "TEST_KMS_PROVIDER_PUBLIC_KEY"
    );
    const NCG_MINTER: string = Configuration.get("TEST_NCG_MINTER");
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
        KMS_PROVIDER_ADDRESS,
        KMS_PROVIDER_PUBLIC_KEY,
        [NCG_MINTER],
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
