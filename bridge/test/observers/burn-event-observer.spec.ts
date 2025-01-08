import { EventData } from "web3-eth-contract";
import { INCGTransfer } from "../../src/interfaces/ncg-transfer";
import { IMonitorStateStore } from "../../src/interfaces/monitor-state-store";
import { OpenSearchClient } from "../../src/opensearch-client";
import { TxId } from "../../src/types/txid";
import { EthereumBurnEventObserver } from "../../src/observers/burn-event-observer";
import { TransactionLocation } from "../../src/types/transaction-location";
import { Integration } from "../../src/integrations";
import { ISlackMessageSender } from "../../src/interfaces/slack-message-sender";
import { SlackMessageSender } from "../../src/slack-message-sender";
import { ISlackChannel } from "../../src/slack-channel";
import { IExchangeHistoryStore } from "../../src/interfaces/exchange-history-store";
import { google } from "googleapis";
import { SpreadsheetClient } from "../../src/spreadsheet-client";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";
import { Decimal } from "decimal.js";
import { MultiPlanetary } from "../../src/multi-planetary";
import { TransactionStatus } from "../../src/types/transaction-status";

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

describe(EthereumBurnEventObserver.name, () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockNcgTransfer: jest.Mocked<INCGTransfer> = {
        transfer: jest.fn().mockResolvedValue("TX-HASH"),
    };

    const mockSlackChannel: jest.Mocked<ISlackChannel> = {
        sendMessage: jest.fn(),
    };
    const mockSlackMessageSender: ISlackMessageSender = new SlackMessageSender(
        mockSlackChannel
    );

    const mockOpenSearchClient = new OpenSearchClient(
        "https://www.mocked-opensearch-url.com",
        "auth",
        "9c-eth-bridge"
    ) as OpenSearchClient & {
        to_opensearch: ReturnType<typeof jest.fn>;
    };

    const mockMonitorStateStore: jest.Mocked<IMonitorStateStore> = {
        load: jest.fn(),
        store: jest.fn(),
    };

    const mockExchangeHistoryStore: jest.Mocked<IExchangeHistoryStore> = {
        put: jest.fn(),
        transferredAmountInLast24Hours: jest.fn(),
        exist: jest.fn(),
        updateStatus: jest.fn().mockResolvedValue(undefined),
        getPendingTransactions: jest.fn(),
    };

    const mockIntegration: jest.Mocked<Integration> = {
        error: jest.fn(),
    };

    const exchangeFeeRatioPolicy = new FixedExchangeFeeRatioPolicy(
        new Decimal(100000),
        new Decimal(10000),
        {
            criterion: new Decimal(1000),
            fee: new Decimal(10),
        },
        {
            range1: new Decimal(0.01),
            range2: new Decimal(0.02),
        }
    );

    const authorize = new google.auth.JWT(
        "mockedEmail@inTest.com",
        undefined,
        "mockedJwtKey",
        ["mocked-google-spreadsheet-url"]
    );

    const googleSheet = google.sheets({
        version: "v4",
        auth: authorize,
    });

    const mockSpreadSheetClient = new SpreadsheetClient(
        googleSheet,
        "mocked-google-spreadsheet-id",
        false,
        "mocked-slack-url",
        {
            mint: "NCGtoWNCG",
            burn: "WNCGtoNCG",
        },
        exchangeFeeRatioPolicy
    ) as SpreadsheetClient;
    const failureSubscribers = "@gamefi-be";

    const planetIds = {
        odin: "0x100000000000",
        heimdall: "0x100000000001",
    };
    const planetVaultAddress = {
        heimdall: "0xaaaaa6db35d5eff2f0b0758c5ac4c354debaf118",
    };
    const multiPlanetary = new MultiPlanetary(planetIds, planetVaultAddress);

    const observer = new EthereumBurnEventObserver(
        mockNcgTransfer,
        mockSlackMessageSender,
        mockOpenSearchClient,
        mockSpreadSheetClient,
        mockMonitorStateStore,
        mockExchangeHistoryStore,
        "https://explorer.libplanet.io/9c-internal",
        "https://internal.9cscan.com",
        false,
        "https://sepolia.etherscan.io",
        mockIntegration,
        multiPlanetary,
        failureSubscribers
    );

    describe(EthereumBurnEventObserver.prototype.notify.name, () => {
        it("should record the block hash even if there is no events", () => {
            observer.notify({
                blockHash: "BLOCK-HASH",
                events: [],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "ethereum",
                {
                    blockHash: "BLOCK-HASH",
                    txId: null,
                }
            );
        });

        function makeEvent(
            ncgRecipient: string,
            amount: number,
            txId: TxId
        ): EventData & TransactionLocation {
            return {
                blockHash: "BLOCK-HASH",
                address: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                logIndex: 0,
                blockNumber: 0,
                event: "Burn",
                raw: {
                    data: "",
                    topics: [],
                },
                signature: "",
                transactionIndex: 0,
                transactionHash: txId,
                txId,
                returnValues: {
                    _sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                    _to: ncgRecipient,
                    amount,
                },
            };
        }
        const ncgRecipient = "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e";

        it("should post slack message every events", async () => {
            const events = [
                makeEvent(ncgRecipient, 1000000000000000000, "TX-A"),
                makeEvent(ncgRecipient, 1200000000000000000, "TX-B"),
                makeEvent(ncgRecipient, 10000000000000000, "TX-C"),
                makeEvent(ncgRecipient, 3225000000000000000, "TX-D"),
            ];

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "ethereum",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-D",
                }
            );

            expect(mockExchangeHistoryStore.put.mock.calls).toEqual([
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-A",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-B",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1.2,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-C",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 0.01,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-D",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 3.22,
                        status: TransactionStatus.PENDING,
                    },
                ],
            ]);

            expect(mockNcgTransfer.transfer.mock.calls).toEqual([
                [ncgRecipient, "1.00", "TX-A"],
                [ncgRecipient, "1.20", "TX-B"],
                [ncgRecipient, "0.01", "TX-C"],
                [ncgRecipient, "3.22", "TX-D"],
            ]);
        });

        it("should post slack message every events of Multi-Planet Request - Odin", async () => {
            const odinMultiPlanetNcgRecipient = (
                planetIds.odin + ncgRecipient.slice(2)
            ).padEnd(66, "0");
            const events = [
                makeEvent(
                    odinMultiPlanetNcgRecipient,
                    1000000000000000000,
                    "TX-ODIN-A"
                ),
                makeEvent(
                    odinMultiPlanetNcgRecipient,
                    1200000000000000000,
                    "TX-ODIN-B"
                ),
                makeEvent(
                    odinMultiPlanetNcgRecipient,
                    10000000000000000,
                    "TX-ODIN-C"
                ),
                makeEvent(
                    odinMultiPlanetNcgRecipient,
                    3225000000000000000,
                    "TX-ODIN-D"
                ),
            ];

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "ethereum",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-ODIN-D",
                }
            );

            expect(mockExchangeHistoryStore.put.mock.calls).toEqual([
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-ODIN-A",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-ODIN-B",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1.2,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-ODIN-C",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 0.01,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-ODIN-D",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 3.22,
                        status: TransactionStatus.PENDING,
                    },
                ],
            ]);

            /**
             * If User send wNCG to other planet
             * Recipient: other planet's vault address
             * Memo: user's other planet's 9c Address
             */
            expect(mockNcgTransfer.transfer.mock.calls).toEqual([
                [ncgRecipient, "1.00", "TX-ODIN-A"],
                [ncgRecipient, "1.20", "TX-ODIN-B"],
                [ncgRecipient, "0.01", "TX-ODIN-C"],
                [ncgRecipient, "3.22", "TX-ODIN-D"],
            ]);
        });

        it("should post slack message every events of Heimdall Request", async () => {
            const heimdallMultiPlanetNcgRecipient = (
                planetIds.heimdall + ncgRecipient.slice(2)
            ).padEnd(66, "0");

            const events = [
                makeEvent(
                    heimdallMultiPlanetNcgRecipient,
                    1000000000000000000,
                    "TX-HEIMDALL-A"
                ),
                makeEvent(
                    heimdallMultiPlanetNcgRecipient,
                    1200000000000000000,
                    "TX-HEIMDALL-B"
                ),
                makeEvent(
                    heimdallMultiPlanetNcgRecipient,
                    10000000000000000,
                    "TX-HEIMDALL-C"
                ),
                makeEvent(
                    heimdallMultiPlanetNcgRecipient,
                    3225000000000000000,
                    "TX-HEIMDALL-D"
                ),
            ];

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith(
                "ethereum",
                {
                    blockHash: "BLOCK-HASH",
                    txId: "TX-HEIMDALL-D",
                }
            );

            expect(mockExchangeHistoryStore.put.mock.calls).toEqual([
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-HEIMDALL-A",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-HEIMDALL-B",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 1.2,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-HEIMDALL-C",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 0.01,
                        status: TransactionStatus.PENDING,
                    },
                ],
                [
                    {
                        network: "ethereum",
                        tx_id: "TX-HEIMDALL-D",
                        sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        recipient: ncgRecipient,
                        timestamp: expect.any(String),
                        amount: 3.22,
                        status: TransactionStatus.PENDING,
                    },
                ],
            ]);

            /**
             * If User send wNCG to other planet
             * Recipient: other planet's vault address
             * Memo: user's other planet's 9c Address
             */
            expect(mockNcgTransfer.transfer.mock.calls).toEqual([
                [planetVaultAddress.heimdall, "1.00", ncgRecipient],
                [planetVaultAddress.heimdall, "1.20", ncgRecipient],
                [planetVaultAddress.heimdall, "0.01", ncgRecipient],
                [planetVaultAddress.heimdall, "3.22", ncgRecipient],
            ]);
        });

        it("slack/opensearch message - snapshot", async () => {
            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        blockHash: "BLOCK-HASH",
                        address: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        logIndex: 0,
                        blockNumber: 0,
                        event: "Burn",
                        raw: {
                            data: "",
                            topics: [],
                        },
                        signature: "",
                        transactionIndex: 0,
                        transactionHash: "TX-ID",
                        txId: "TX-ID",
                        returnValues: {
                            _sender:
                                "0x2734048eC2892d111b4fbAB224400847544FC872",
                            _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            amount: 1000000000000000000,
                        },
                    },
                ],
            });

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("slack/opensearch 9c transfer error message - snapshot", async () => {
            mockNcgTransfer.transfer.mockImplementationOnce(
                (address, amount, memo) => {
                    throw new Error("mockNcgTransfer.transfer error");
                }
            );

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        blockHash: "BLOCK-HASH",
                        address: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        logIndex: 0,
                        blockNumber: 0,
                        event: "Burn",
                        raw: {
                            data: "",
                            topics: [],
                        },
                        signature: "",
                        transactionIndex: 0,
                        transactionHash: "TX-ID",
                        txId: "TX-ID",
                        returnValues: {
                            _sender:
                                "0x2734048eC2892d111b4fbAB224400847544FC872",
                            _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            amount: 1000000000000000000,
                        },
                    },
                ],
            });

            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();
            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
        });

        it("pagerduty 9c transfer error message - snapshot", async () => {
            mockNcgTransfer.transfer.mockImplementationOnce(
                (address, amount, memo) => {
                    throw new Error("mockNcgTransfer.transfer error");
                }
            );

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        blockHash: "BLOCK-HASH",
                        address: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                        logIndex: 0,
                        blockNumber: 0,
                        event: "Burn",
                        raw: {
                            data: "",
                            topics: [],
                        },
                        signature: "",
                        transactionIndex: 0,
                        transactionHash: "TX-ID",
                        txId: "TX-ID",
                        returnValues: {
                            _sender:
                                "0x2734048eC2892d111b4fbAB224400847544FC872",
                            _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            amount: 1000000000000000000,
                        },
                    },
                ],
            });

            expect(mockIntegration.error.mock.calls).toMatchSnapshot();
        });

        it("should handle existing exchange history and send error message", async () => {
            const existingTxId = "EXISTING-TX-ID";
            mockExchangeHistoryStore.exist.mockResolvedValue(true);

            const events = [
                {
                    blockHash: "BLOCK-HASH",
                    address: "0x4029bC50b4747A037d38CF2197bCD335e22Ca301",
                    logIndex: 0,
                    blockNumber: 0,
                    event: "Burn",
                    raw: {
                        data: "",
                        topics: [],
                    },
                    signature: "",
                    transactionIndex: 0,
                    transactionHash: existingTxId,
                    txId: existingTxId,
                    returnValues: {
                        _sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                        amount: 1000000000000000000,
                    },
                },
            ];

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockSlackChannel.sendMessage.mock.calls).toMatchSnapshot();
            expect(
                mockOpenSearchClient.to_opensearch.mock.calls
            ).toMatchSnapshot();

            expect(mockExchangeHistoryStore.put).not.toHaveBeenCalled();
        });
    });
});
