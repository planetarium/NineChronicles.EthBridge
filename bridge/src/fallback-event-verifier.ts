import { NCGTransferredEvent } from "./types/ncg-transferred-event";
import { BlockTransaction } from "./types/block-transaction";

const NCG_MINTER = "0x47d082a115c63e7b58b1532d20e631538eafadde";

interface RawTransfer {
    txId: string;
    sender: string;
    recipient: string;
    units: bigint;
    decimalPlaces: number;
    memo: string | null;
}

// Bencodex JSON puts a BOM (U+FEFF) in front of every key and string value.
function stripBom(value: unknown): unknown {
    if (typeof value === "string") {
        return value.replace(/﻿/g, "");
    }
    if (Array.isArray(value)) {
        return value.map(stripBom);
    }
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([k, v]) => [
                stripBom(k) as string,
                stripBom(v),
            ])
        );
    }
    return value;
}

function parseTransfer(txId: string, json: string): RawTransfer | null {
    let action: any;
    try {
        action = stripBom(JSON.parse(json));
    } catch {
        return null;
    }

    if (
        typeof action?.type_id !== "string" ||
        !/^transfer_asset\d*$/.test(action.type_id)
    ) {
        return null;
    }

    const values = action.values;
    const amount = values?.amount;
    if (!Array.isArray(amount) || amount.length !== 2) {
        return null;
    }
    const [currency, rawUnits] = amount;
    const minters: unknown = currency?.minters;
    if (
        currency?.ticker !== "NCG" ||
        !Array.isArray(minters) ||
        !minters.some(
            (m) => typeof m === "string" && m.toLowerCase() === NCG_MINTER
        )
    ) {
        return null;
    }

    const decimalPlaces =
        typeof currency.decimalPlaces === "number"
            ? currency.decimalPlaces
            : Number.parseInt(String(currency.decimalPlaces), 16);
    if (
        !Number.isInteger(decimalPlaces) ||
        typeof rawUnits !== "string" ||
        !/^\d+$/.test(rawUnits) ||
        typeof values.sender !== "string" ||
        typeof values.recipient !== "string"
    ) {
        return null;
    }

    return {
        txId: txId.toLowerCase(),
        sender: values.sender.toLowerCase(),
        recipient: values.recipient.toLowerCase(),
        units: BigInt(rawUnits),
        decimalPlaces,
        memo: typeof values.memo === "string" ? values.memo : null,
    };
}

function toUnits(amount: string, decimalPlaces: number): bigint | null {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(amount);
    if (match === null) {
        return null;
    }
    const fraction = match[2] ?? "";
    if (fraction.length > decimalPlaces) {
        return null;
    }
    return BigInt(match[1] + fraction.padEnd(decimalPlaces, "0"));
}

export interface VerificationResult {
    readonly ok: boolean;
    /** Why events were rejected (empty when ok). */
    readonly reasons: string[];
    /**
     * Transfers to the recipient found in the primary's block that the fallback
     * did not report. Usually failed transactions, but could be omitted
     * deposits, so they are surfaced for a human.
     */
    readonly unreportedTxIds: string[];
}

/**
 * Cross-checks events served by an untrusted fallback node against the
 * transactions stored in the primary's block. The primary lacks execution
 * results but still has the original transactions, so every event must match
 * a real NCG transfer action (tx id, sender, recipient, amount, memo) and be
 * claimed at most once. This stops a fallback from fabricating deposits; it
 * cannot tell whether a real transfer succeeded (that is what the fallback is
 * trusted for).
 */
export function verifyFallbackEvents(
    events: readonly NCGTransferredEvent[],
    transactions: readonly BlockTransaction[],
    context: { blockHash: string; recipient: string }
): VerificationResult {
    const transfers: RawTransfer[] = [];
    for (const tx of transactions) {
        for (const json of tx.actionJsons) {
            const transfer = parseTransfer(tx.id, json);
            if (transfer !== null) {
                transfers.push(transfer);
            }
        }
    }

    const used = new Set<number>();
    const reasons: string[] = [];
    const recipient = context.recipient.toLowerCase();

    for (const event of events) {
        if (
            event.blockHash !== undefined &&
            event.blockHash !== null &&
            event.blockHash.toLowerCase() !== context.blockHash.toLowerCase()
        ) {
            reasons.push(`event ${event.txId}: blockHash mismatch`);
            continue;
        }
        if (event.recipient?.toLowerCase() !== recipient) {
            reasons.push(`event ${event.txId}: unexpected recipient`);
            continue;
        }

        const index = transfers.findIndex(
            (t, i) =>
                !used.has(i) &&
                t.txId === event.txId?.toLowerCase() &&
                t.sender === event.sender?.toLowerCase() &&
                t.recipient === recipient &&
                t.memo === (event.memo ?? null) &&
                t.units === toUnits(String(event.amount), t.decimalPlaces)
        );
        if (index === -1) {
            reasons.push(
                `event ${event.txId}: no matching transfer in the primary's block`
            );
            continue;
        }
        used.add(index);
    }

    const unreportedTxIds = transfers
        .filter((t, i) => !used.has(i) && t.recipient === recipient)
        .map((t) => t.txId);

    return { ok: reasons.length === 0, reasons, unreportedTxIds };
}
