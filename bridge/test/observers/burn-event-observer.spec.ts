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

    const mockIntegration: jest.Mocked<Integration> = {
        error: jest.fn(),
    };

    const observer = new EthereumBurnEventObserver(
        mockNcgTransfer,
        mockSlackMessageSender,
        mockOpenSearchClient,
        mockMonitorStateStore,
        "https://explorer.libplanet.io/9c-internal",
        "https://9cscan.com",
        false,
        "https://ropsten.etherscan.io",
        mockIntegration
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

        it("should post slack message every events", async () => {
            const ncgRecipient = "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e";
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
                    txId: txId,
                    returnValues: {
                        _sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                        _to: ncgRecipient,
                        amount: amount,
                    },
                };
            }

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

            expect(mockNcgTransfer.transfer.mock.calls).toEqual([
                [ncgRecipient, "1.00", "TX-A"],
                [ncgRecipient, "1.20", "TX-B"],
                [ncgRecipient, "0.01", "TX-C"],
                [ncgRecipient, "3.22", "TX-D"],
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
    });
});
