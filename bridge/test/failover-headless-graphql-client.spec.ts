import {
    FailoverHeadlessGraphQLClient,
    assertSecureFallbackEndpoint,
    createFailoverClient,
    isMissingTxExecutionError,
} from "../src/failover-headless-graphql-client";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";
import {
    BLOCK_HASH,
    RECIPIENT,
    blockTransactions,
    goodEvent,
    missingTxExecution,
} from "./fixtures-failover";

function fakeClient(
    endpoint: string,
    events: jest.Mock = jest.fn().mockResolvedValue([]),
    transactions: jest.Mock = jest.fn().mockResolvedValue(blockTransactions)
): IHeadlessGraphQLClient {
    return {
        endpoint,
        getNCGTransferredEvents: events,
        getBlockTransactions: transactions,
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

const failing = (e: unknown) => jest.fn().mockRejectedValue(e);
const serving = (events: unknown[]) => jest.fn().mockResolvedValue(events);

describe("isMissingTxExecutionError", () => {
    it("matches the real TxExecution-not-found error", () => {
        expect(isMissingTxExecutionError(missingTxExecution)).toBe(true);
    });

    const withData = (data: unknown, code = "INVALID_OPERATION") => [
        {
            path: ["transferNCGHistories"],
            extensions: { code, data },
        },
    ];

    it.each([
        [new Error("timeout")],
        [undefined],
        [withData({ message: "something else entirely" })],
        [withData(undefined)],
        [
            withData(
                { message: "TxExecution ea91 not found." },
                "UNAUTHENTICATED"
            ),
        ],
        [
            [
                {
                    path: ["other"],
                    extensions: {
                        code: "INVALID_OPERATION",
                        data: { message: "TxExecution ea91 not found." },
                    },
                },
            ],
        ],
    ])("does not match %p", (error) => {
        expect(isMissingTxExecutionError(error)).toBe(false);
    });
});

describe("FailoverHeadlessGraphQLClient", () => {
    let error: jest.SpyInstance;
    beforeEach(() => {
        jest.spyOn(console, "warn").mockImplementation(() => {});
        error = jest.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    const ask = (c: IHeadlessGraphQLClient, hash = BLOCK_HASH) =>
        c.getNCGTransferredEvents(hash, RECIPIENT);

    it("does not touch fallbacks when the primary succeeds", async () => {
        const events = [goodEvent];
        const fallback = fakeClient("fallback");
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", serving(events)),
            [fallback]
        );

        await expect(ask(client)).resolves.toBe(events);
        expect(fallback.getNCGTransferredEvents).not.toHaveBeenCalled();
        expect(client.failoverCount).toBe(0);
    });

    it("serves the block from a verified fallback when TxExecution is missing", async () => {
        const bad = fakeClient("https://bad", failing(missingTxExecution));
        const good = fakeClient("https://good", serving([goodEvent]));
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [bad, good]
        );

        await expect(ask(client)).resolves.toEqual([goodEvent]);
        expect(client.failoverCount).toBe(1);
    });

    it("rejects a fallback whose events do not match the primary's transactions", async () => {
        const alert = jest.fn();
        const forged = { ...goodEvent, amount: "500000" };
        const liar = fakeClient("https://liar", serving([forged]));
        const honest = fakeClient("https://honest", serving([goodEvent]));
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [liar, honest],
            { alert }
        );

        await expect(ask(client)).resolves.toEqual([goodEvent]);
        expect(client.failoverCount).toBe(1);
    });

    it("never returns forged events when every fallback lies", async () => {
        const alert = jest.fn();
        const forged = { ...goodEvent, amount: "500000" };
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [fakeClient("https://liar", serving([forged]))],
            { alert }
        );

        await expect(ask(client)).rejects.toBe(missingTxExecution);
        const [, details] = alert.mock.calls[0];
        expect(details.failures["https://liar"]).toContain("rejected");
        expect(client.failoverCount).toBe(0);
    });

    it("treats a fallback as failed when the primary's block cannot be read", async () => {
        const alert = jest.fn();
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient(
                "primary",
                failing(missingTxExecution),
                failing(new Error("block unavailable"))
            ),
            [fakeClient("https://good", serving([goodEvent]))],
            { alert }
        );

        await expect(ask(client)).rejects.toBe(missingTxExecution);
        expect(alert.mock.calls[0][1].failures["https://good"]).toContain(
            "cannot verify"
        );
    });

    it("alerts when the fallback did not report a transfer to the bridge", async () => {
        const alert = jest.fn();
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [fakeClient("https://good", serving([]))],
            { alert }
        );

        await expect(ask(client)).resolves.toEqual([]);
        const summaries = alert.mock.calls.map(([s]) => s as string);
        expect(summaries.some((s) => s.includes("did not report"))).toBe(true);
    });

    it("reports failover usage at most once per cooldown with a running count", async () => {
        const alert = jest.fn();
        let now = 0;
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [fakeClient("https://good", serving([goodEvent]))],
            { alert, successAlertCooldownMs: 1000, now: () => now }
        );
        const usage = () =>
            alert.mock.calls.filter(([s]) =>
                s.includes("fallback https://good")
            );

        await ask(client);
        now = 500;
        await ask(client);
        expect(usage()).toHaveLength(1);
        expect(usage()[0][1].blocksSinceLastReport).toBe(1);

        now = 1500;
        await ask(client);
        expect(usage()).toHaveLength(2);
        expect(usage()[1][1].blocksSinceLastReport).toBe(2);
        expect(client.failoverCount).toBe(3);
    });

    it("does not fail over (but alerts) for other primary errors", async () => {
        const boom = new Error("ECONNREFUSED");
        const fallback = fakeClient("fallback");
        const alert = jest.fn();
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(boom)),
            [fallback],
            { alert }
        );

        await expect(ask(client)).rejects.toBe(boom);
        expect(fallback.getNCGTransferredEvents).not.toHaveBeenCalled();
        expect(alert).toHaveBeenCalledTimes(1);
    });

    it("rethrows (never skips) and alerts once per block when every node fails", async () => {
        const alert = jest.fn();
        let now = 0;
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [fakeClient("fallback", failing(new Error("down")))],
            { alert, alertCooldownMs: 1000, now: () => now }
        );

        await expect(ask(client)).rejects.toBe(missingTxExecution);
        now = 500;
        await expect(ask(client)).rejects.toBe(missingTxExecution);
        expect(alert).toHaveBeenCalledTimes(1);
        const [summary, details] = alert.mock.calls[0];
        expect(summary).toContain(BLOCK_HASH);
        expect(details.failures.primary).toContain("TxExecution");
        expect(details.failures.fallback).toContain("down");

        now = 1500;
        await expect(ask(client)).rejects.toBe(missingTxExecution);
        expect(alert).toHaveBeenCalledTimes(2);

        await expect(ask(client, "other")).rejects.toBe(missingTxExecution);
        expect(alert).toHaveBeenCalledTimes(3);
    });

    it("keeps every other call on the primary", async () => {
        const primary = fakeClient("primary");
        const fallback = fakeClient("fallback");
        const client = new FailoverHeadlessGraphQLClient(primary, [fallback]);

        await client.getBlockIndex("h");
        await client.getTipIndex();
        await client.getBlockHash(1);
        await client.getBlockTransactions("h");
        await client.getNextTxNonce("a");
        await client.getGenesisHash();
        await client.transfer("r", "1", 1, null);
        await client.createUnsignedTx("p", "k");
        await client.attachSignature("u", "s");
        await client.stageTx("p");

        for (const method of [
            "getBlockIndex",
            "getTipIndex",
            "getBlockHash",
            "getBlockTransactions",
            "getNextTxNonce",
            "getGenesisHash",
            "transfer",
            "createUnsignedTx",
            "attachSignature",
            "stageTx",
        ] as const) {
            expect(primary[method]).toHaveBeenCalledTimes(1);
            expect(fallback[method]).not.toHaveBeenCalled();
        }
        expect(client.endpoint).toBe("primary");
    });

    it("still throws the original error when the alert callback throws", async () => {
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(missingTxExecution)),
            [],
            {
                alert: () => {
                    throw new Error("pagerduty down");
                },
            }
        );

        await expect(ask(client)).rejects.toBe(missingTxExecution);
        expect(error).toHaveBeenCalledWith(
            "[FailoverHeadlessGraphQLClient] alert failed:",
            expect.any(Error)
        );
    });

    it("works without an alert callback", async () => {
        const boom = new Error("x");
        const client = new FailoverHeadlessGraphQLClient(
            fakeClient("primary", failing(boom)),
            []
        );
        await expect(ask(client)).rejects.toBe(boom);
    });
});

describe("assertSecureFallbackEndpoint", () => {
    it.each([
        ["https://odin6.9capi.com/graphql"],
        ["http://localhost:23061/graphql"],
        ["http://127.0.0.1:5000/graphql"],
    ])("accepts %s", (endpoint) => {
        expect(() => assertSecureFallbackEndpoint(endpoint)).not.toThrow();
    });

    it.each([["http://odin6.9capi.com/graphql"], ["ws://example.com/graphql"]])(
        "rejects %s",
        (endpoint) => {
            expect(() => assertSecureFallbackEndpoint(endpoint)).toThrow(
                /https/
            );
        }
    );

    it("rejects unparsable endpoints", () => {
        expect(() => assertSecureFallbackEndpoint("not a url")).toThrow(
            /Invalid/
        );
    });
});

describe("createFailoverClient", () => {
    it.each([[undefined], [""], [" , "]])(
        "wraps with no fallbacks (alerts still work) for %p",
        async (fallbackEndpoints) => {
            jest.spyOn(console, "error").mockImplementation(() => {});
            const alert = jest.fn();
            const boom = new Error("ECONNREFUSED");
            const client = createFailoverClient({
                primary: fakeClient("primary", failing(boom)),
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

    it("refuses to start with an insecure fallback endpoint", () => {
        expect(() =>
            createFailoverClient({
                primary: fakeClient("primary"),
                fallbackEndpoints: "https://ok/graphql,http://evil/graphql",
                createFallback: fakeClient,
            })
        ).toThrow(/https/);
    });
});
