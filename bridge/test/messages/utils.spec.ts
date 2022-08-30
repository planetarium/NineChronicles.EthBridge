import { combineNcExplorerUrl, combineUrl } from "../../src/messages/utils";

describe(combineUrl.name, () => {
    it("with query", () => {
        expect(
            combineUrl(
                "https://explorer.libplanet.io/9c-internal/",
                "/transaction",
                "TX-ID"
            )
        ).toEqual(
            "https://explorer.libplanet.io/9c-internal/transaction?TX-ID"
        );
    });

    it("without query", () => {
        expect(combineUrl("https://9cscan.com/", "/tx/TX-ID")).toEqual(
            "https://9cscan.com/tx/TX-ID"
        );
    });
});

describe(combineNcExplorerUrl.name, () => {
    it("with explorer", () => {
        expect(
            combineNcExplorerUrl(
                "https://explorer.libplanet.io/9c-internal/",
                "https://9cscan.com/",
                false,
                "TX-ID"
            )
        ).toEqual(
            "https://explorer.libplanet.io/9c-internal/transaction?TX-ID"
        );
    });

    it("with ncscan", () => {
        expect(
            combineNcExplorerUrl(
                "https://explorer.libplanet.io/9c-internal/",
                "https://9cscan.com/",
                true,
                "TX-ID"
            )
        ).toEqual("https://9cscan.com/tx/TX-ID");
    });

    it("requires ncscanUrl argument when useNcscan is true", () => {
        expect(() =>
            combineNcExplorerUrl(
                "https://explorer.libplanet.io/9c-internal/",
                undefined,
                true,
                "TX-ID"
            )
        ).toThrowError("ncscanUrl is undefined");
    });
});
