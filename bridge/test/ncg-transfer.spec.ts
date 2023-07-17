import { NCGTransfer } from "../src/ncg-transfer";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";

describe(NCGTransfer.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
        endpoint: "http://localhost:23061/graphql",
        getBlockHash: jest.fn(),
        getBlockIndex: jest.fn(),
        getNCGTransferredEvents: jest.fn(),
        getNextTxNonce: jest.fn((address) => Promise.resolve(0)),
        getGenesisHash: jest.fn(),
        getTipIndex: jest.fn(),
        transfer: jest.fn(),
        createUnsignedTx: jest.fn(),
        attachSignature: jest.fn(),
        stageTx: jest.fn(),
    };
    const mockAddress = "0x0000000000000000000000000000000000000000";
    const ncgTransfer = new NCGTransfer(mockHeadlessGraphQlClient, mockAddress);

    describe(NCGTransfer.prototype.transfer.name, () => {
        it("should transfer", async () => {
            await ncgTransfer.transfer(
                "0x1111111111111111111111111111111111111111",
                "1.12",
                null
            );
            expect(mockHeadlessGraphQlClient.transfer).toHaveBeenCalledWith(
                "0x1111111111111111111111111111111111111111",
                "1.12",
                0,
                null
            );
        });
    });
});
