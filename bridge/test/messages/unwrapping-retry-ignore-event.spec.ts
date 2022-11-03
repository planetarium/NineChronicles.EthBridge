import { UnwrappingRetryIgnoreEvent } from "../../src/messages/unwrapping-retry-ignore-event";

describe("UnwrappingRetryIgnoreEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const TX_ID =
                "0xf66fecc057335e29a911a5ea9e2b6b3b2329cfa2d3863552c4950a6a1184aa01";
            expect(
                new UnwrappingRetryIgnoreEvent(TX_ID).render()
            ).toMatchSnapshot();
        });
    });
});
