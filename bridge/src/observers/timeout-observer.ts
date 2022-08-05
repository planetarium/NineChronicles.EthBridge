import { IObserver } from ".";
import { Integration } from "../integrations";

export class TimeoutObserver implements IObserver<unknown> {
    private timer: NodeJS.Timeout;

    private readonly _timeoutMilliseconds: number;
    private readonly _integration: Integration;
    private readonly _nodeKind: "nine-chronicles" | "ethereum";

    constructor(integration: Integration, timeoutMilliseconds: number, nodeKind: "nine-chronicles" | "ethereum") {
        this._integration = integration;
        this._timeoutMilliseconds = timeoutMilliseconds;
        this._nodeKind = nodeKind;

        this.timer = setTimeout(this.report, this._timeoutMilliseconds);
    }

    async notify(data: unknown): Promise<void> {
        clearTimeout(this.timer);
        this.timer = setTimeout(this.report, this._timeoutMilliseconds);
    }

    private report(): void {
        this._integration.error(
            `The observing node (${this._nodeKind}) has not been updated for ${this._timeoutMilliseconds} ms.`,
            {}
        );
    }
}
