/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AwsCredential } from "@planetarium/aws-kms-provider";
import { KMSClient } from "@aws-sdk/client-kms";
import { Account, signTransaction } from "@planetarium/sign";
import { createAccount } from "@planetarium/account-aws-kms";

export class KMSNCGSigner {
    private readonly account: Account;
    constructor(
        region: string,
        keyId: string,
        credential?: AwsCredential,
        endpoint?: string
    ) {
        this.account = createAccount(
            new KMSClient({
                region,
                credentials: credential,
                endpoint,
            }),
            keyId
        );
    }

    public async sign(tx: string): Promise<string> {
        return signTransaction(tx, this.account);
    }
}
