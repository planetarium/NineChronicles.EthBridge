import { event } from "@pagerduty/pdjs";
import { PagerDutyIntegration } from "../src/integrations/pagerduty";

jest.mock("@pagerduty/pdjs", () => ({ event: jest.fn() }));

describe("PagerDutyIntegration", () => {
    beforeEach(() => (event as jest.Mock).mockClear());

    const sent = () => (event as jest.Mock).mock.calls[0][0].data;

    it("defaults to warning severity", () => {
        new PagerDutyIntegration("key").error("boom", { a: 1 });

        expect(sent().routing_key).toBe("key");
        expect(sent().event_action).toBe("trigger");
        expect(sent().payload.severity).toBe("warning");
        expect(sent().payload.summary).toBe("boom");
        expect(sent().payload.custom_details).toEqual({ a: 1 });
    });

    it.each(["info", "warning", "error", "critical"] as const)(
        "passes %s severity through",
        (severity) => {
            new PagerDutyIntegration("key").error("boom", {}, severity);
            expect(sent().payload.severity).toBe(severity);
        }
    );
});
