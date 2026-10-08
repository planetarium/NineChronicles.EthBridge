import { WrappedNCGMinter } from "../src/wrapped-ncg-minter";
import { IHeadlessGraphQLClient } from "../src/interfaces/headless-graphql-client";
import Decimal from "decimal.js";
import Web3 from "web3";
import PromiEvent from "web3-core-promievent";
import { IGasPricePolicy } from "../src/policies/gas-price";
import { MintOutcomeUnknownError } from "../src/mint-safety";

describe(WrappedNCGMinter.name, () => {
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

    describe("mint safety", () => {
        const HASH = `0x${"cd".repeat(32)}`;
        type Outcome = { hash?: boolean; resolve?: unknown; reject?: unknown };
        function sendWith(outcome: Outcome) {
            return jest.fn(() => {
                const event = PromiEvent<unknown>(false);
                setTimeout(() => {
                    if (outcome.hash)
                        event.eventEmitter.emit("transactionHash", HASH);
                    if ("reject" in outcome) event.reject(outcome.reject);
                    else event.resolve(outcome.resolve);
                }, 1);
                return event.eventEmitter;
            });
        }
        function minterFor(
            sends: jest.Mock[],
            provider?: Record<string, unknown>
        ) {
            const methodReturns = sends.map((send) => ({ send }));
            const contract = {
                methods: { mint: jest.fn() },
            };
            for (const methodReturn of methodReturns)
                contract.methods.mint.mockReturnValueOnce(methodReturn);
            const web3 = {
                eth: {
                    getGasPrice: jest.fn(() => Promise.resolve("100")),
                    Contract: jest.fn(() => contract),
                },
                utils: { toBN: jest.fn(parseInt) },
            };
            const minter = new WrappedNCGMinter(
                web3 as unknown as Web3,
                { abi: [], address: "" },
                mockMinterAddress,
                mockGasPricePolicy,
                new Decimal("1"),
                provider === undefined
                    ? undefined
                    : {
                          provider: provider as never,
                          receipt: { maxRetry: 1, delayMs: 1 },
                          preBroadcast: { attempts: 3, delayMs: 1 },
                      }
            );
            return { minter, web3, contract };
        }
        function routing(receipt: unknown = { status: 1 }) {
            const provider = {
                broadcastAttempts: 0,
                beginReadSession: jest.fn(async () => jest.fn()),
                waitForTransaction: jest.fn().mockResolvedValue(receipt),
            };
            return provider;
        }
        const RECIPIENT = "0x1111111111111111111111111111111111111111";

        it("returns the mined receipt's transaction hash", async () => {
            const { minter } = minterFor(
                [sendWith({ hash: true, resolve: { transactionHash: HASH } })],
                routing()
            );
            await expect(minter.mint(RECIPIENT, new Decimal(1))).resolves.toBe(
                HASH
            );
        });

        it("restarts a pre-broadcast transient failure with fresh reads", async () => {
            const provider = routing();
            const { minter, web3 } = minterFor(
                [
                    sendWith({ reject: { code: "TIMEOUT" } }),
                    sendWith({ hash: true, resolve: {} }),
                ],
                provider
            );
            await expect(minter.mint(RECIPIENT, new Decimal(1))).resolves.toBe(
                HASH
            );
            expect(web3.eth.getGasPrice).toHaveBeenCalledTimes(2);
            expect(provider.beginReadSession).toHaveBeenCalledTimes(2);
        });

        it("propagates a mined revert as a definitive failure", async () => {
            const revert = Object.assign(new Error("reverted"), {
                receipt: { status: false },
            });
            const provider = routing();
            const { minter } = minterFor(
                [sendWith({ hash: true, reject: revert })],
                provider
            );
            await expect(minter.mint(RECIPIENT, new Decimal(1))).rejects.toBe(
                revert
            );
            expect(provider.waitForTransaction).not.toHaveBeenCalled();
        });

        it("waits by hash when Web3 loses track after the broadcast", async () => {
            const provider = routing({ status: 1 });
            const { minter } = minterFor(
                [
                    sendWith({
                        hash: true,
                        reject: new Error("not mined within 750 seconds"),
                    }),
                ],
                provider
            );
            await expect(minter.mint(RECIPIENT, new Decimal(1))).resolves.toBe(
                HASH
            );
            expect(provider.waitForTransaction).toHaveBeenCalledWith(
                HASH,
                1,
                expect.any(Number)
            );
        });

        it("fails definitively when the hash-based wait finds a revert", async () => {
            const { minter } = minterFor(
                [sendWith({ hash: true, reject: new Error("lost") })],
                routing({ status: 0 })
            );
            await expect(
                minter.mint(RECIPIENT, new Decimal(1))
            ).rejects.toMatchObject({
                message: `Mint transaction ${HASH} reverted`,
                receipt: { status: 0 },
            });
        });

        it("reports an unknown outcome when the hash-based wait cannot finish", async () => {
            const provider = routing();
            provider.waitForTransaction.mockRejectedValue({ code: "TIMEOUT" });
            const { minter } = minterFor(
                [sendWith({ hash: true, reject: new Error("lost") })],
                provider
            );
            await expect(
                minter.mint(RECIPIENT, new Decimal(1))
            ).rejects.toBeInstanceOf(MintOutcomeUnknownError);
        });

        it("reports an unknown outcome without a routing provider to wait on", async () => {
            const { minter } = minterFor([
                sendWith({ hash: true, reject: new Error("lost") }),
            ]);
            await expect(
                minter.mint(RECIPIENT, new Decimal(1))
            ).rejects.toMatchObject({
                name: "MintOutcomeUnknownError",
                transactionHash: HASH,
            });
        });
    });
});
