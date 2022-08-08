import {
    ChatPostMessageArguments,
    ChatPostMessageResponse,
    WebClient,
} from "@slack/web-api";
import { ISlackMessageSender } from "./interfaces/slack-message-sender";

export class SlackMessageSender implements ISlackMessageSender {
    private readonly _webClient: WebClient;
    private readonly _channel: string;

    constructor(webClient: WebClient, channel: string) {
        this._webClient = webClient;
        this._channel = channel;
    }

    async sendMessage(
        message: Omit<ChatPostMessageArguments, "channel">
    ): Promise<ChatPostMessageResponse> {
        return this._webClient.chat.postMessage({
            channel: this._channel,
            ...message,
        });
    }
}
