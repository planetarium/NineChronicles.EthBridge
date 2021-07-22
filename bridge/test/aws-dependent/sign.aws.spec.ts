import { NCGTransfer } from "../../src/ncg-transfer";
import { IHeadlessGraphQLClient } from "../../src/interfaces/headless-graphql-client";
import { KmsSigner } from "aws-kms-provider";
import { Configuration } from "../../src/configuration";
import { ec } from "elliptic";

describe(NCGTransfer.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
        getBlockHash: jest.fn(),
        getBlockIndex: jest.fn(),
        getNCGTransferredEvents: jest.fn(),
        getNextTxNonce: jest.fn((address) => Promise.resolve(0)),
        getTipIndex: jest.fn(),
        transfer: jest.fn(),
        attachSignature: jest.fn(),
        createUnsignedTx: jest.fn(
            (plainValue: string, publicKey: string) =>
                new Promise<string>((resolve) => {
                    const base64String =
                        "ZDE6YWxlMTpnMzI6RYIlDQ2jOwZ3moR10oPV3SEMaDubmZ100D+\
                        sT1j6a84xOm5pMTgyMTdlMTpwNjU6BB45/DkQEyh7EMJWUqxw9Uj8\
                        AsTZjQPDIVycS4cf1NFh9DWkjf/hp6r0+oLvq2Pz1uQHucL8iAWq+\
                        K4NR5AqBOMxOnMyMDoyF/dXBkzZHKukCo7zhR9KnltJhTE6dHUyNz\
                        oyMDIxLTA2LTIxVDE1OjUyOjM4Ljk3OTM0OVoxOnVsZWU=";

                    resolve(base64String);
                })
        ),
        stageTx: jest.fn(),
    };

    const KMS_PROVIDER_KEY_ID: string = Configuration.get("TEST_KMS_PROVIDER_KEY_ID");
    const KMS_PROVIDER_REGION: string = Configuration.get("TEST_KMS_PROVIDER_REGION");
    const KMS_PROVIDER_AWS_ACCESSKEY: string = Configuration.get("TEST_KMS_PROVIDER_AWS_ACCESSKEY");
    const KMS_PROVIDER_AWS_SECRETKEY: string = Configuration.get("TEST_KMS_PROVIDER_AWS_SECRETKEY");
    const elliptic = new ec('secp256k1');

    const signer = new KmsSigner(
        KMS_PROVIDER_REGION,
        KMS_PROVIDER_KEY_ID,
        {
            accessKeyId: KMS_PROVIDER_AWS_ACCESSKEY,
            secretAccessKey: KMS_PROVIDER_AWS_SECRETKEY
        })

    describe("Key Management System", () => {
        it("should be sign with correct key.", async () => {
            const base64String = await mockHeadlessGraphQlClient.createUnsignedTx("", "");
            const base64Buffer = Buffer.from(base64String, "base64");
            const digest = Buffer.allocUnsafe(32).fill(0);
            base64Buffer.copy(digest);

            const sign = await signer.sign(digest);

            const publicKey = await signer.getPublicKey();
            console.log(publicKey.toString('base64'));

        });
    });
});
