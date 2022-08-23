import { join } from "path";
import { URL } from "url";

export function combineNcExplorerUrl(
    explorerUrl: string,
    ncscanUrl: string | undefined,
    useNcscan: boolean,
    txId: string
) {
    if (useNcscan) {
        if (ncscanUrl === undefined) {
            throw new Error("ncscanUrl is undefined");
        }

        return combineUrl(ncscanUrl, `/tx/${txId}`);
    } else {
        return combineUrl(explorerUrl, `/transaction?${txId}`);
    }
}

export function combineUrl(base: string, addition: string): string {
    const [path, query] = addition.split("?");
    const url = new URL(base);
    url.pathname = join(url.pathname, path);
    url.search = `?${query || ""}`; // FIXME: remove ? when not required.
    return url.toString();
}
