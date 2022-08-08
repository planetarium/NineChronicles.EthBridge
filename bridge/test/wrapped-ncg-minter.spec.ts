import { WrappedNCGMinter } from "../src/wrapped-ncg-minter";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";
import Decimal from "decimal.js";
import Web3 from "web3";
import PromiEvent from "web3-core-promievent";
import { IGasPricePolicy } from "../src/policies/gas-price";

describe(WrappedNCGMinter.name, () => {
    const mockHeadlessGraphQlClient: jest.Mocked<IHeadlessGraphQLClient> = {
        endpoint: "http://localhost:23061/graphql",
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
        send: jest.fn(() => {
            const event = PromiEvent<string>(false);
            setTimeout(() => {
                event.eventEmitter.emit("transactionHash", "TX-ID");
                event.resolve("TX-ID");
            }, 10);
            return event.eventEmitter;
        }),
    };

    const mockContract = {
        methods: {
            mint: jest.fn(() => mockContractMethodReturn),
        },
    };
    const mockGasPrice = "100";

    const mockWeb3 = {
        eth: {
            getGasPrice: jest.fn(() => Promise.resolve(mockGasPrice)),
            Contract: jest.fn(() => mockContract),
        },
        utils: {
            toBN: jest.fn(parseInt),
            toWei: jest.fn((value, unit) => {
                if (unit === "gwei") {
                    return (parseFloat(value) * 1000000000).toFixed(0);
                }
            }),
        },
    };
    const mockGasPricePolicy: IGasPricePolicy = {
        calculateGasPrice: jest.fn().mockImplementation((x) => x * 1.5),
    };
    const mockMinterAddress = "0x0000000000000000000000000000000000000000";
    const wrappedNcgMinter = new WrappedNCGMinter(
        mockWeb3 as unknown as Web3,
        { abi: [], address: "" },
        mockMinterAddress,
        mockGasPricePolicy,
        new Decimal("1")
    );

    describe(WrappedNCGMinter.prototype.mint.name, () => {
        it("should mint", async () => {
            await wrappedNcgMinter.mint(
                "0x1111111111111111111111111111111111111111",
                new Decimal(10)
            );
            expect(mockContract.methods.mint).toHaveBeenCalledWith(
                "0x1111111111111111111111111111111111111111",
                10
            );
            expect(mockContractMethodReturn.send).toHaveBeenCalledWith({
                from: mockMinterAddress,
                gasPrice: 150,
            });
        });
    });
});
