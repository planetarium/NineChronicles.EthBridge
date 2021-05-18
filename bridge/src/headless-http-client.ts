import axios from "axios";
import { IHeadlessHTTPClient } from "./interfaces/headless-http-client";

export class HeadlessHTTPClient implements IHeadlessHTTPClient {
    private readonly _rootApiEndpoint: string;

    constructor(rootApiEndpoint: string) {
        this._rootApiEndpoint = rootApiEndpoint;
    }

    setPrivateKey(privateKey: string): Promise<void> {
        const url = this._rootApiEndpoint + "/set-private-key";
        return axios.post(url, {
            PrivateKeyString: privateKey,
        });
    }
}
