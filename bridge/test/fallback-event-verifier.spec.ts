import { verifyFallbackEvents } from "../src/fallback-event-verifier";
import {
    BLOCK_HASH,
    RECIPIENT,
    TX_ID,
    blockTransactions,
    goodEvent,
    hackAndSlashJson,
    transferActionJson,
} from "./fixtures-failover";

const ctx = { blockHash: BLOCK_HASH, recipient: RECIPIENT };
const verify = (events: any[], txs: any[] = blockTransactions) =>
    verifyFallbackEvents(events, txs, ctx);

function transferJson(overrides: {
    values?: Record<string, unknown>;
    type_id?: string;
    currency?: Record<string, unknown>;
    units?: string;
}) {
    return JSON.stringify({
        type_id: overrides.type_id ?? "transfer_asset5",
        values: {
            amount: [
                {
                    decimalPlaces: "0x02",
                    minters: ["0x47d082a115c63e7b58b1532d20e631538eafadde"],
                    ticker: "NCG",
                    ...overrides.currency,
                },
                overrides.units ?? "50",
            ],
            recipient: RECIPIENT.toLowerCase(),
            sender: "0x78dfb82ff8061bcf9ab3ba5b11bcf53d6b8a5263",
            ...overrides.values,
        },
    });
}
const txWith = (json: string) => [
    { id: TX_ID, signer: "0x1", actionJsons: [json] },
];

describe("verifyFallbackEvents", () => {
    it("accepts the real mainnet event for the real mainnet transaction", () => {
        expect(verify([goodEvent])).toEqual({
            ok: true,
            reasons: [],
            unreportedTxIds: [],
        });
    });

    it("accepts events without blockHash and an empty list for no transfers", () => {
        const { blockHash, ...noHash } = goodEvent;
        expect(verify([noHash]).ok).toBe(true);
        expect(verify([], []).ok).toBe(true);
    });

    it.each([
        ["amount", { amount: "500" }],
        ["amount precision", { amount: "0.505" }],
        ["amount format", { amount: "abc" }],
        ["sender", { sender: "0x0000000000000000000000000000000000000001" }],
        [
            "recipient",
            { recipient: "0x0000000000000000000000000000000000000002" },
        ],
        ["memo", { memo: "x" }],
        ["txId", { txId: "00".repeat(32) }],
        ["blockHash", { blockHash: "00".repeat(32) }],
    ])("rejects a fabricated %s", (_name, override) => {
        const result = verify([{ ...goodEvent, ...override }]);
        expect(result.ok).toBe(false);
        expect(result.reasons).toHaveLength(1);
    });

    it("claims each transfer at most once", () => {
        const result = verify([goodEvent, goodEvent]);
        expect(result.ok).toBe(false);
        expect(result.reasons).toHaveLength(1);
    });

    it("compares addresses and tx ids case-insensitively", () => {
        expect(
            verify([
                {
                    ...goodEvent,
                    txId: TX_ID.toUpperCase(),
                    sender: goodEvent.sender.toLowerCase(),
                    recipient: RECIPIENT.toUpperCase().replace("0X", "0x"),
                },
            ]).ok
        ).toBe(true);
    });

    it("matches memo when present", () => {
        const txs = txWith(transferJson({ values: { memo: "hello" } }));
        expect(verify([{ ...goodEvent, memo: "hello" }], txs).ok).toBe(true);
        expect(verify([{ ...goodEvent, memo: null }], txs).ok).toBe(false);
    });

    it("reports transfers to the bridge that the fallback did not report", () => {
        const result = verify([]);
        expect(result.ok).toBe(true);
        expect(result.unreportedTxIds).toEqual([TX_ID]);
    });

    it("does not report transfers to other recipients", () => {
        const txs = txWith(
            transferJson({
                values: {
                    recipient: "0x0000000000000000000000000000000000000009",
                },
            })
        );
        expect(verify([], txs).unreportedTxIds).toEqual([]);
    });

    it.each([
        ["not json", "not json"],
        ["other action", hackAndSlashJson],
        [
            "transfer_assets (multi)",
            transferJson({ type_id: "transfer_assets2" }),
        ],
        ["non-NCG ticker", transferJson({ currency: { ticker: "CRYSTAL" } })],
        ["foreign minters", transferJson({ currency: { minters: ["0xabc"] } })],
        ["no minters", transferJson({ currency: { minters: null } })],
        [
            "bad decimalPlaces",
            transferJson({ currency: { decimalPlaces: "zz" } }),
        ],
        ["bad units", transferJson({ units: "-5" })],
        ["bad sender", transferJson({ values: { sender: 1 } })],
        [
            "no amount",
            JSON.stringify({ type_id: "transfer_asset5", values: {} }),
        ],
        ["no type_id", JSON.stringify({ values: {} })],
    ])("never matches an event to %s", (_name, json) => {
        expect(verify([goodEvent], txWith(json)).ok).toBe(false);
    });

    it("accepts numeric decimalPlaces and raw (BOM-free) json", () => {
        const txs = txWith(transferJson({ currency: { decimalPlaces: 2 } }));
        expect(verify([goodEvent], txs).ok).toBe(true);
    });

    it("still parses the BOM-prefixed form", () => {
        expect(transferActionJson).toContain("﻿");
        expect(verify([goodEvent]).ok).toBe(true);
    });
});
