import { ChatPostMessageArguments } from "@slack/web-api";

export interface Message {
    render(): Partial<ChatPostMessageArguments>;
}
