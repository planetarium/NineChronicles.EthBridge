import { ethers, UnsignedTransaction } from "ethers";
import { KMS } from "aws-sdk";
// @ts-ignore
import * as asn1 from "asn1.js";
import BN from "bn.js";

/* this asn1.js library has some funky things going on */
/* eslint-disable func-names */

const EcdsaSigAsnParse: {
    decode: (asnStringBuffer: Buffer, format: "der") => { r: BN; s: BN };
} = asn1.define("EcdsaSig", function (this: any) {
    // parsing this according to https://tools.ietf.org/html/rfc3279#section-2.2.3
    this.seq().obj(this.key("r").int(), this.key("s").int());
});
const EcdsaPubKey = asn1.define("EcdsaPubKey", function (this: any) {
    // parsing this according to https://tools.ietf.org/html/rfc5480#section-2
    this.seq().obj(
        this.key("algo")
            .seq()
            .obj(this.key("a").objid(), this.key("b").objid()),
        this.key("pubKey").bitstr()
    );
});
/* eslint-enable func-names */

export async function sign(
    digest: Buffer,
    kmsCredentials: AwsKmsSignerCredentials
) {
    const kms = new KMS(kmsCredentials);
    const params: KMS.SignRequest = {
        // key id or 'Alias/<alias>'
        KeyId: kmsCredentials.keyId,
        Message: digest,
        // 'ECDSA_SHA_256' is the one compatible with ECC_SECG_P256K1.
        SigningAlgorithm: "ECDSA_SHA_256",
        MessageType: "DIGEST",
    };
    const res = await kms.sign(params).promise();
    return res;
}

export async function getPublicKey(kmsCredentials: AwsKmsSignerCredentials) {
    const kms = new KMS(kmsCredentials);
    return kms
        .getPublicKey({
            KeyId: kmsCredentials.keyId,
        })
        .promise();
}

export function getEthereumAddress(publicKey: Buffer): string {
    // The public key is ASN1 encoded in a format according to
    // https://tools.ietf.org/html/rfc5480#section-2
    // I used https://lapo.it/asn1js to figure out how to parse this
    // and defined the schema in the EcdsaPubKey object
    const res = EcdsaPubKey.decode(publicKey, "der");
    let pubKeyBuffer: Buffer = res.pubKey.data;

    // The public key starts with a 0x04 prefix that needs to be removed
    // more info: https://www.oreilly.com/library/view/mastering-ethereum/9781491971932/ch04.html
    pubKeyBuffer = pubKeyBuffer.slice(1, pubKeyBuffer.length);

    const address = ethers.utils.keccak256(pubKeyBuffer); // keccak256 hash of publicKey
    const EthAddr = `0x${address.slice(-40)}`; // take last 20 bytes as ethereum adress
    return EthAddr;
}

export function findEthereumSig(signature: Buffer) {
    const decoded = EcdsaSigAsnParse.decode(signature, "der");
    const { r, s } = decoded;

    const secp256k1N = new BN(
        "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
        16
    ); // max value on the curve
    const secp256k1halfN = secp256k1N.div(new BN(2)); // half of the curve
    // Because of EIP-2 not all elliptic curve signatures are accepted
    // the value of s needs to be SMALLER than half of the curve
    // i.e. we need to flip s if it's greater than half of the curve
    // if s is less than half of the curve, we're on the "good" side of the curve, we can just return
    return { r, s: s.gt(secp256k1halfN) ? secp256k1N.sub(s) : s };
}

export async function requestKmsSignature(
    plaintext: Buffer,
    kmsCredentials: AwsKmsSignerCredentials
) {
    const signature = await sign(plaintext, kmsCredentials);
    if (signature.$response.error || signature.Signature === undefined) {
        throw new Error(
            `AWS KMS call failed with: ${signature.$response.error}`
        );
    }
    return findEthereumSig(signature.Signature as Buffer);
}

function recoverPubKeyFromSig(msg: Buffer, r: BN, s: BN, v: number) {
    return ethers.utils.recoverAddress(`0x${msg.toString("hex")}`, {
        r: `0x${r.toString("hex")}`,
        s: `0x${s.toString("hex")}`,
        v,
    });
}

export function determineCorrectV(
    msg: Buffer,
    r: BN,
    s: BN,
    expectedEthAddr: string
) {
    // This is the wrapper function to find the right v value
    // There are two matching signatues on the elliptic curve
    // we need to find the one that matches to our public key
    // it can be v = 27 or v = 28
    let v = 27;
    let pubKey = recoverPubKeyFromSig(msg, r, s, v);
    if (pubKey.toLowerCase() !== expectedEthAddr.toLowerCase()) {
        // if the pub key for v = 27 does not match
        // it has to be v = 28
        v = 28;
        pubKey = recoverPubKeyFromSig(msg, r, s, v);
    }
    return { pubKey, v };
}

export interface AwsKmsSignerCredentials {
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    region: string;
    keyId: string;
}
export class AwsKmsSigner extends ethers.Signer {
    // @ts-ignore
    kmsCredentials: AwsKmsSignerCredentials;

    // @ts-ignore
    ethereumAddress: string;

    constructor(
        kmsCredentials: AwsKmsSignerCredentials,
        provider?: ethers.providers.Provider
    ) {
        super();
        // @ts-ignore
        ethers.utils.defineReadOnly(this, "provider", provider || null);
        ethers.utils.defineReadOnly(this, "kmsCredentials", kmsCredentials);
    }

    async getAddress(): Promise<string> {
        if (this.ethereumAddress === undefined) {
            const key = await getPublicKey(this.kmsCredentials);
            this.ethereumAddress = ethers.utils.getAddress(
                getEthereumAddress(key.PublicKey as Buffer)
            );
        }
        return Promise.resolve(this.ethereumAddress);
    }

    async _signDigest(digestString: string): Promise<string> {
        const digestBuffer = Buffer.from(ethers.utils.arrayify(digestString));
        const sig = await requestKmsSignature(
            digestBuffer,
            this.kmsCredentials
        );
        const ethAddr = await this.getAddress();
        const { v } = determineCorrectV(digestBuffer, sig.r, sig.s, ethAddr);
        return ethers.utils.joinSignature({
            v,
            r: `0x${sig.r.toString("hex")}`,
            s: `0x${sig.s.toString("hex")}`,
        });
    }

    async signMessage(message: string | ethers.utils.Bytes): Promise<string> {
        return this._signDigest(ethers.utils.hashMessage(message));
    }

    async signTransaction(
        transaction: ethers.utils.Deferrable<ethers.providers.TransactionRequest>
    ): Promise<string> {
        const unsignedTx = await ethers.utils.resolveProperties(transaction);
        const serializedTx = ethers.utils.serializeTransaction(
            <UnsignedTransaction>unsignedTx
        );
        const transactionSignature = await this._signDigest(
            ethers.utils.keccak256(serializedTx)
        );
        return ethers.utils.serializeTransaction(
            <UnsignedTransaction>unsignedTx,
            transactionSignature
        );
    }

    connect(provider: ethers.providers.Provider): AwsKmsSigner {
        return new AwsKmsSigner(this.kmsCredentials, provider);
    }
}
