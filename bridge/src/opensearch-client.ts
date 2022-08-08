import axios from "axios";
import { URL } from "url";

export class OpenSearchClient {
    private readonly _opensearchEndpoint: string;
    private readonly _opensearchAuth: string;
    private readonly _opensearchIndex: string;

    constructor(
        opensearchEndpoint: string,
        opensearchAuth: string,
        opensearchIndex: string
    ) {
        this._opensearchEndpoint = opensearchEndpoint;
        this._opensearchAuth = opensearchAuth;
        this._opensearchIndex = opensearchIndex;
    }

    async to_opensearch(level = "info", msg = {}, timeout = 3000) {
        const currentTimestamp = Date.now();
        try {
            let { data } = await axios.create({ timeout })({
                method: "POST",
                url:
                    this._opensearchEndpoint +
                    "/" +
                    this._opensearchIndex +
                    "/_doc",
                headers: {
                    Authorization: "Basic " + this._opensearchAuth,
                },
                data: {
                    level: level,
                    msg: msg,
                    version: "v1.0",
                    "@timestamp": currentTimestamp,
                    datetime_utc: new Date(currentTimestamp).toISOString(),
                },
            });
            return data;
        } catch (e) {
            console.log(e);
        }

        return null;
    }
}
