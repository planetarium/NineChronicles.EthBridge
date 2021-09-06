import { WrappedNCGMinter } from "../src/wrapped-ncg-minter";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";
import Decimal from "decimal.js";
import Web3 from "web3";
import waitForExpect from "wait-for-expect";

describe(WrappedNCGMinter.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
        getBlockHash: jest.fn(),
        getBlockIndex: jest.fn(),
        getNCGTransferredEvents: jest.fn(),
        getNextTxNonce: jest.fn((address) => Promise.resolve(0)),
        getTipIndex: jest.fn(),
        transfer: jest.fn(),
        createUnsignedTx: jest.fn(),
        attachSignature: jest.fn(),
        stageTx: jest.fn(),
    };

    const mockContractMethodReturn = {
        send: jest.fn().mockResolvedValue({}),
    }

    const mockContract = {
        methods: {
            mint: jest.fn(() => mockContractMethodReturn),
        }
    };
    const mockGasPrice = "100";

    const mockWeb3 = {
        eth: {
            getGasPrice: jest.fn(() => Promise.resolve(mockGasPrice)),
            Contract: jest.fn(() => mockContract),
        },
        utils: {
            toBN: jest.fn(parseInt),
        }
    };
    const mockMinterAddress = "0x0000000000000000000000000000000000000000";
    const wrappedNcgMinter = new WrappedNCGMinter(mockWeb3 as unknown as Web3, {abi: [], address: ""}, mockMinterAddress, new Decimal(1.5));

    describe(WrappedNCGMinter.prototype.mint.name, () => {
        it("should mint with gas price ratio", async () => {
            const callback = jest.fn();
            const errorCallback = jest.fn();
            wrappedNcgMinter.mint("0x1111111111111111111111111111111111111111", new Decimal(10), callback, errorCallback);
            await waitForExpect(() => {
                expect(callback).toHaveBeenCalled();
                expect(errorCallback).not.toHaveBeenCalled();
                expect(mockContract.methods.mint).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", 10)
                expect(mockContractMethodReturn.send).toHaveBeenCalledWith({
                    from: mockMinterAddress,
                    gasPrice: "150",
                })
            })
        });

        it("should call error callback", async () => {
            const callback = jest.fn();
            const errorCallback = jest.fn();
            mockContractMethodReturn.send.mockRejectedValue(new Error("Hello"));
            wrappedNcgMinter.mint("0x1111111111111111111111111111111111111111", new Decimal(10), callback, errorCallback);
            await waitForExpect(() => {
                expect(errorCallback).toHaveBeenCalled();
                expect(callback).not.toHaveBeenCalled();
                expect(mockContract.methods.mint).toHaveBeenCalledWith("0x1111111111111111111111111111111111111111", 10)
                expect(mockContractMethodReturn.send).toHaveBeenCalledWith({
                    from: mockMinterAddress,
                    gasPrice: "150",
                })
            })
        });
    });
});
