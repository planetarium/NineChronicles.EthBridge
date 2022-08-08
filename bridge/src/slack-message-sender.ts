import { ChatPostMessageResponse } from "@slack/web-api";
import { ISlackMessageSender } from "./interfaces/slack-message-sender";
import { Message } from "./messages";
import { ISlackChannel } from "./slack-channel";

export class SlackMessageSender implements ISlackMessageSender {
    private readonly _channel: ISlackChannel;

    constructor(channel: ISlackChannel) {
        this._channel = channel;
    }

    async sendMessage<T extends Message>(
        message: T
    ): Promise<ChatPostMessageResponse> {
        return this._channel.sendMessage(message.render());
    }
}
