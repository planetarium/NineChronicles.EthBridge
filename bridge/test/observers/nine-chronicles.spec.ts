import { Decimal } from "decimal.js";
import { INCGTransfer } from "../../src/interfaces/ncg-transfer";
import { IWrappedNCGMinter } from "../../src/interfaces/wrapped-ncg-minter";
import { IMonitorStateStore } from "../../src/interfaces/monitor-state-store";
import { NCGTransferredEventObserver } from "../../src/observers/nine-chronicles";
import { OpenSearchClient } from "../../src/opensearch-client";
import { TxId } from "../../src/types/txid";
import { IExchangeHistoryStore } from "../../src/interfaces/exchange-history-store";
import { IAddressBanPolicy } from "../../src/policies/address-ban";
import { Integration } from "../../src/integrations";
import { ISlackMessageSender } from "../../src/interfaces/slack-message-sender";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";
import { ISlackChannel } from "../../src/slack-channel";
import { SlackMessageSender } from "../../src/slack-message-sender";
import { ACCOUNT_TYPE } from "../../src/whitelist/account-type";
import { SpreadsheetClient } from "../../src/spreadsheet-client";
import { google } from "googleapis";

jest.mock("@slack/web-api", () => {
    return {
        WebClient: jest.fn(() => {
            return {
                chat: {
                    postMessage: jest.fn(),
                },
            };
        }),
    };
});

jest.mock("../../src/opensearch-client", () => {
    return {
        OpenSearchClient: jest.fn(() => {
            return {
                to_opensearch: jest.fn(),
            };
        }),
    };
});

jest.mock("../../src/spreadsheet-client", () => {
    return {
        SpreadsheetClient: jest.fn(() => {
            return {
                to_spreadsheet_mint: jest.fn(),
                to_spreadsheet_burn: jest.fn(),
            };
        }),
    };
});

describe(NCGTransferredEventObserver.name, () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockNcgTransfer: jest.Mocked<INCGTransfer> = {
        transfer: jest.fn(),
    };

    const mockWrappedNcgMinter: jest.Mocked<IWrappedNCGMinter> = {
        mint: jest.fn().mockResolvedValue("TRANSACTION-HASH"),
    };

    const mockSlackChannel: jest.Mocked<ISlackChannel> = {
        sendMessage: jest.fn(),
    };
    const mockSlackMessageSender: ISlackMessageSender = new SlackMessageSender(
        mockSlackChannel
    );

    const mockOpenSearchClient = new OpenSearchClient(
        "https://www.random-url.com",
        "auth",
        "9c-eth-bridge"
    ) as OpenSearchClient & {
        to_opensearch: ReturnType<typeof jest.fn>;
    };

    const mockMonitorStateStore: jest.Mocked<IMonitorStateStore> = {
        load: jest.fn(),
        store: jest.fn(),
    };

    const exchangeFeeRatioPolicy = new FixedExchangeFeeRatioPolicy(
        new Decimal(100000),
        new Decimal(50000),
        {
            criterion: new Decimal(1000),
            fee: new Decimal(10),
        },
        {
            range1: new Decimal(0.01),
            range2: new Decimal(0.02),
        }
    );

    const mockExchangeHistoryStore: jest.Mocked<IExchangeHistoryStore> = {
        put: jest.fn(),
        transferredAmountInLast24Hours: jest.fn(),
        exist: jest.fn(),
    };

    const limitationPolicy = {
        maximum: 100000,
        whitelistMaximum: 200000,
        minimum: 100,
    };
    const BANNED_ADDRESS = "0x47D082a115c63E7b58B1532d20E631538eaFADde";
    const addressBanPolicy: jest.Mocked<IAddressBanPolicy> = {
        isBannedAddress: jest
            .fn()
            .mockImplementation((address) => address === BANNED_ADDRESS),
    };

    const mockIntegration: jest.Mocked<Integration> = {
        error: jest.fn(),
    };

    const authorize = new google.auth.JWT(
        "randemail@rand.com",
        undefined,
        "rand-key",
        ["spreadsheet-url"]
    );

    const googleSheet = google.sheets({
        version: "v4",
        auth: authorize,
    });

    const mockSpreadSheetClient = new SpreadsheetClient(
        googleSheet,
        "random-id",
        false,
        "slack-url",
        {
            mint: "NCGtoWNCG",
            burn: "WNCGtoNCG",
        },
        exchangeFeeRatioPolicy
    ) as SpreadsheetClient;

    const failureSubscribers = "@gamefi-be";

    const allowlistSender = "0xa134048eC2892d111b4fbAB224400847544FC871";
    const allowlistRecipient = "0x954941eC7FACf9A81e2f026A356fF83F54a5827F";

    const feeWaiverSender = "0xb134048eC2892d111b4fbAB224400847544FC871";
    const feeWaiverRecipient = "0xd1EF2BDd39323D8C17eD4a122aa910301cf1eDAA";

    const observer = new NCGTransferredEventObserver(
        mockNcgTransfer,
        mockWrappedNcgMinter,
        mockSlackMessageSender,
        mockOpenSearchClient,
        mockSpreadSheetClient,
        mockMonitorStateStore,
        mockExchangeHistoryStore,
        "https://explorer.libplanet.io/9c-internal",
        "https://9cscan.com",
        false,
        "https://ropsten.etherscan.io",
        exchangeFeeRatioPolicy,
        limitationPolicy,
        addressBanPolicy,
        mockIntegration,
        failureSubscribers,
        [
            {
                type: ACCOUNT_TYPE.ALLOWED,
                from: allowlistSender,
                to: allowlistRecipient,
            },
            {
                type: ACCOUNT_TYPE.FEE_WAIVER_ALLOWED,
                from: feeWaiverSender,
                to: feeWaiverRecipient,
            },
        ]
    );

    describe(NCGTransferredEventObserver.prototype.notify.name, () => {
        beforeEach(() => {
            mockNcgTransfer.transfer.mockResolvedValue("TX-ID");
        });

        afterEach(() => {
            jest.clearAllMocks();
        });

        it("should record the block hash even if there is no events", () => {
            observer.notify({
                blockHash: "BLOCK-HASH",
                events: [],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: null,
                }
            );
        });

        it("shouldn't do anything if the amount is zero", async () => {
            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockResolvedValueOnce(
                0
            );
            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "0",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-ID",
                }
            );

            expect(mockNcgTransfer.transfer).not.toHaveBeenCalled();
            expect(mockWrappedNcgMinter.mint).not.toHaveBeenCalled();
        });

        it("shouldn skip if the sender is banned", async () => {
            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "0",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: BANNED_ADDRESS,
                    },
                ],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: null,
                }
            );

            expect(mockNcgTransfer.transfer).not.toHaveBeenCalled();
            expect(mockWrappedNcgMinter.mint).not.toHaveBeenCalled();
        });

        it("should skip if the exchange history already exists", async () => {
            mockExchangeHistoryStore.exist.mockImplementationOnce(
                async (tx_id: string) => {
                    if (tx_id === "TX-ID-A") {
                        return true;
                    } else {
                        return false;
                    }
                }
            );

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "0",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID-A",
                        memo: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: BANNED_ADDRESS,
                    },
                ],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "nineChronicles",
                { blockHash: "BLOCK-HASH", txId: null }
            );
            expect(mockNcgTransfer.transfer).not.toHaveBeenCalled();
            expect(mockWrappedNcgMinter.mint).not.toHaveBeenCalled();
        });

        it("should record exchange history though mint failed", async () => {
            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockResolvedValueOnce(
                0
            );
            mockWrappedNcgMinter.mint.mockRejectedValueOnce(new Error());

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "100.11",
                        memo: "0xa2D738C3442609d92F1C62BDF051D0385F644b8E",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledTimes(1);
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                1,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-ID",
                }
            );

            expect(mockExchangeHistoryStore.put).toHaveBeenCalledTimes(1);
            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(1, {
                amount: 100.11,
                network: "nineChronicles",
                recipient: "0xa2D738C3442609d92F1C62BDF051D0385F644b8E",
                sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                timestamp: expect.any(String),
                tx_id: "TX-ID",
            });
        });

        it("should post slack message every events", async () => {
            const amounts = new Map<string, number>();
            mockExchangeHistoryStore.put.mockImplementation(
                ({ sender, amount }) => {
                    if (!amounts.has(sender)) {
                        amounts.set(sender, amount);
                    } else {
                        console.log(
                            "mockImpl",
                            sender,
                            amounts.get(sender)!,
                            amount
                        );
                        amounts.set(sender, amounts.get(sender)! + amount);
                    }

                    return Promise.resolve();
                }
            );

            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockImplementation(
                (_, sender) => {
                    return Promise.resolve(amounts.get(sender) || 0);
                }
            );

            const sender = "0x2734048eC2892d111b4fbAB224400847544FC872";
            const wrappedNcgRecipient =
                "0x4029bC50b4747A037d38CF2197bCD335e22Ca301";
            function makeEvent(
                wrappedNcgRecipient: string,
                amount: string,
                txId: TxId
            ) {
                return {
                    amount: amount,
                    memo: wrappedNcgRecipient,
                    blockHash: "BLOCK-HASH",
                    txId: txId,
                    recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                    sender: sender,
                };
            }

            function makeWhitelistEvent(
                whitelistSender: string,
                whitelistTRecipient: string,
                amount: string,
                txId: TxId
            ) {
                return {
                    amount: amount,
                    memo: whitelistTRecipient,
                    blockHash: "BLOCK-HASH",
                    txId: txId,
                    recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                    sender: whitelistSender,
                };
            }

            const events = [
                makeEvent(wrappedNcgRecipient, "1", "TX-INVALID-A"),
                makeEvent(wrappedNcgRecipient, "1.2", "TX-INVALID-B"),
                makeEvent(wrappedNcgRecipient, "0.01", "TX-INVALID-C"),
                makeEvent(wrappedNcgRecipient, "3.22", "TX-INVALID-D"),
                makeEvent(wrappedNcgRecipient, "100", "TX-E"), // Success TX - Base Fee
                makeEvent(wrappedNcgRecipient, "5000", "TX-FEE-FIRST-RANGE"), //Success TX - fee first range
                makeEvent(wrappedNcgRecipient, "60000", "TX-FEE-SECOND-RANGE"), //Success TX - fee second range
                makeEvent(
                    wrappedNcgRecipient,
                    "10000000000",
                    "TX-SHOULD-REFUND-PART-F"
                ),
                makeEvent(wrappedNcgRecipient, "99", "TX-SHOULD-REFUND-G"),
                makeEvent(wrappedNcgRecipient, "100.01", "TX-SHOULD-REFUND-H"),
                makeEvent(wrappedNcgRecipient, "100000", "TX-SHOULD-REFUND-I"),
                makeEvent(
                    wrappedNcgRecipient,
                    "99999.99",
                    "TX-SHOULD-REFUND-J"
                ),
                makeWhitelistEvent(
                    allowlistSender,
                    allowlistRecipient,
                    "11000",
                    "TX-ALLOWLIST"
                ),
                makeWhitelistEvent(
                    feeWaiverSender,
                    feeWaiverRecipient,
                    "11000",
                    "TX-FEE-WAIVER"
                ),
            ];

            console.log("HERE");

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                1,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-INVALID-A",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                2,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-INVALID-B",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                3,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-INVALID-C",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                4,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-INVALID-D",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                5,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-E",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                6,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-FEE-FIRST-RANGE",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                7,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-FEE-SECOND-RANGE",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                8,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-SHOULD-REFUND-PART-F",
                }
            );

            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                9,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-SHOULD-REFUND-G",
                }
            );
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                10,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-SHOULD-REFUND-H",
                }
            );
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                11,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-SHOULD-REFUND-I",
                }
            );
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                12,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-SHOULD-REFUND-J",
                }
            );
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                13,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-ALLOWLIST",
                }
            );
            expect(mockMonitorStateStore.store).toHaveBeenNthCalledWith(
                14,
                "nineChronicles",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-FEE-WAIVER",
                }
            );

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(1, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-INVALID-A",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(2, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-INVALID-B",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(3, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-INVALID-C",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(4, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-INVALID-D",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(5, {
                amount: 100,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-E",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(6, {
                amount: 5000,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-FEE-FIRST-RANGE",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(7, {
                amount: 60000,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-FEE-SECOND-RANGE",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(8, {
                amount: 34900, // 100000 - ( 100 + 5000 + 60000 )
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-PART-F",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(9, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-G",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(10, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-H",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(11, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-I",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(12, {
                amount: 0,
                network: "nineChronicles",
                recipient: wrappedNcgRecipient,
                sender: sender,
                timestamp: expect.any(String),
                tx_id: "TX-SHOULD-REFUND-J",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(13, {
                amount: 11000,
                network: "nineChronicles",
                recipient: allowlistRecipient,
                sender: allowlistSender,
                timestamp: expect.any(String),
                tx_id: "TX-ALLOWLIST",
            });

            expect(mockExchangeHistoryStore.put).toHaveBeenNthCalledWith(14, {
                amount: 11000,
                network: "nineChronicles",
                recipient: feeWaiverRecipient,
                sender: feeWaiverSender,
                timestamp: expect.any(String),
                tx_id: "TX-FEE-WAIVER",
            });

            // applied fixed fee ( 10 NCG for transfer under 1000 NCG )
            expect(mockWrappedNcgMinter.mint.mock.calls).toEqual([
                [wrappedNcgRecipient, new Decimal(90000000000000000000)], // Base Fee ( 100 NCG, BaseFee 10 NCG )
                [wrappedNcgRecipient, new Decimal(4950000000000000000000)], // Fee First Range ( 5000 NCG, Fee 0.01 )
                [wrappedNcgRecipient, new Decimal(58800000000000000000000)], // Fee Second Range ( 60000 NCG, Fee 0.02 )
                [wrappedNcgRecipient, new Decimal(34551000000000000000000)],
                [allowlistRecipient, new Decimal(10890000000000000000000)],
                [feeWaiverRecipient, new Decimal(11000000000000000000000)],
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
            null,
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
                            recipient:
                                "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        },
                    ],
                });

                expect(mockNcgTransfer.transfer).toHaveBeenCalledWith(
                    "0x2734048eC2892d111b4fbAB224400847544FC872",
                    "100.11",
                    "I'm bridge and you should transfer with memo, valid ethereum address to receive."
                );

                expect(mockExchangeHistoryStore.put).toHaveBeenCalledWith({
                    network: "nineChronicles",
                    tx_id: "TX-A",
                    sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    recipient: invalidMemo ?? "",
                    timestamp: expect.any(String),
                    amount: 0,
                });
            });
        }

        it("slack/opensearch message - snapshot", async () => {
            mockExchangeHistoryStore.transferredAmountInLast24Hours.mockResolvedValue(
                0
            );

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

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("slack/opensearch refund error message - snapshot", async () => {
            mockNcgTransfer.transfer.mockImplementationOnce(
                (address, amount, memo) => {
                    throw new Error("mockNcgTransfer.transfer error");
                }
            );

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

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("slack/opensearch object error message - snapshot", async () => {
            mockWrappedNcgMinter.mint.mockImplementationOnce(() => {
                throw {
                    code: -32000,
                    message:
                        "err: max fee per gas less than block base fee: address 0x9093dd96c4bb6b44A9E0A522e2DE49641F146223, maxFeePerGas: 300000000000 baseFee: 305545815494 (supplied gas 11118348)",
                };
            });

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "100.23",
                        memo: "0x0000000000000000000000000000000000000001",
                        blockHash: "BLOCK-HASH",
                        txId: "TX-ID",
                        recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    },
                ],
            });

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("slack/opensearch ethereum transfer error message - snapshot", async () => {
            mockWrappedNcgMinter.mint.mockImplementationOnce(
                (address, amount) => {
                    throw new Error("mockWrappedNcgMinter.mint error");
                }
            );

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

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("pagerduty ethereum transfer error message - snapshot", async () => {
            mockWrappedNcgMinter.mint.mockImplementationOnce(
                (address, amount) => {
                    throw new Error("mockWrappedNcgMinter.mint error");
                }
            );

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

            expect(mockIntegration.error.mock.calls).toMatchSnapshot();
        });

        // Try to catch cases when others, not object and error, were thrown.
        it("slack/opensearch string error message - snapshot", async () => {
            mockWrappedNcgMinter.mint.mockRejectedValueOnce("error message");

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

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });
    });
});
