import {
    FailoverHeadlessGraphQLClient,
    createFailoverClient,
    isMissingTxExecutionError,
} from "../src/failover-headless-graphql-client";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";

const missingTxExecution = [
    {
        message: "Error trying to resolve field 'transferNCGHistories'.",
        path: ["transferNCGHistories"],
        extensions: { code: "INVALID_OPERATION" },
    },
];

function fakeClient(
    endpoint: string,
    events: jest.Mock = jest.fn().mockResolvedValue([])
): IHeadlessGraphQLClient {
    return {
        endpoint,
        getNCGTransferredEvents: events,
        getTipIndex: jest.fn().mockResolvedValue(1),
        getBlockHash: jest.fn().mockResolvedValue("hash"),
        getBlockIndex: jest.fn().mockResolvedValue(1),
        getNextTxNonce: jest.fn().mockResolvedValue(1),
        getGenesisHash: jest.fn().mockResolvedValue("genesis"),
        transfer: jest.fn().mockResolvedValue("txid"),
        createUnsignedTx: jest.fn().mockResolvedValue("unsigned"),
        attachSignature: jest.fn().mockResolvedValue("signed"),
        stageTx: jest.fn().mockResolvedValue(true),
    } as unknown as IHeadlessGraphQLClient;
}

describe("isMissingTxExecutionError", () => {
    it("matches INVALID_OPERATION on transferNCGHistories", () => {
        expect(isMissingTxExecutionError(missingTxExecution)).toBe(true);
    });

    it.each([
        [new Error("timeout")],
        [undefined],
        [[{ path: ["other"], extensions: { code: "INVALID_OPERATION" } }]],
        [
            [
                {
                    path: ["transferNCGHistories"],
                    extensions: { code: "UNAUTHENTICATED" },
                },
            ],
        ],
    ])("does not match %p", (error) => {
        expect(isMissingTxExecutionError(error)).toBe(false);
    });
});

describe("FailoverHeadlessGraphQLClient", () => {
    let warn: jest.SpyInstance;
    let error: jest.SpyInstance;
    beforeEach(() => {
        warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        error = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    it("does not touch fallbacks when the primary succeeds", async () => {
        const events = [{ txId: "a" }];
        const primary = fakeClient(
            "primary",
            jest.fn().mockResolvedValue(events)
        );
        const fallback = fakeClient("fallback");
        const client = new FailoverHeadlessGraphQLClient(primary, [fallback]);

        await expect(client.getNCGTransferredEvents("h", "r")).resolves.toBe(
            events
        );
        expect(fallback.getNCGTransferredEvents).not.toHaveBeenCalled();
    });

    it("serves the block from the next node when TxExecution is missing", async () => {
        const events = [{ txId: "a" }];
        const primary = fakeClient(
            "primary",
            jest.fn().mockRejectedValue(missingTxExecution)
        );
        const bad = fakeClient(
            "bad",
            jest.fn().mockRejectedValue(missingTxExecution)
        );
        const good = fakeClient("good", jest.fn().mockResolvedValue(events));
        const client = new FailoverHeadlessGraphQLClient(primary, [bad, good]);

        await expect(client.getNCGTransferredEvents("h", "r")).resolves.toBe(
            events
        );
        expect(good.getNCGTransferredEvents).toHaveBeenCalledWith("h", "r");
    });

    it("does not fail over (but alerts) for other primary errors", async () => {
        const boom = new Error("ECONNREFUSED");
        const primary = fakeClient(
            "primary",
            jest.fn().mockRejectedValue(boom)
        );
        const fallback = fakeClient("fallback");
        const alert = jest.fn();
        const client = new FailoverHeadlessGraphQLClient(primary, [fallback], {
            alert,
        });

        await expect(client.getNCGTransferredEvents("h", "r")).rejects.toBe(
            boom
        );
        expect(fallback.getNCGTransferredEvents).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
    });

    it("rethrows (never skips) and alerts once per block when every node fails", async () => {
        const alert = jest.fn();
        let now = 0;
        const primary = fakeClient(
            "primary",
            jest.fn().mockRejectedValue(missingTxExecution)
        );
        const fallback = fakeClient(
            "fallback",
            jest.fn().mockRejectedValue(new Error("down"))
        );
        const client = new FailoverHeadlessGraphQLClient(primary, [fallback], {
            alert,
            alertCooldownMs: 1000,
            now: () => now,
        });

        await expect(client.getNCGTransferredEvents("h", "r")).rejects.toBe(
            missingTxExecution
        );
        now = 500;
        await expect(client.getNCGTransferredEvents("h", "r")).rejects.toBe(
            missingTxExecution
        );
        expect(alert).toHaveBeenCalledTimes(1);
        const [summary, details] = alert.mock.calls[0];
        expect(summary).toContain("h");
        expect(details.blockHash).toBe("h");
        expect(details.failures.primary).toContain("INVALID_OPERATION");
        expect(details.failures.primary).toContain("transferNCGHistories");
        expect(details.failures.fallback).toContain("down");

        now = 1500;
        await expect(client.getNCGTransferredEvents("h", "r")).rejects.toBe(
            missingTxExecution
        );
        expect(alert).toHaveBeenCalledTimes(2);

        await expect(client.getNCGTransferredEvents("other", "r")).rejects.toBe(
            missingTxExecution
        );
        expect(alert).toHaveBeenCalledTimes(3);
    });

    it("keeps signing/staging calls on the primary", async () => {
        const primary = fakeClient("primary");
        const fallback = fakeClient("fallback");
        const client = new FailoverHeadlessGraphQLClient(primary, [fallback]);

        await client.getNextTxNonce("a");
        await client.stageTx("p");
        await client.transfer("r", "1", 1, null);
        await client.getTipIndex();

        expect(primary.getNextTxNonce).toHaveBeenCalled();
        expect(primary.stageTx).toHaveBeenCalled();
        expect(primary.transfer).toHaveBeenCalled();
        expect(fallback.getNextTxNonce).not.toHaveBeenCalled();
        expect(fallback.stageTx).not.toHaveBeenCalled();
        expect(fallback.transfer).not.toHaveBeenCalled();
        expect(client.endpoint).toBe("primary");
    });
});

describe("createFailoverClient", () => {
    it.each([[undefined], [""], [" , "]])(
        "wraps with no fallbacks (alerts still work) for %p",
        async (fallbackEndpoints) => {
            const alert = jest.fn();
            const boom = new Error("ECONNREFUSED");
            const primary = fakeClient(
                "primary",
                jest.fn().mockRejectedValue(boom)
            );
            jest.spyOn(console, "error").mockImplementation(() => {});
            const client = createFailoverClient({
                primary,
                fallbackEndpoints,
                createFallback: fakeClient,
                alert,
            });
            expect(client).toBeInstanceOf(FailoverHeadlessGraphQLClient);
            await expect(client.getNCGTransferredEvents("h", "r")).rejects.toBe(
                boom
            );
            expect(alert).toHaveBeenCalledTimes(1);
        }
    );

    it("builds one fallback per listed endpoint", () => {
        const created: string[] = [];
        createFailoverClient({
            primary: fakeClient("primary"),
            fallbackEndpoints: "https://a/graphql, https://b/graphql",
            createFallback: (e) => {
                created.push(e);
                return fakeClient(e);
            },
        });
        expect(created).toEqual(["https://a/graphql", "https://b/graphql"]);
    });
});
