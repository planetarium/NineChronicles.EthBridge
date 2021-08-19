import { EventData } from 'web3-eth-contract';
import { INCGTransfer } from "../../src/interfaces/ncg-transfer";
import { IMonitorStateStore } from "../../src/interfaces/monitor-state-store";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { TxId } from "../../src/types/txid";
import { EthereumBurnEventObserver } from "../../src/observers/burn-event-observer";
import { TransactionLocation } from '../../src/types/transaction-location';

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

describe(EthereumBurnEventObserver.name, () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockNcgTransfer: jest.Mocked<INCGTransfer> = {
        transfer: jest.fn().mockResolvedValue("TX-HASH"),
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

    const observer = new EthereumBurnEventObserver(mockNcgTransfer, mockSlackWebClient, mockMonitorStateStore, "https://explorer.libplanet.io/9c-internal", "https://ropsten.etherscan.io");

    describe(EthereumBurnEventObserver.prototype.notify.name, () => {
        it("should record the block hash even if there is no events", () => {
            observer.notify({
                blockHash: "BLOCK-HASH",
                events: [],
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith("ethereum", {
                blockHash: "BLOCK-HASH",
                txId: null,
            });
        });

        it("should post slack message every events", async () => {
            const ncgRecipient = "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e";
            function makeEvent(ncgRecipient: string, amount: number, txId: TxId): (EventData & TransactionLocation) {
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
                        amount: amount
                    }
                }
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

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith("ethereum", {
                blockHash: "BLOCK-HASH",
                txId: "TX-D",
            });

            expect(mockNcgTransfer.transfer.mock.calls).toEqual([
                [ncgRecipient, "1.00", null],
                [ncgRecipient, "1.20", null],
                [ncgRecipient, "0.01", null],
                [ncgRecipient, "3.22", null],
            ]);
        });

        it("slack message - snapshot", async () => {
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
                            _sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                            _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            amount: 1000000000000000000
                        }
                    }
                ],
            });

            expect(mockSlackWebClient.chat.postMessage.mock.calls).toMatchSnapshot();
        })

        it("slack 9c transfer error message - snapshot", async () => {
            mockNcgTransfer.transfer.mockImplementationOnce((address, amount, memo) => {
                throw new Error("mockNcgTransfer.transfer error");
            });

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
                            _sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                            _to: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                            amount: 1000000000000000000
                        }
                    }
                ],
            });

            expect(mockSlackWebClient.chat.postMessage.mock.calls).toMatchSnapshot();
        });
    })
})
