import axios from "axios";
import { HeadlessGraphQLClient } from "../src/headless-graphql-client";

describe("HeadlessGraphQLClient authorization", () => {
    let post: jest.SpyInstance;
    beforeEach(() => {
        post = jest.spyOn(axios, "post").mockResolvedValue({
            data: {
                data: {
                    chainQuery: { blockQuery: { blocks: [{ index: 7 }] } },
                },
            },
        } as any);
    });
    afterEach(() => jest.restoreAllMocks());

    it("sends the JWT by default", async () => {
        await new HeadlessGraphQLClient(
            "https://own/graphql",
            0,
            "s"
        ).getTipIndex();
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
