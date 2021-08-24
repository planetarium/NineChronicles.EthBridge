import { ChatPostMessageArguments } from "@slack/web-api";
import { URL } from "url";
import { join } from "path";

export interface Message {
    render(): Partial<ChatPostMessageArguments>;
}

export function combineUrl(base: string, addition: string): string {
    const [path, query] = addition.split("?");
    const url = new URL(base);
    url.pathname = join(url.pathname, path);
    url.search = `?${query || ""}`;
    return url.toString();
}
