import { WrappingRetryIgnoreEvent } from "../../src/messages/wrapping-retry-ignore-event"

describe("WrappingRetryIgnoreEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const TX_ID = "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            expect(new WrappingRetryIgnoreEvent(TX_ID).render()).toMatchSnapshot();
        });
    })
})
