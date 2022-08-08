import os from "os";
import { event } from "@pagerduty/pdjs";
import { Integration } from ".";

export class PagerDutyIntegration implements Integration {
    private readonly _routingKey: string;

    constructor(routingKey: string) {
        this._routingKey = routingKey;
    }

    error(summary: string, error: Record<string, any>) {
        event({
            data: {
                routing_key: this._routingKey,
                event_action: "trigger",
                payload: {
                    severity: "warning",
                    source: os.hostname(),
                    summary: summary,
                    custom_details: error,
                },
            },
        });
    }
}
