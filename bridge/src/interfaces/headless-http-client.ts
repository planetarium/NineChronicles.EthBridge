import { PrivateKey } from "../types/private-key";

export interface IHeadlessHTTPClient {
    setPrivateKey(privateKey: PrivateKey): Promise<void>;
}
