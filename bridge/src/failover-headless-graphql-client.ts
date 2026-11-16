import util from "util";
import { IHeadlessGraphQLClient } from "./interfaces/headless-graphql-client";
import { NCGTransferredEvent } from "./types/ncg-transferred-event";
import { BlockHash } from "./types/block-hash";
import { TxId } from "./types/txid";

/**
 * `transferNCGHistories` reads the stored TxExecution of every transfer in the
 * block. A node whose tx execution store was wiped (volume clone / rotation,
 * snapshot restore) answers with `INVALID_OPERATION` ("TxExecution ... not
 * found") for the blocks it lacks, although the chain data itself is intact.
 * Other nodes that still have the records can answer the same query.
 */
export function isMissingTxExecutionError(error: unknown): boolean {
    if (!Array.isArray(error)) {
        return false;
    }

    return error.some(
        (e) =>
            e?.extensions?.code === "INVALID_OPERATION" &&
            Array.isArray(e?.path) &&
            e.path[0] === "transferNCGHistories"
    );
}

function describe(error: unknown): string {
    return util.inspect(error, { depth: 6, breakLength: Infinity });
}

export type FailoverAlert = (
    summary: string,
    details: Record<string, any>
) => void;

export interface FailoverOptions {
    readonly alert?: FailoverAlert;
    /** Minimum interval between alerts for the same block. */
    readonly alertCooldownMs?: number;
    readonly now?: () => number;
}

/**
 * Chain *reads* go to the primary node; only `getNCGTransferredEvents` falls
 * over to the fallback nodes, and only when the primary reports missing
 * execution records. Everything that signs/stages transactions (nonce, stage,
 * transfer, ...) always stays on the primary, since nodes must not be mixed
 * for those.
 *
 * When every node fails the error is rethrown, so the caller's cursor does not
 * advance (the block is retried, never skipped), and an alert is raised.
 */
export class FailoverHeadlessGraphQLClient implements IHeadlessGraphQLClient {
    private readonly _primary: IHeadlessGraphQLClient;
    private readonly _fallbacks: readonly IHeadlessGraphQLClient[];
    private readonly _alert?: FailoverAlert;
    private readonly _alertCooldownMs: number;
    private readonly _now: () => number;
    private readonly _lastAlertAt = new Map<string, number>();

    constructor(
        primary: IHeadlessGraphQLClient,
        fallbacks: readonly IHeadlessGraphQLClient[],
        options: FailoverOptions = {}
    ) {
        this._primary = primary;
        this._fallbacks = fallbacks;
        this._alert = options.alert;
        this._alertCooldownMs = options.alertCooldownMs ?? 10 * 60 * 1000;
        this._now = options.now ?? Date.now;
    }

    get endpoint(): string {
        return this._primary.endpoint;
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
                this.raiseAlert(blockHash, {
                    [this._primary.endpoint]: describe(primaryError),
                });
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
                    console.warn(
                        `[FailoverHeadlessGraphQLClient] block ${blockHash} served by fallback ${fallback.endpoint}`
                    );
                    return events;
                } catch (fallbackError) {
                    failures[fallback.endpoint] = describe(fallbackError);
                }
            }

            this.raiseAlert(blockHash, failures);
            throw primaryError;
        }
    }

    private raiseAlert(
        blockHash: BlockHash,
        failures: Record<string, string>
    ): void {
        const now = this._now();
        const last = this._lastAlertAt.get(blockHash);
        if (last !== undefined && now - last < this._alertCooldownMs) {
            return;
        }
        this._lastAlertAt.set(blockHash, now);

        const summary = `Bridge may be stuck: no node could serve transferNCGHistories for block ${blockHash}`;
        console.error(`[FailoverHeadlessGraphQLClient] ${summary}`, failures);
        try {
            this._alert?.(summary, { blockHash, failures });
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
    return new FailoverHeadlessGraphQLClient(
        params.primary,
        endpoints.map(params.createFallback),
        { alert: params.alert }
    );
}
