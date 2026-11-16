// Captured from mainnet (block #20335118, 2026-11-16) while the bridge was stuck.
export const BLOCK_HASH =
    "875c99b9a2338d3a7703e73add1af6cc3c1e590cfc3aa3553c52819fbebbb596";
export const TX_ID =
    "ea91af5a7447d302150ffd01531bf7d4a30ed7b6c12321865208a5d3223f98ab";
export const SENDER = "0x78Dfb82ff8061BcF9aB3Ba5b11Bcf53d6b8a5263";
export const RECIPIENT = "0x6EC1Fd2c95C409747CAE6F836182666F8EC31C9C";

/** Error returned by a node lacking the TxExecution record. */
export const missingTxExecution = [
    {
        message: "Error trying to resolve field 'transferNCGHistories'.",
        locations: [{ line: 1, column: 39 }],
        path: ["transferNCGHistories"],
        extensions: {
            code: "INVALID_OPERATION",
            codes: ["INVALID_OPERATION"],
            data: {
                exception: "System.InvalidOperationException",
                message: `TxExecution ${TX_ID} not found.`,
                innerException: null,
            },
        },
    },
];

/** `Action.json` as served by the headless (note the BOM before every key/string). */
export const transferActionJson =
    '{"﻿type_id":"﻿transfer_asset5","﻿values":{"﻿amount":[{"﻿decimalPlaces":"0x02","﻿minters":["0x47d082a115c63e7b58b1532d20e631538eafadde"],"﻿ticker":"﻿NCG"},"50"],"﻿recipient":"0x6ec1fd2c95c409747cae6f836182666f8ec31c9c","﻿sender":"0x78dfb82ff8061bcf9ab3ba5b11bcf53d6b8a5263"}}';

export const hackAndSlashJson =
    '{"﻿type_id":"﻿hack_and_slash22","﻿values":{"﻿stageId":"251"}}';

export const blockTransactions = [
    { id: TX_ID, signer: SENDER, actionJsons: [transferActionJson] },
    { id: "0713167e", signer: "0xCC99", actionJsons: [hackAndSlashJson] },
];

/** What a healthy node (odin6) returns for the same block. */
export const goodEvent = {
    blockHash: BLOCK_HASH,
    txId: TX_ID,
    sender: SENDER,
    recipient: RECIPIENT,
    amount: "0.5",
    memo: null,
};
