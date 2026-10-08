import { PendingTransactionHandler } from "../src/pending-transactions";
import { IExchangeHistoryStore } from "../src/interfaces/exchange-history-store";
import { INCGTransfer } from "../src/interfaces/ncg-transfer";
import { MultiPlanetary } from "../src/multi-planetary";
import { ISlackMessageSender } from "../src/interfaces/slack-message-sender";
import { PendingTransactionMessage } from "../src/messages/pending-transaction-message";
import { TransactionStatus } from "../src/types/transaction-status";

describe("PendingTransactionHandler", () => {
    let exchangeHistoryStore: jest.Mocked<IExchangeHistoryStore>;
    let ncgTransfer: jest.Mocked<INCGTransfer>;
    let multiPlanetary: jest.Mocked<MultiPlanetary>;
    let slackMessageSender: jest.Mocked<ISlackMessageSender>;
    let handler: PendingTransactionHandler;

    beforeEach(() => {
        exchangeHistoryStore = {
            getPendingTransactions: jest.fn(),
            getUnconfirmedTransactions: jest.fn().mockResolvedValue([]),
            updateStatus: jest.fn(),
        } as unknown as jest.Mocked<IExchangeHistoryStore>;

        ncgTransfer = {} as jest.Mocked<INCGTransfer>;
        multiPlanetary = {} as jest.Mocked<MultiPlanetary>;
        slackMessageSender = {
            sendMessage: jest.fn(),
        } as unknown as jest.Mocked<ISlackMessageSender>;

        handler = new PendingTransactionHandler(
            exchangeHistoryStore,
            ncgTransfer,
            multiPlanetary,
            slackMessageSender
        );
    });

    it("should send a message for pending transactions and update their status", async () => {
        const pendingTransactions = [
            {
                tx_id: "TX-1",
                network: "ethereum",
                amount: 100,
                sender: "sender1",
                recipient: "recipient1",
                timestamp: new Date().toISOString(),
                status: TransactionStatus.PENDING,
            },
            {
                tx_id: "TX-2",
                network: "nineChronicles",
                amount: 200,
                sender: "sender2",
                recipient: "recipient2",
                timestamp: new Date().toISOString(),
                status: TransactionStatus.PENDING,
            },
        ];

        exchangeHistoryStore.getPendingTransactions.mockResolvedValue(
            pendingTransactions
        );

        await handler.messagePendingTransactions();

        expect(slackMessageSender.sendMessage).toHaveBeenCalledWith(
            expect.any(PendingTransactionMessage)
        );
        expect(exchangeHistoryStore.updateStatus).toHaveBeenCalledTimes(2);
        expect(exchangeHistoryStore.updateStatus).toHaveBeenCalledWith(
            "TX-1",
            TransactionStatus.FAILED
        );
        expect(exchangeHistoryStore.updateStatus).toHaveBeenCalledWith(
            "TX-2",
            TransactionStatus.FAILED
        );
    });

    it("reminds about unconfirmed mints without ever failing them", async () => {
        exchangeHistoryStore.getPendingTransactions.mockResolvedValue([]);
        exchangeHistoryStore.getUnconfirmedTransactions.mockResolvedValue([
            {
                tx_id: "TX-3",
                network: "nineChronicles",
                amount: 300,
                sender: "sender3",
                recipient: "recipient3",
                timestamp: new Date().toISOString(),
                status: TransactionStatus.UNCONFIRMED,
            },
        ]);

        await handler.messagePendingTransactions();

        expect(slackMessageSender.sendMessage).toHaveBeenCalledTimes(1);
        const message = slackMessageSender.sendMessage.mock.calls[0][0];
        expect(message).toBeInstanceOf(PendingTransactionMessage);
        expect((message as unknown as { kind: string }).kind).toBe(
            "Unconfirmed"
        );
        expect(exchangeHistoryStore.updateStatus).not.toHaveBeenCalled();
    });

    it("still fails pending rows when their report cannot be sent", async () => {
        exchangeHistoryStore.getPendingTransactions.mockResolvedValue(
            Array.from({ length: 150 }, (_, i) => ({
                tx_id: `TX-${i}`,
                network: "nineChronicles",
                amount: 1,
                sender: "sender",
                recipient: "recipient",
                timestamp: new Date().toISOString(),
                status: TransactionStatus.PENDING,
            }))
        );
        slackMessageSender.sendMessage.mockRejectedValue(
            new Error("too_many_attachments")
        );

        await expect(
            handler.messagePendingTransactions()
        ).resolves.toBeUndefined();
        expect(exchangeHistoryStore.updateStatus).toHaveBeenCalledTimes(150);
        const message = slackMessageSender.sendMessage.mock
            .calls[0][0] as unknown as {
            transactions: unknown[];
            total: number;
        };
        expect(message.transactions).toHaveLength(20);
        expect(message.total).toBe(150);
    });

    it("never blocks startup on the reminder and caps its rows", async () => {
        exchangeHistoryStore.getPendingTransactions.mockResolvedValue([]);
        exchangeHistoryStore.getUnconfirmedTransactions.mockResolvedValue(
            Array.from({ length: 150 }, (_, i) => ({
                tx_id: `TX-${i}`,
                network: "nineChronicles",
                amount: 1,
                sender: "sender",
                recipient: "recipient",
                timestamp: new Date().toISOString(),
                status: TransactionStatus.UNCONFIRMED,
            }))
        );
        slackMessageSender.sendMessage.mockRejectedValue(
            new Error("too_many_attachments")
        );

        await expect(
            handler.messagePendingTransactions()
        ).resolves.toBeUndefined();
        const message = slackMessageSender.sendMessage.mock
            .calls[0][0] as unknown as {
            transactions: unknown[];
            total: number;
        };
        expect(message.transactions).toHaveLength(20);
        expect(message.total).toBe(150);
    });

    it("should not send a message if there are no pending transactions", async () => {
        exchangeHistoryStore.getPendingTransactions.mockResolvedValue([]);

        await handler.messagePendingTransactions();

        expect(slackMessageSender.sendMessage).not.toHaveBeenCalled();
        expect(exchangeHistoryStore.updateStatus).not.toHaveBeenCalled();
    });
});
