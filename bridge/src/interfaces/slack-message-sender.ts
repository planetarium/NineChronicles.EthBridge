import { ChatPostMessageResponse } from "@slack/web-api";
import { Message } from "../messages";

export interface ISlackMessageSender {
    sendMessage<T extends Message>(
        message: T
    ): Promise<ChatPostMessageResponse>;
}
