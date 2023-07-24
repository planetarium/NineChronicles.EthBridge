import { WrappingFailureEvent } from "../../src/messages/wrapping-failure-event";

describe("WrappingFailureEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://9cscan.com";
            const USE_NCSCAN_URL = false;
            const SENDER = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const RECIPIENT = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const AMOUNT = "100";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            const failureSubscribers = "@gamefi-be";
            expect(
                new WrappingFailureEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    String(new Error("error")),
                    failureSubscribers
                ).render()
            ).toMatchSnapshot();
        });
    });
});
