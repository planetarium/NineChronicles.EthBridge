import Decimal from "decimal.js";
import { WrappedEvent } from "../../src/messages/wrapped-event"

describe("WrappedEvent", () => {
    describe("render", () => {
        it("snapshot", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const ETHERSCAN_URL = "https://ropsten.etherscan.io";
            const SENDER = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const RECIPIENT = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH = "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID = "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            const FEE = new Decimal(1);
            expect(new WrappedEvent(
                EXPLORER_URL,
                ETHERSCAN_URL,
                SENDER,
                RECIPIENT,
                AMOUNT,
                NINE_CHRONICLES_TX_ID,
                ETHEREUM_TRANSACTION_HASH,
                FEE,
                null,
                null).render()).toMatchSnapshot();
        });

        it("snapshot with refund", () => {
            const EXPLORER_URL = "https://explorer.libplanet.io/9c-internal";
            const ETHERSCAN_URL = "https://ropsten.etherscan.io";
            const SENDER = "0xCbfC996ad185c61a031f40CeeE80a055e6D83005";
            const RECIPIENT = "0xDac65eCE9CB3E7a538773e08DE31F973233F064f";
            const AMOUNT = "100";
            const ETHEREUM_TRANSACTION_HASH = "0x9360cd40682a91a71f0afbfac3dd381866cdb319dc01c13531dfe648f8a28bc7";
            const NINE_CHRONICLES_TX_ID = "3409cdbaa24ec6f7c8d2c0f636325a2b2e9611e5e6df5c593cfcd299860d8043";
            const FEE = new Decimal(1);
            const REFUND_AMOUNT = "9999900000";
            const REFUND_TX_ID = "a3cd151aa0cb24b3e692f433b857f08bd347dad0d2d6ca3666f26420b8b8d096";
            expect(new WrappedEvent(
                EXPLORER_URL,
                ETHERSCAN_URL,
                SENDER,
                RECIPIENT,
                AMOUNT,
                NINE_CHRONICLES_TX_ID,
                ETHEREUM_TRANSACTION_HASH,
                FEE,
                REFUND_AMOUNT,
                REFUND_TX_ID).render()).toMatchSnapshot();
        });
    })
})
