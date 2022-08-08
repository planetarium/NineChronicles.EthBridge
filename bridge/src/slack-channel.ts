import {
    ChatPostMessageArguments,
    ChatPostMessageResponse,
    WebClient,
} from "@slack/web-api";
import { ForceOmit } from "./types/force-omit";

export interface ISlackChannel {
    sendMessage(
        message: ForceOmit<ChatPostMessageArguments, "channel">
    ): Promise<ChatPostMessageResponse>;
}

export class SlackChannel implements ISlackChannel {
    private readonly _webClient: WebClient;
    private readonly _channel: string;

    constructor(webClient: WebClient, channel: string) {
        this._webClient = webClient;
        this._channel = channel;
    }

    async sendMessage(
        message: ForceOmit<ChatPostMessageArguments, "channel">
    ): Promise<ChatPostMessageResponse> {
        return this._webClient.chat.postMessage({
            channel: this._channel,
            ...message,
        });
    }
}
