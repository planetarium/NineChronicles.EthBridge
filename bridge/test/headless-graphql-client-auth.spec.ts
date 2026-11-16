import axios from "axios";
import { HeadlessGraphQLClient } from "../src/headless-graphql-client";

function respond(data: unknown) {
    return { data: { data } } as any;
}

describe("HeadlessGraphQLClient", () => {
    let post: jest.SpyInstance;
    let consoleError: jest.SpyInstance;
    beforeEach(() => {
        post = jest.spyOn(axios, "post");
        consoleError = jest
            .spyOn(console, "error")
            .mockImplementation(() => {});
    });
    afterEach(() => jest.restoreAllMocks());

    const client = () =>
        new HeadlessGraphQLClient("https://own/graphql", 0, "secret");

    describe("authorization", () => {
        beforeEach(() => {
            post.mockResolvedValue(
                respond({
                    chainQuery: { blockQuery: { blocks: [{ index: 7 }] } },
                })
            );
        });

        it("sends the JWT by default", async () => {
            await client().getTipIndex();
            expect(post.mock.calls[0][2].headers.Authorization).toMatch(
                /^Bearer .+/
            );
        });

        it("omits the JWT when sendAuthorization is false", async () => {
            await new HeadlessGraphQLClient(
                "https://external/graphql",
                0,
                "s",
                false
            ).getTipIndex();
            expect(post.mock.calls[0][2].headers).not.toHaveProperty(
                "Authorization"
            );
        });
    });

    describe("queries", () => {
        it("exposes the endpoint", () => {
            expect(client().endpoint).toBe("https://own/graphql");
        });

        it("getBlockIndex", async () => {
            post.mockResolvedValue(
                respond({ chainQuery: { blockQuery: { block: { index: 3 } } } })
            );
            await expect(client().getBlockIndex("hash")).resolves.toBe(3);
            expect(post.mock.calls[0][1].variables).toEqual({ hash: "hash" });
        });

        it("getTipIndex", async () => {
            post.mockResolvedValue(
                respond({
                    chainQuery: { blockQuery: { blocks: [{ index: 9 }] } },
                })
            );
            await expect(client().getTipIndex()).resolves.toBe(9);
        });

        it("getBlockHash", async () => {
            post.mockResolvedValue(
                respond({
                    chainQuery: { blockQuery: { block: { hash: "h" } } },
                })
            );
            await expect(client().getBlockHash(4)).resolves.toBe("h");
            expect(post.mock.calls[0][1].variables).toEqual({ index: 4 });
        });

        it("getNCGTransferredEvents", async () => {
            const events = [{ txId: "t" }];
            post.mockResolvedValue(respond({ transferNCGHistories: events }));
            await expect(
                client().getNCGTransferredEvents("h", "r")
            ).resolves.toBe(events);
            expect(post.mock.calls[0][1].variables).toEqual({
                blockHash: "h",
                recipient: "r",
            });
        });

        it("getNCGTransferredEvents defaults recipient to null", async () => {
            post.mockResolvedValue(respond({ transferNCGHistories: [] }));
            await client().getNCGTransferredEvents("h");
            expect(post.mock.calls[0][1].variables.recipient).toBeNull();
        });

        it("getBlockTransactions flattens action json", async () => {
            post.mockResolvedValue(
                respond({
                    chainQuery: {
                        blockQuery: {
                            block: {
                                transactions: [
                                    {
                                        id: "t1",
                                        signer: "s1",
                                        actions: [
                                            { json: "{}" },
                                            { json: "[]" },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                })
            );
            await expect(client().getBlockTransactions("h")).resolves.toEqual([
                { id: "t1", signer: "s1", actionJsons: ["{}", "[]"] },
            ]);
            expect(post.mock.calls[0][1].variables).toEqual({ hash: "h" });
        });

        it("transfer", async () => {
            post.mockResolvedValue(respond({ transfer: "txid" }));
            await expect(client().transfer("r", "1", 2, "m")).resolves.toBe(
                "txid"
            );
            expect(post.mock.calls[0][1].variables).toEqual({
                recipient: "r",
                amount: "1",
                txNonce: 2,
                memo: "m",
            });
        });

        it("getNextTxNonce", async () => {
            post.mockResolvedValue(respond({ nextTxNonce: 5 }));
            await expect(client().getNextTxNonce("a")).resolves.toBe(5);
        });

        it("getGenesisHash", async () => {
            post.mockResolvedValue(
                respond({
                    chainQuery: { blockQuery: { block: { hash: "g" } } },
                })
            );
            await expect(client().getGenesisHash()).resolves.toBe("g");
        });

        it("createUnsignedTx", async () => {
            post.mockResolvedValue(
                respond({ transaction: { createUnsignedTx: "u" } })
            );
            await expect(client().createUnsignedTx("p", "k")).resolves.toBe(
                "u"
            );
        });

        it("attachSignature", async () => {
            post.mockResolvedValue(
                respond({ transaction: { attachSignature: "s" } })
            );
            await expect(client().attachSignature("u", "sig")).resolves.toBe(
                "s"
            );
        });

        it("stageTx", async () => {
            post.mockResolvedValue(respond({ stageTx: true }));
            await expect(client().stageTx("p")).resolves.toBe(true);
        });
    });

    describe("errors", () => {
        it("returns the response of a successful retry", async () => {
            post.mockRejectedValueOnce(
                new Error("ECONNRESET")
            ).mockResolvedValue(respond({ nextTxNonce: 8 }));
            const c = new HeadlessGraphQLClient("https://own/graphql", 1, "s");

            await expect(c.getNextTxNonce("a")).resolves.toBe(8);
            expect(post).toHaveBeenCalledTimes(2);
        });

        it("throws GraphQL errors after retrying and logs their details", async () => {
            const errors = [
                {
                    message: "boom",
                    path: ["transferNCGHistories"],
                    extensions: { code: "INVALID_OPERATION", data: { a: 1 } },
                },
            ];
            post.mockResolvedValue({ data: { errors } } as any);
            const c = new HeadlessGraphQLClient("https://own/graphql", 1, "s");

            await expect(c.getTipIndex()).rejects.toBe(errors);
            expect(post).toHaveBeenCalledTimes(2);
            const logged = consoleError.mock.calls[0][1] as string;
            expect(logged).toContain("INVALID_OPERATION");
            expect(logged).toContain("a: 1");
        });

        it("logs transport errors without deep-inspecting them", async () => {
            const transportError = new Error("ECONNRESET");
            post.mockRejectedValue(transportError);

            await expect(client().getTipIndex()).rejects.toBe(transportError);
            expect(consoleError.mock.calls[0][1]).toBe(transportError);
        });
    });
});
