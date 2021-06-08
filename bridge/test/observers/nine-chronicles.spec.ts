import { INCGTransfer } from "../../src/interfaces/ncg-transfer";
import { IWrappedNCGMinter } from "../../src/interfaces/wrapped-ncg-minter";
import { IMonitorStateStore } from "../../src/interfaces/monitor-state-store";
import { NCGTransferredEventObserver } from "../../src/observers/nine-chronicles";
import { WebClient as SlackWebClient } from "@slack/web-api";
import { TxId } from "../../src/types/txid";

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

    const observer = new NCGTransferredEventObserver(mockNcgTransfer, mockWrappedNcgMinter, mockSlackWebClient, mockMonitorStateStore, "https://explorer.libplanet.io/9c-internal", "https://ropsten.etherscan.io");

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

        it("should post slack message every events", async () => {
            const wrappedNcgRecipient: string = "0x4029bC50b4747A037d38CF2197bCD335e22Ca301";
            function makeEvent(wrappedNcgRecipient: string, amount: string, txId: TxId) {
                return {
                    amount: amount,
                    memo: wrappedNcgRecipient,
                    blockHash: "BLOCK-HASH",
                    txId: txId,
                    recipient: "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e",
                    sender: "0x2734048eC2892d111b4fbAB224400847544FC872",
                };
            }

            const events = [
                makeEvent(wrappedNcgRecipient, "1", "TX-A"),
                makeEvent(wrappedNcgRecipient, "1.2", "TX-B"),
                makeEvent(wrappedNcgRecipient, "0.01", "TX-C"),
                makeEvent(wrappedNcgRecipient, "3.22", "TX-D"),
            ];

            await observer.notify({
                blockHash: "BLOCK-HASH",
                events,
            });

            expect(mockMonitorStateStore.store).toHaveBeenCalledWith("nineChronicles", {
                blockHash: "BLOCK-HASH",
                txId: "TX-D",
            });

            expect(mockWrappedNcgMinter.mint.mock.calls).toEqual([
                [wrappedNcgRecipient, 100],
                [wrappedNcgRecipient, 120],
                [wrappedNcgRecipient, 1],
                [wrappedNcgRecipient, 322],
            ]);
        });

        for (const invalidMemo of ["0x", "", "0x4029bC50b4747A037d38CF2197bCD335e22Ca301a"]) {
            it(`should refund with invalid memo, ${invalidMemo}`, async () => {
                await observer.notify({
                    blockHash: "BLOCK-HASH",
                    events: [
                        {
                            amount: "1.11",
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
                    "1.11",
                    "I'm bridge and you should transfer with memo having ethereum address to receive.");
            });
        }

        it("slack message - snapshot", async () => {
            await observer.notify({
                blockHash: "BLOCK-HASH",
                events: [
                    {
                        amount: "1.23",
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
    })
})
