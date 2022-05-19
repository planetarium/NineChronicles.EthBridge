import { ChatPostMessageArguments } from "@slack/web-api";
import { URL } from "url";
import { join } from "path";
import { ForceOmit } from "../types/force-omit";

export interface Message {
    render(): ForceOmit<Partial<ChatPostMessageArguments>, "channel">;
}

export function combineUrl(base: string, addition: string): string {
    const [path, query] = addition.split("?");
    const url = new URL(base);
    url.pathname = join(url.pathname, path);
    url.search = `?${query || ""}`;
    return url.toString();
}
