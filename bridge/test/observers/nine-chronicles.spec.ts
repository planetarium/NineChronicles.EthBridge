import Decimal from "decimal.js"

import { INCGTransfer } from "../../src/interfaces/ncg-transfer";
import { IWrappedNCGMinter } from "../../src/interfaces/wrapped-ncg-minter";
import { IMonitorStateStore } from "../../src/interfaces/monitor-state-store";
import { NCGTransferredEventObserver } from "../../src/observers/nine-chronicles";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { TxId } from "../../src/types/txid";
import { IExchangeHistoryStore } from "../../src/interfaces/exchange-history-store";

jest.mock("@slack/web-api", () => {
    return {
        WebClient: jest.fn(() => {
            return {
                chat: {
                    postMessage: jest.fn()
                },
            };
        })
    }
});

describe(NCGTransferredEventObserver.name, () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockNcgTransfer: jest.Mocked<INCGTransfer> = {
        transfer: jest.fn(),
    };

    const mockWrappedNcgMinter: jest.Mocked<IWrappedNCGMinter> = {
        mint: jest.fn().mockResolvedValue({
            transactionHash: "TRANSACTION-HASH"
        }),
    };

    const mockSlackWebClient = new SlackWebClient() as SlackWebClient & {
        chat: {
            postMessage: ReturnType<typeof jest.fn>
        }
    };

    const mockMonitorStateStore: jest.Mocked<IMonitorStateStore> = {
        load: jest.fn(),
        store: jest.fn(),
    };

    const exchangeFeeRatio = new Decimal(0.01);
    const mockExchangeHistoryStore: jest.Mocked<IExchangeHistoryStore> = {
        put: jest.fn(),
        transferredAmountInLast24Hours: jest.fn(),
    };

    const limitationPolicy = {
        maximum: 100000,
        minimum: 100,
    };
    const observer = new NCGTransferredEventObserver(mockNcgTransfer, mockWrappedNcgMinter, mockSlackWebClient, mockMonitorStateStore, mockExchangeHistoryStore, "https://explorer.libplanet.io/9c-internal", "https://ropsten.etherscan.io", exchangeFeeRatio, limitationPolicy);

    describe(NCGTransferredEventObserver.prototype.notify.name, () => {
        it("should record the block hash even if there is no events", () => {
            observer.notify({
                blockHash: "BLOCK-HASH",
                events: [],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith("nineChronicles", {
                blockHash: "BLOCK-HASH",
                txId: null,
            });
        });

        it("shouldn't do anything if the amount is zero", async () => {
            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockResolvedValueOnce(0);
            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [{
                    amount: "0",
                    blockHash: "BLOCK-HASH",
                    txId: "TX-ID",
                    memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                    recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                    sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                }],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith("nineChronicles", {
                blockHash: "BLOCK-HASH",
                txId: null,
            });

            expect(mockNcgTransfer.transfer).not.toHaveBeenCalled();
            expect(mockWrappedNcgMinter.mint).not.toHaveBeenCalled();
        });

        it("should post slack message every events", async () => {
            const amounts = new Map<string, number>();
            mockExchangeHistoryStore.put.mockImplementation(({ sender, amount }) => {
                if (!amounts.has(sender)) {
                    amounts.set(sender, amount);
                } else {
                    console.log("mockImpl", sender, amounts.get(sender)!, amount)
                    amounts.set(sender, amounts.get(sender)! + amount);
                }

                return Promise.resolve();
            });

            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockImplementation((_, sender) => {
                return Promise.resolve(amounts.get(sender) || 0);
            });

            const sender = "0x2734048eC2892d111b4fbAB224400847544FC872";
            const wrappedNcgRecipient: string = "0x4029bC50b4747A037d38CF2197bCD335e22Ca301";
            function makeEvent(wrappedNcgRecipient: string, amount: string, txId: TxId) {
                return {
                    amount: amount,
                    memo: wrappedNcgRecipient,
                    blockHash: "BLOCK-HASH",
                    txId: txId,
                    recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                    sender: sender,
                };
            }

            const events = [
                makeEvent(wrappedNcgRecipient, "1", "TX-INVALID-A"),
                makeEvent(wrappedNcgRecipient, "1.2", "TX-INVALID-B"),
                makeEvent(wrappedNcgRecipient, "0.01", "TX-INVALID-C"),
                makeEvent(wrappedNcgRecipient, "3.22", "TX-INVALID-D"),
                makeEvent(wrappedNcgRecipient, "100", "TX-E"),
                makeEvent(wrappedNcgRecipient, "10000000000", "TX-SHOULD-REFUND-PART-F"),
                makeEvent(wrappedNcgRecipient, "99", "TX-SHOULD-REFUND-G"),
                makeEvent(wrappedNcgRecipient, "100.01", "TX-SHOULD-REFUND-H"),
                makeEvent(wrappedNcgRecipient, "100000", "TX-SHOULD-REFUND-I"),
                makeEvent(wrappedNcgRecipient, "99999.99", "TX-SHOULD-REFUND-J"),
            ];

            console.log("HERE");

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });


            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(1, "nineChronicles", {
                blockHash: "BLOCK-HASH",
                txId: "TX-E",
            });

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(2, "nineChronicles", {
                blockHash: "BLOCK-HASH",
                txId: "TX-SHOULD-REFUND-PART-F",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(1, {
                amount: 100,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-E"
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(2, {
                amount: 99900,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-PART-F"
            });

            expect(mockWrappedNcgMinter.mint.mock.calls).toEqual([
                [wrappedNcgRecipient, new Decimal(    99000000000000000000)],
                [wrappedNcgRecipient, new Decimal( 98901000000000000000000)],
            ]);
        });

        for (const invalidMemo of [
            "0x",
            "",
            "0x4029bC50b4747A037d38CF2197bCD335e22Ca301a",
            "0x0000000000000000000000000000000000000000",
            // See https://github.com/planetarium/NineChronicles.EthBridge/issues/73
            "0XC1912FEE45D61C87CC5EA59DAE31190FFFFF232D",
            "0Xc1912fee45d61c87cc5ea59dae31190fffff232d",
            "C1912FEE45D61C87CC5EA59DAE31190FFFFF232D",
        ]) {
            it(`should refund with invalid memo, ${invalidMemo}`, async () => {
                await observer.notify({
                    blockHash: "BLOCK-HASH",
                    events: [
                        {
                            amount: "100.11",
                            memo: invalidMemo,
                            blockHash: "BLOCK-HASH",
                            txId: "TX-A",
                            recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        }
                    ]
                });

                expect(mockNcgTransfer.transfer).toHaveBeenCalledWith(
                    "0x2734048eC2892d111b4fbAB224400847544FC872",
                    "100.11",
                    "I'm bridge and you should transfer with memo, valid ethereum address to receive.");
            });
        }

        it("slack message - snapshot", async () => {
            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockResolvedValue(0);

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "100.23",
                        memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(mockSlackWebClient.chat.postMessage.mock.calls).toMatchSnapshot();
        })

        it("slack refund error message - snapshot", async () => {
            mockNcgTransfer.transfer.mockImplementationOnce((address, amount, memo) => {
                throw new Error("mockNcgTransfer.transfer error");
            });

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "1.23",
                        memo: "0x0000000000000000000000000000000000000000",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(mockSlackWebClient.chat.postMessage.mock.calls).toMatchSnapshot();
        });

        it("slack ethereum transfer error message - snapshot", async () => {
            mockWrappedNcgMinter.mint.mockImplementationOnce((address, amount) => {
                throw new Error("mockWrappedNcgMinter.mint error");
            });

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "100.23",
                        memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(mockSlackWebClient.chat.postMessage.mock.calls).toMatchSnapshot();
        });
    })
})
