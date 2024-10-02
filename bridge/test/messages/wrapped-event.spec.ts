import Decimal from "decimal.js";
import { WrappedEvent } from "../../src/messages/wrapped-event";

describe("WrappedEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://internal.9cscan.com";
            const USE_NCSCAN_URL = false;
            const ETHERSCAN_URL = "https://sepolia.etherscan.io";
            const SENDER = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const RECIPIENT = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            const FEE = new Decimal(1);
            const IS_WHITELIST_EVENT = false;
            const FEE_TRANSFER_TX_ID =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc8";
            expect(
                new WrappedEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    ETHEREUM_TRANSACTION_HASH,
                    FEE,
                    null,
                    null,
                    IS_WHITELIST_EVENT,
                    undefined,
                    FEE_TRANSFER_TX_ID
                ).render()
            ).toMatchSnapshot();
        });

        it("snapshot with refund", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://internal.9cscan.com";
            const USE_NCSCAN_URL = false;
            const ETHERSCAN_URL = "https://sepolia.etherscan.io";
            const SENDER = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const RECIPIENT = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            const FEE = new Decimal(1);
            const REFUND_AMOUNT = "9999900000";
            const REFUND_TX_ID =
                "a3cd151aa0cb24b3e692f433b857f08bd347dad0d2d6ca3666f26420b8b8d096";
            const IS_WHITELIST_EVENT = false;
            const FEE_TRANSFER_TX_ID =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc8";
            expect(
                new WrappedEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    ETHEREUM_TRANSACTION_HASH,
                    FEE,
                    REFUND_AMOUNT,
                    REFUND_TX_ID,
                    IS_WHITELIST_EVENT,
                    undefined,
                    FEE_TRANSFER_TX_ID
                ).render()
            ).toMatchSnapshot();
        });

        it("snapshot with whitelist transfer", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const NCSCAN_URL = "https://internal.9cscan.com";
            const USE_NCSCAN_URL = false;
            const ETHERSCAN_URL = "https://sepolia.etherscan.io";
            const SENDER = "0x27303a4c77c466fc5c631066d64516f1c9a28426";
            const RECIPIENT = "0x50a2aC5E97050bCC3A34dc27858B5DfDF77c4C83";
            const AMOUNT = "200";
            const ETHEREUM_TRANSACTION_HASH =
                "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc8";
            const NINE_CHRONICLES_TX_ID =
                "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8044";
            const FEE = new Decimal(1);
            const IS_WHITELIST_EVENT = true;
            const FEE_TRANSFER_TX_ID = null;
            expect(
                new WrappedEvent(
                    EXPLORER_URL,
                    NCSCAN_URL,
                    USE_NCSCAN_URL,
                    ETHERSCAN_URL,
                    SENDER,
                    RECIPIENT,
                    AMOUNT,
                    NINE_CHRONICLES_TX_ID,
                    ETHEREUM_TRANSACTION_HASH,
                    FEE,
                    null,
                    null,
                    IS_WHITELIST_EVENT,
                    "test description",
                    FEE_TRANSFER_TX_ID
                ).render()
            ).toMatchSnapshot();
        });
    });
});
