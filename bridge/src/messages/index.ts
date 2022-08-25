import { ChatPostMessageArguments } from "@slack/web-api";
import { URL } from "url";
import { join } from "path";
import { ForceOmit } from "../types/force-omit";

export interface Message {
    render(): ForceOmit<ChatPostMessageArguments, "channel">;
}
