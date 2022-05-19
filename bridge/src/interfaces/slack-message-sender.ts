import { ChatPostMessageArguments, ChatPostMessageResponse } from "@slack/web-api";
import { ForceOmit } from "../types/force-omit";

export interface ISlackMessageSender {
    sendMessage(message: ForceOmit<ChatPostMessageArguments, "channel">): Promise<ChatPostMessageResponse>;
}
