import { UnwrappingFailureEvent } from "../../src/messages/unwrapping-failure-event";

describe("UnwrappingFailureEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const ETHERSCAN_URL = "https://ropsten.etherscan.io";
            const SENDER = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const RECIPIENT = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            expect(
                new UnwrappingFailureEvent(
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    ETHEREUM_TRANSACTION_HASH,
                    String(new Error("error")),
                    "odin",
                    "@gamefi-be"
                ).render()
            ).toMatchSnapshot();
        });
    });
});
