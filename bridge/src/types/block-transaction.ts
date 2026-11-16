/** A transaction as stored in a block (no execution result needed). */
export interface BlockTransaction {
    id: string;
    signer: string;
    /** `Action.json` of each action in the transaction. */
    actionJsons: string[];
}
