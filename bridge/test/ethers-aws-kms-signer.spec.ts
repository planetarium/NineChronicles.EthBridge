import { ethers } from "ethers";
import BN from "bn.js";
import { KMSClient } from "@aws-sdk/client-kms";
import {
    AwsKmsSigner,
    getPublicKey,
    sign,
    getEthereumAddress,
    findEthereumSig,
    requestKmsSignature,
    determineCorrectV,
} from "../src/ethers-aws-kms-signer";

const mockKmsSend = jest.fn();
jest.mock("@aws-sdk/client-kms", () => ({
    KMSClient: jest.fn(() => ({ send: mockKmsSend })),
    SignCommand: jest.fn((input) => ({ input, kind: "sign" })),
    GetPublicKeyCommand: jest.fn((input) => ({ input, kind: "public-key" })),
}));

const wallet = new ethers.Wallet("0x" + "11".repeat(32));
const credentials = { region: "test-region", keyId: "test-key" };
const publicKey = Buffer.from(
    "3056301006072a8648ce3d020106052b8104000a034200" +
        wallet._signingKey().publicKey.slice(2),
    "hex"
);
const signatureSchema = require("asn1.js").define(
    "Signature",
    function (this: any) {
        this.seq().obj(this.key("r").int(), this.key("s").int());
    }
);
function encodeSignature(r: string, s: string): Buffer {
    return signatureSchema.encode(
        { r: new BN(r.slice(2), 16), s: new BN(s.slice(2), 16) },
        "der"
    );
}
function makeSigner(provider?: ethers.providers.Provider) {
    return new AwsKmsSigner(credentials, provider);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockKmsSend.mockImplementation(async ({ kind, input }) => {
        if (kind === "public-key") return { PublicKey: publicKey };
        const signature = wallet._signingKey().signDigest(input.Message);
        return { Signature: encodeSignature(signature.r, signature.s) };
    });
});
afterEach(() => jest.restoreAllMocks());

describe("AWS KMS signer", () => {
    it("derives and caches the address from the KMS public key", async () => {
        const signer = makeSigner();
        expect(signer.provider).toBeNull();
        expect(getEthereumAddress(publicKey)).toBe(
            wallet.address.toLowerCase()
        );
        expect(await signer.getAddress()).toBe(wallet.address);
        expect(await signer.getAddress()).toBe(wallet.address);
        expect(mockKmsSend).toHaveBeenCalledTimes(1);
    });
    it("fails when KMS does not return a public key", async () => {
        mockKmsSend.mockResolvedValueOnce({});
        await expect(makeSigner().getAddress()).rejects.toThrow(
            "Failed to get public key"
        );
    });
    it("uses explicit credentials for both KMS operations", async () => {
        const explicit = {
            ...credentials,
            accessKeyId: "test-access",
            secretAccessKey: "test-secret",
        };
        await getPublicKey(explicit);
        await sign(Buffer.alloc(32, 1), explicit);
        expect(KMSClient).toHaveBeenCalledTimes(2);
        expect(KMSClient).toHaveBeenLastCalledWith({
            region: "test-region",
            credentials: {
                accessKeyId: "test-access",
                secretAccessKey: "test-secret",
            },
        });
    });
    it("uses the configured KMS key and digest signing mode", async () => {
        const digest = Buffer.alloc(32, 2);
        await sign(digest, credentials);
        expect(mockKmsSend).toHaveBeenCalledWith({
            kind: "sign",
            input: {
                KeyId: "test-key",
                Message: new Uint8Array(digest),
                SigningAlgorithm: "ECDSA_SHA_256",
                MessageType: "DIGEST",
            },
        });
        expect(KMSClient).toHaveBeenCalledWith({
            region: "test-region",
            credentials: { accessKeyId: "", secretAccessKey: "" },
        });
    });
    it("fails when KMS does not return a signature", async () => {
        mockKmsSend.mockResolvedValueOnce({});
        await expect(
            requestKmsSignature(Buffer.alloc(32), credentials)
        ).rejects.toThrow("Signature is undefined");
    });
    it("normalizes high-s signatures to the Ethereum low-s form", () => {
        const digest = ethers.utils.keccak256("0x1234");
        const sig = wallet._signingKey().signDigest(digest);
        const order = new BN(
            "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
            16
        );
        const low = new BN(sig.s.slice(2), 16);
        const high = order.sub(low);
        const parsed = findEthereumSig(
            encodeSignature(sig.r, "0x" + high.toString(16))
        );
        expect(parsed.s.eq(low)).toBe(true);
        expect(parsed.r.toString(16)).toBe(
            new BN(sig.r.slice(2), 16).toString(16)
        );
    });
    it.each([0, 1])(
        "recovers the expected address for recovery parity %s",
        (parity) => {
            let fixture;
            for (let n = 0; n < 100; n++) {
                const digest = ethers.utils.keccak256(
                    ethers.utils.toUtf8Bytes(`kms-${n}`)
                );
                const sig = wallet._signingKey().signDigest(digest);
                if (sig.recoveryParam === parity) {
                    fixture = { digest, sig };
                    break;
                }
            }
            expect(fixture).toBeDefined();
            const { digest, sig } = fixture!;
            const result = determineCorrectV(
                Buffer.from(digest.slice(2), "hex"),
                new BN(sig.r.slice(2), 16),
                new BN(sig.s.slice(2), 16),
                wallet.address
            );
            expect(result.pubKey).toBe(wallet.address);
            expect(result.v).toBe(27 + parity);
        }
    );
    it("signs messages using the Ethereum message prefix", async () => {
        const signature = await makeSigner().signMessage("bridge test");
        expect(ethers.utils.verifyMessage("bridge test", signature)).toBe(
            wallet.address
        );
    });
    it("connects to a new provider without changing key configuration", async () => {
        const provider = new ethers.providers.JsonRpcProvider(
            "http://unused.invalid",
            1
        );
        const original = makeSigner();
        const connected = original.connect(provider);
        expect(connected).not.toBe(original);
        expect(connected.provider).toBe(provider);
        expect(connected.kmsCredentials).toEqual(credentials);
        expect(await connected.getAddress()).toBe(wallet.address);
    });
    it.each([true, false])(
        "signs a legacy transaction with optional from (%s), preserving the input",
        async (includeFrom) => {
            const transaction = Object.freeze({
                to: wallet.address,
                gasLimit: 21000,
                gasPrice: 42,
                nonce: 9,
                chainId: 1,
                value: 3,
                ...(includeFrom ? { from: wallet.address.toLowerCase() } : {}),
            });
            const encoded = await makeSigner().signTransaction(transaction);
            const parsed = ethers.utils.parseTransaction(encoded);
            expect(parsed.from).toBe(wallet.address);
            expect(parsed.nonce).toBe(9);
            expect(parsed.chainId).toBe(1);
            expect(parsed.gasLimit.toNumber()).toBe(21000);
            expect(parsed.gasPrice!.toNumber()).toBe(42);
            expect(transaction).toHaveProperty("nonce", 9);
            if (includeFrom)
                expect(transaction.from).toBe(wallet.address.toLowerCase());
        }
    );
    it("rejects a mismatching from before requesting a KMS signature", async () => {
        await expect(
            makeSigner().signTransaction({
                from: "0x1111111111111111111111111111111111111111",
                to: wallet.address,
                chainId: 1,
            })
        ).rejects.toThrow("does not match KMS signer");
        expect(
            mockKmsSend.mock.calls.every(
                ([command]) => command.kind === "public-key"
            )
        ).toBe(true);
    });
    it("supports inherited sendTransaction with a populated from, without resubmitting", async () => {
        const provider = new ethers.providers.JsonRpcProvider(
            "http://unused.invalid",
            1
        );
        const submitted: string[] = [];
        jest.spyOn(provider, "send").mockImplementation(
            async (method, params) => {
                if (method === "eth_chainId") return "0x1";
                if (method === "eth_blockNumber") return "0x64";
                if (method === "eth_sendRawTransaction") {
                    submitted.push(params[0]);
                    return ethers.utils.keccak256(params[0]);
                }
                throw new Error(`Unexpected ${method}`);
            }
        );
        const response = await makeSigner(provider).sendTransaction({
            from: wallet.address,
            to: wallet.address,
            chainId: 1,
            type: 0,
            nonce: 7,
            gasLimit: 21000,
            gasPrice: 42,
        });
        expect(submitted).toHaveLength(1);
        const parsed = ethers.utils.parseTransaction(submitted[0]);
        expect(response.hash).toBe(parsed.hash);
        expect(parsed.from).toBe(wallet.address);
        expect(parsed.nonce).toBe(7);
    });
});
