import axios from "axios";
import { URL } from "url";
import { IHeadlessHTTPClient } from "./interfaces/headless-http-client";

export class HeadlessHTTPClient implements IHeadlessHTTPClient {
    private readonly _rootApiEndpoint: URL;

    constructor(rootApiEndpoint: string) {
        this._rootApiEndpoint = new URL(rootApiEndpoint);
    }

    setPrivateKey(privateKey: string): Promise<void> {
        const url = new URL("/set-private-key", this._rootApiEndpoint);
        return axios.post(url.toString(), {
            PrivateKeyString: privateKey,
        });
    }
}
