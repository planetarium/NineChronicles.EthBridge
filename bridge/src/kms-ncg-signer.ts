/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AwsCredential } from "@planetarium/aws-kms-provider";
import { KMSClient } from "@aws-sdk/client-kms";
import { fromBER, Sequence, Integer } from "asn1js";
import { bigintToBuf, bufToBigint } from "bigint-conversion";
import { Account, signTransaction } from "@planetarium/sign";
import { createAccount } from "@planetarium/account-aws-kms";

function toArrayBuffer(buffer: Buffer) {
    const ab = new ArrayBuffer(buffer.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buffer.length; ++i) {
        view[i] = buffer[i];
    }
    return ab;
}

function toBuffer(ab: ArrayBuffer) {
    const buf = Buffer.alloc(ab.byteLength);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; ++i) {
        buf[i] = view[i];
    }
    return buf;
}

function parseSignature(buf: Buffer): { r: Buffer; s: Buffer } {
    const { result } = fromBER(toArrayBuffer(buf));
    const values = (result as Sequence).valueBlock.value;

    const r = toBuffer((values[0] as Integer).valueBlock.valueHex);
    const s = toBuffer((values[1] as Integer).valueBlock.valueHex);
    return { r, s };
}

function bigintToNodeBuffer(bi: bigint) {
    const buf = bigintToBuf(bi);
    if (buf instanceof Buffer) {
        return buf;
    } else {
        return toBuffer(buf);
    }
}

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
