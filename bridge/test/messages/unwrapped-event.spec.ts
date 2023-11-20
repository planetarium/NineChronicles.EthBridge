import { UnwrappedEvent } from "../../src/messages/unwrapped-event";

describe("UnwrappedEvent", () => {
    describe("render", () => {
        it("odin request snapshot", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://9cscan.com";
            const USE_NCSCAN_URL = false;
            const ETHERSCAN_URL = "https://ropsten.etherscan.io";
            const SENDER = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const RECIPIENT = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            expect(
                new UnwrappedEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    ETHEREUM_TRANSACTION_HASH,
                    false,
                    "odin"
                ).render()
            ).toMatchSnapshot();
        });

        it("heimdall request snapshot", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://9cscan.com";
            const USE_NCSCAN_URL = false;
            const ETHERSCAN_URL = "https://ropsten.etherscan.io";
            const SENDER = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const RECIPIENT = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            expect(
                new UnwrappedEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    ETHEREUM_TRANSACTION_HASH,
                    true,
                    "heimdall"
                ).render()
            ).toMatchSnapshot();
        });
    });
});
