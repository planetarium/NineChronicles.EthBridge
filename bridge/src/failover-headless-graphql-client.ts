import util from "util";
import { URL } from "url";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { NCGTransferredEvent } from "./types/ncg-transferred-event";
import { BlockTransaction } from "./types/block-transaction";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";
import { Severity } from "./integrations";
import { verifyFallbackEvents } from "./fallback-event-verifier";

/**
 * `transferNCGHistories` reads the stored TxExecution of every transfer in the
 * block. A node whose tx execution store was wiped (volume clone / rotation,
 * snapshot restore) answers, for the blocks it lacks, with
 *
 *   extensions: { code: "INVALID_OPERATION",
 *                 data: { message: "TxExecution <txid> not found." } }
 *
 * although the chain data itself is intact. Other nodes that still have the
 * records can answer the same query.
 */
export function isMissingTxExecutionError(error: unknown): boolean {
    if (!Array.isArray(error)) {
        return false;
    }

    return error.some(
        (e) =>
            e?.extensions?.code === "INVALID_OPERATION" &&
            Array.isArray(e?.path) &&
            e.path[0] === "transferNCGHistories" &&
            /^TxExecution [0-9a-f]+ not found/i.test(
                String(e?.extensions?.data?.message ?? "")
            )
    );
}

function describe(error: unknown): string {
    return util.inspect(error, { depth: 6, breakLength: Infinity });
}

export type FailoverAlert = (
    summary: string,
    details: Record<string, any>,
    severity: Severity
) => void;

export interface FailoverOptions {
    readonly alert?: FailoverAlert;
    /** Minimum interval between "stuck" alerts for the same block. */
    readonly alertCooldownMs?: number;
    /** Minimum interval between "failover is in use" alerts. */
    readonly successAlertCooldownMs?: number;
    readonly now?: () => number;
}

/**
 * Chain *reads* go to the primary node; only `getNCGTransferredEvents` falls
 * over to the fallback nodes, and only when the primary reports missing
 * TxExecution records. Everything that signs/stages transactions (nonce,
 * stage, transfer, ...) always stays on the primary.
 *
 * Fallback nodes are not trusted blindly: their events are cross-checked
 * against the original transactions stored in the primary's block, and any
 * mismatch rejects that fallback's answer.
 *
 * When no node can serve the block the error is rethrown, so the caller's
 * cursor does not advance (the block is retried, never skipped), and an alert
 * is raised.
 */
export class FailoverHeadlessGraphQLClient implements IHeadlessGraphQLClient {
    private readonly _primary: IHeadlessGraphQLClient;
    private readonly _fallbacks: readonly IHeadlessGraphQLClient[];
    private readonly _alert?: FailoverAlert;
    private readonly _alertCooldownMs: number;
    private readonly _successAlertCooldownMs: number;
    private readonly _now: () => number;
    private readonly _lastAlertAt = new Map<string, number>();
    private _failoverCount = 0;
    private _failoverCountAtLastAlert = 0;
    private _lastSuccessAlertAt: number | undefined;

    constructor(
        primary: IHeadlessGraphQLClient,
        fallbacks: readonly IHeadlessGraphQLClient[],
        options: FailoverOptions = {}
    ) {
        this._primary = primary;
        this._fallbacks = fallbacks;
        this._alert = options.alert;
        this._alertCooldownMs = options.alertCooldownMs ?? 10 * 60 * 1000;
        this._successAlertCooldownMs =
            options.successAlertCooldownMs ?? 60 * 60 * 1000;
        this._now = options.now ?? Date.now;
    }

    get endpoint(): string {
        return this._primary.endpoint;
    }

    /** Number of blocks served by a fallback since start. */
    get failoverCount(): number {
        return this._failoverCount;
    }

    async getNCGTransferredEvents(
        blockHash: BlockHash,
        recipient: string
    ): Promise<NCGTransferredEvent[]> {
        try {
            return await this._primary.getNCGTransferredEvents(
                blockHash,
                recipient
            );
        } catch (primaryError) {
            if (
                this._fallbacks.length === 0 ||
                !isMissingTxExecutionError(primaryError)
            ) {
                // Nothing to fail over to: the caller will retry this same
                // block (cursor not advanced). Make the stall visible.
                // Only "info" unless the primary is missing TxExecution: a
                // transient error (ECONNREFUSED, timeout) is covered by node
                // monitoring, and the bridge simply retries the block.
                this.raiseStuckAlert(
                    blockHash,
                    { [this._primary.endpoint]: describe(primaryError) },
                    isMissingTxExecutionError(primaryError) ? "warning" : "info"
                );
                throw primaryError;
            }

            console.warn(
                `[FailoverHeadlessGraphQLClient] ${
                    this._primary.endpoint
                } has no TxExecution for block ${blockHash}; trying fallbacks. detail: ${describe(
                    primaryError
                )}`
            );

            const failures: Record<string, string> = {
                [this._primary.endpoint]: describe(primaryError),
            };
            for (const fallback of this._fallbacks) {
                try {
                    const events = await fallback.getNCGTransferredEvents(
                        blockHash,
                        recipient
                    );
                    const rejection = await this.verify(
                        blockHash,
                        recipient,
                        events
                    );
                    if (rejection !== null) {
                        failures[fallback.endpoint] = rejection;
                        continue;
                    }

                    this.noteFailover(blockHash, fallback.endpoint);
                    return events;
                } catch (fallbackError) {
                    failures[fallback.endpoint] = describe(fallbackError);
                }
            }

            this.raiseStuckAlert(blockHash, failures, "warning");
            throw primaryError;
        }
    }

    /** Returns null when verified, otherwise the reason it was rejected. */
    private async verify(
        blockHash: BlockHash,
        recipient: string,
        events: NCGTransferredEvent[]
    ): Promise<string | null> {
        let transactions: BlockTransaction[];
        try {
            transactions = await this._primary.getBlockTransactions(blockHash);
        } catch (error) {
            return `cannot verify against the primary's block: ${describe(
                error
            )}`;
        }

        const result = verifyFallbackEvents(events, transactions, {
            blockHash,
            recipient,
        });
        if (!result.ok) {
            return `rejected, events do not match the primary's transactions: ${result.reasons.join(
                "; "
            )}`;
        }

        if (result.unreportedTxIds.length > 0) {
            this.alertOnce(
                `unreported:${blockHash}`,
                `Fallback did not report ${result.unreportedTxIds.length} transfer(s) to the bridge in block ${blockHash} (failed transactions, or omitted deposits?). Please review manually.`,
                { blockHash, txIds: result.unreportedTxIds },
                "warning"
            );
        }
        return null;
    }

    private noteFailover(blockHash: BlockHash, endpoint: string): void {
        this._failoverCount += 1;
        console.warn(
            `[FailoverHeadlessGraphQLClient] block ${blockHash} served by fallback ${endpoint} (total ${this._failoverCount})`
        );

        // Not one alert per block: while the primary lacks TxExecution the
        // bridge may fail over on many consecutive blocks.
        const now = this._now();
        if (
            this._lastSuccessAlertAt !== undefined &&
            now - this._lastSuccessAlertAt < this._successAlertCooldownMs
        ) {
            return;
        }
        this._lastSuccessAlertAt = now;
        const since = this._failoverCount - this._failoverCountAtLastAlert;
        this._failoverCountAtLastAlert = this._failoverCount;
        this.send(
            `Bridge is reading NCG transfers from fallback ${endpoint}: the primary ${this._primary.endpoint} lacks TxExecution records (${since} block(s) since the last report)`,
            { blockHash, endpoint, blocksSinceLastReport: since },
            "info"
        );
    }

    private raiseStuckAlert(
        blockHash: BlockHash,
        failures: Record<string, string>,
        severity: Severity
    ): void {
        console.error(
            `[FailoverHeadlessGraphQLClient] no node could serve block ${blockHash}`,
            failures
        );
        this.alertOnce(
            `stuck:${blockHash}`,
            `Bridge may be stuck: no node could serve transferNCGHistories for block ${blockHash}`,
            { blockHash, failures },
            severity
        );
    }

    private alertOnce(
        key: string,
        summary: string,
        details: Record<string, any>,
        severity: Severity
    ): void {
        const now = this._now();
        const last = this._lastAlertAt.get(key);
        if (last !== undefined && now - last < this._alertCooldownMs) {
            return;
        }
        this._lastAlertAt.set(key, now);
        this.send(summary, details, severity);
    }

    private send(
        summary: string,
        details: Record<string, any>,
        severity: Severity
    ): void {
        try {
            this._alert?.(summary, details, severity);
        } catch (alertError) {
            console.error(
                "[FailoverHeadlessGraphQLClient] alert failed:",
                alertError
            );
        }
    }

    getBlockIndex(blockHash: BlockHash): Promise<number> {
        return this._primary.getBlockIndex(blockHash);
    }

    getTipIndex(): Promise<number> {
        return this._primary.getTipIndex();
    }

    getBlockHash(index: number): Promise<BlockHash> {
        return this._primary.getBlockHash(index);
    }

    getBlockTransactions(blockHash: BlockHash): Promise<BlockTransaction[]> {
        return this._primary.getBlockTransactions(blockHash);
    }

    getNextTxNonce(address: string): Promise<number> {
        return this._primary.getNextTxNonce(address);
    }

    getGenesisHash(): Promise<string> {
        return this._primary.getGenesisHash();
    }

    transfer(
        recipient: string,
        amount: string,
        txNonce: number,
        memo: string | null
    ): Promise<TxId> {
        return this._primary.transfer(recipient, amount, txNonce, memo);
    }

    createUnsignedTx(plainValue: string, publicKey: string): Promise<string> {
        return this._primary.createUnsignedTx(plainValue, publicKey);
    }

    attachSignature(unsignedTx: string, signature: string): Promise<string> {
        return this._primary.attachSignature(unsignedTx, signature);
    }

    stageTx(payload: string): Promise<boolean> {
        return this._primary.stageTx(payload);
    }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Fallback nodes are outside our control, so their endpoint must be https
 * (loopback is allowed for local development).
 */
export function assertSecureFallbackEndpoint(endpoint: string): void {
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error(`Invalid fallback GraphQL endpoint: ${endpoint}`);
    }
    if (url.protocol !== "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
        throw new Error(
            `Fallback GraphQL endpoint must use https (got ${url.protocol}//${url.host})`
        );
    }
}

export interface FailoverFactoryParams {
    readonly primary: IHeadlessGraphQLClient;
    /** Comma-separated endpoint list; empty/undefined means no fallbacks (alerting still applies). */
    readonly fallbackEndpoints: string | undefined;
    readonly createFallback: (endpoint: string) => IHeadlessGraphQLClient;
    readonly alert?: FailoverAlert;
}

export function createFailoverClient(
    params: FailoverFactoryParams
): IHeadlessGraphQLClient {
    const endpoints = (params.fallbackEndpoints ?? "")
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
    endpoints.forEach(assertSecureFallbackEndpoint);

    return new FailoverHeadlessGraphQLClient(
        params.primary,
        endpoints.map(params.createFallback),
        { alert: params.alert }
    );
}
