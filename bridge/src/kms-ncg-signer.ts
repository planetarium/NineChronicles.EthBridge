/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AwsCredential } from "@planetarium/aws-kms-provider";
import {
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import { fromBER, Sequence, Integer } from 'asn1js';
import { bigintToBuf, bufToBigint } from "bigint-conversion";

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

function parseSignature(buf: Buffer): { r: Buffer, s: Buffer } {
    const { result } = fromBER(toArrayBuffer(buf));
    const values = (result as Sequence).valueBlock.value;

    const r = toBuffer((values[0] as Integer).valueBlock.valueHex);
    const s = toBuffer((values[1] as Integer).valueBlock.valueHex);
    return { r, s };
}

function bigintToNodeBuffer(bi: bigint) {
  const buf = bigintToBuf(bi);
  if(buf instanceof Buffer) {
    return buf;
  } else{
    return toBuffer(buf);
  }
}

export class KMSNCGSigner {
  private readonly keyId: string;
  private readonly client: KMSClient;
    constructor(region: string, keyId: string, credential?: AwsCredential, endpoint?: string) {
      this.keyId = keyId;

      this.client = new KMSClient({ region, credentials: credential, endpoint });
    }

    public async sign(digest: Buffer): Promise<Buffer> {
      const asn1Signature = await this._sign(digest);
      const { r, s } = parseSignature(asn1Signature);
      const n = Buffer.from("/////////////////////rqu3OavSKA7v9JejNA2QUE=", "base64");
      const nBigInt = bufToBigint(n);
      const sBigInt = bufToBigint(s);

      const otherSBigInt = nBigInt - sBigInt;
      const otherS = bigintToNodeBuffer(otherSBigInt);
      const sequence = new Sequence();
      // @ts-ignore
      sequence.valueBlock.value.push(new Integer({ isHexOnly: true, valueHex: r }));
      if (sBigInt > otherSBigInt) {
        // @ts-ignore
        sequence.valueBlock.value.push(new Integer({ isHexOnly: true, valueHex: otherS }).convertToDER());
      }
      else {
        // @ts-ignore
        sequence.valueBlock.value.push(new Integer({ isHexOnly: true, valueHex: s }).convertToDER());
      }

      const sequence_buffer = toBuffer(sequence.toBER(false));
      return sequence_buffer;
    }

    private async _sign(digest: Buffer) {
      const command = new SignCommand({
        KeyId: this.keyId,
        Message: digest,
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      });
      const response = await this.client.send(command);

      if (!response.Signature) {
        throw new TypeError("Signature is undefined");
      }

      return Buffer.from(response.Signature);
    }
}
