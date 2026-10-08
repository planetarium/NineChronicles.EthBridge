import Decimal from "decimal.js";
import { ethers } from "ethers";
import type { SafeWrappedNCGMinter as Minter } from "../src/safe-wrapped-ncg-minter";

const SAFE = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const OWNERS = [
    "0x4444444444444444444444444444444444444444",
    "0x5555555555555555555555555555555555555555",
    "0x6666666666666666666666666666666666666666",
];
const TX_HASH = `0x${"ab".repeat(32)}`;
const AMOUNT = new Decimal(10).pow(18);
type Mode = "api" | "direct";

// Reload to exercise USE_SAFE_API's real module-load configuration. Only
// external SDK/contract boundaries are mocked; both public mint paths and
// the actual receipt retry helper execute unchanged.
async function setup(mode: Mode, tracking = false) {
    jest.resetModules();
    process.env.USE_SAFE_API = mode === "api" ? "true" : "false";
    const wait = jest.fn().mockResolvedValue({ transactionHash: TX_HASH });
    const broadcast = jest
        .fn()
        .mockResolvedValue(
            mode === "api"
                ? { transactionResponse: { hash: TX_HASH, wait } }
                : { hash: TX_HASH, wait }
        );
    const safeContract = {
        nonce: jest.fn().mockResolvedValue(ethers.BigNumber.from(7)),
        getOwners: jest.fn().mockResolvedValue([...OWNERS].reverse()),
        getThreshold: jest.fn().mockResolvedValue(ethers.BigNumber.from(2)),
        execTransaction: broadcast,
    };
    const sdk = {
        createTransaction: jest.fn().mockResolvedValue({ data: { nonce: 7 } }),
        getTransactionHash: jest.fn().mockResolvedValue(TX_HASH),
        signTransactionHash: jest
            .fn()
            .mockResolvedValue({ data: `0x${"11".repeat(65)}` }),
        executeTransaction: broadcast,
        getBalance: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
    };
    const serviceConstructor = jest.fn(() => ({
        proposeTransaction: jest.fn().mockResolvedValue(undefined),
        getPendingTransactions: jest
            .fn()
            .mockResolvedValue({ results: [{ safeTxHash: TX_HASH }] }),
        confirmTransaction: jest.fn().mockResolvedValue({}),
        getTransaction: jest.fn().mockResolvedValue({}),
    }));
    jest.doMock("@safe-global/safe-core-sdk", () => ({
        __esModule: true,
        default: { create: jest.fn().mockResolvedValue(sdk) },
    }));
    jest.doMock("@safe-global/safe-service-client", () => ({
        __esModule: true,
        default: serviceConstructor,
    }));
    jest.doMock("@safe-global/safe-ethers-lib", () => ({
        __esModule: true,
        default: jest.fn(),
    }));
    jest.doMock("ethers", () => {
        const actual = jest.requireActual("ethers");
        return {
            ...actual,
            ethers: {
                ...actual.ethers,
                Contract: jest.fn((address, abi) =>
                    address === SAFE
                        ? safeContract
                        : { interface: new actual.ethers.utils.Interface(abi) }
                ),
            },
        };
    });
    const { SafeWrappedNCGMinter } =
        require("../src/safe-wrapped-ncg-minter") as {
            SafeWrappedNCGMinter: typeof Minter;
        };
    const signers = OWNERS.map(
        (address) =>
            ({
                _isSigner: true,
                getAddress: jest.fn().mockResolvedValue(address),
            } as unknown as ethers.Signer)
    );
    const release = jest.fn();
    const provider = {
        getGasPrice: jest
            .fn()
            .mockResolvedValue(ethers.BigNumber.from(1_000_000_000)),
        ...(tracking
            ? {
                  broadcastAttempts: 0,
                  beginReadSession: jest.fn().mockResolvedValue(release),
              }
            : {}),
    };
    const minter = await SafeWrappedNCGMinter.create(
        "https://safe-service.invalid",
        SAFE,
        TOKEN,
        signers[0],
        signers[1],
        signers[2],
        provider as unknown as ethers.providers.Provider,
        { calculateGasPrice: (price: Decimal) => price },
        { maxRetry: 2, delayMs: 1 },
        { attempts: 3, delayMs: 1 }
    );
    return {
        minter,
        wait,
        broadcast,
        sdk,
        serviceConstructor,
        safeContract,
        provider,
        release,
    };
}

describe("Safe mint submission and receipt boundaries", () => {
    const originalMode = process.env.USE_SAFE_API;
    afterEach(() => {
        if (originalMode === undefined) delete process.env.USE_SAFE_API;
        else process.env.USE_SAFE_API = originalMode;
        jest.resetModules();
    });

    describe.each<Mode>(["api", "direct"])("%s execution", (mode) => {
        it("does not retry a broadcast timeout whose submission outcome is unknown", async () => {
            const { minter, broadcast, wait } = await setup(mode);
            const error = { code: "TIMEOUT", transactionHash: TX_HASH };
            broadcast.mockRejectedValueOnce(error);
            await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toBe(error);
            expect(broadcast).toHaveBeenCalledTimes(1);
            expect(wait).not.toHaveBeenCalled();
        });
        it("retries only the same transaction's receipt after multiple transient failures", async () => {
            const { minter, broadcast, wait } = await setup(mode);
            wait.mockRejectedValueOnce({
                code: "TIMEOUT",
            }).mockRejectedValueOnce({
                code: "SERVER_ERROR",
                error: { code: -32603 },
            });
            await expect(minter.mint(RECIPIENT, AMOUNT)).resolves.toBe(TX_HASH);
            expect(broadcast).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(3);
        });
        it("reports an unknown outcome for a non-definitive receipt error without retrying", async () => {
            const { minter, broadcast, wait } = await setup(mode);
            const error = { code: "SERVER_ERROR", error: { code: -32602 } };
            wait.mockRejectedValue(error);
            await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toMatchObject({
                name: "MintOutcomeUnknownError",
                cause: error,
            });
            expect(broadcast).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(1);
        });
        it.each([
            { code: "CALL_EXCEPTION", transactionHash: TX_HASH },
            { code: "TRANSACTION_REPLACED", cancelled: true },
        ])(
            "propagates a definitive receipt outcome without retrying: %j",
            async (error) => {
                const { minter, broadcast, wait } = await setup(mode);
                wait.mockRejectedValue(error);
                await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toBe(
                    error
                );
                expect(broadcast).toHaveBeenCalledTimes(1);
                expect(wait).toHaveBeenCalledTimes(1);
            }
        );
        it("reports an unconfirmed outcome after its receipt retry budget without resubmitting", async () => {
            const { minter, broadcast, wait } = await setup(mode);
            const error = { code: "TIMEOUT" };
            wait.mockRejectedValue(error);
            // Broadcast but unconfirmed: never a plain failure that invites a
            // second mint.
            await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toMatchObject({
                name: "MintOutcomeUnknownError",
                transactionHash: TX_HASH,
                cause: error,
            });
            expect(broadcast).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(3);
        });
    });

    it("restarts a direct mint from its proposal after a transient pre-broadcast read failure", async () => {
        const { minter, broadcast, sdk, safeContract, provider, release } =
            await setup("direct", true);
        safeContract.nonce.mockRejectedValueOnce({ code: "TIMEOUT" });
        await expect(minter.mint(RECIPIENT, AMOUNT)).resolves.toBe(TX_HASH);
        expect(safeContract.nonce).toHaveBeenCalledTimes(2);
        expect(sdk.createTransaction).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(provider.beginReadSession).toHaveBeenCalledTimes(2);
        expect(release).toHaveBeenCalledTimes(2);
    });

    it("restarts only the Safe API execution, never the proposal, before broadcasting", async () => {
        const { minter, broadcast, sdk, serviceConstructor, provider } =
            await setup("api", true);
        sdk.getBalance.mockRejectedValueOnce({ code: "TIMEOUT" });
        await expect(minter.mint(RECIPIENT, AMOUNT)).resolves.toBe(TX_HASH);
        const service = serviceConstructor.mock.results[0].value;
        expect(service.proposeTransaction).toHaveBeenCalledTimes(1);
        expect(service.confirmTransaction).toHaveBeenCalledTimes(1);
        expect(service.getTransaction).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(provider.beginReadSession).toHaveBeenCalledTimes(2);
    });

    it("never restarts a Safe execution after its broadcast", async () => {
        const { minter, broadcast, provider } = await setup("direct", true);
        const error = { code: "UNKNOWN_ERROR", transactionHash: TX_HASH };
        broadcast.mockImplementationOnce(async () => {
            provider.broadcastAttempts! += 1;
            throw error;
        });
        await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toMatchObject({
            name: "MintOutcomeUnknownError",
            transactionHash: TX_HASH,
        });
        expect(broadcast).toHaveBeenCalledTimes(1);
    });

    it("uses the direct contract path with the intended mint calldata and no Safe service", async () => {
        const { minter, broadcast, sdk, serviceConstructor, safeContract } =
            await setup("direct");
        sdk.signTransactionHash
            .mockResolvedValueOnce({ data: `0x${"11".repeat(65)}` })
            .mockResolvedValueOnce({ data: `0x${"22".repeat(65)}` });
        await expect(minter.mint(RECIPIENT, AMOUNT)).resolves.toBe(TX_HASH);
        expect(serviceConstructor).not.toHaveBeenCalled();
        expect(safeContract.nonce).toHaveBeenCalledTimes(1);
        expect(sdk.signTransactionHash).toHaveBeenCalledTimes(2);
        const args = broadcast.mock.calls[0];
        expect(args[0]).toBe(TOKEN);
        expect(args[1]).toBe("0");
        const iface = new ethers.utils.Interface([
            "function mint(address account, uint256 amount)",
        ]);
        const decoded = iface.decodeFunctionData("mint", args[2]);
        expect(decoded.account).toBe(RECIPIENT);
        expect(decoded.amount.toString()).toBe(AMOUNT.toString());
        expect(args[9]).toBe(`0x${"11".repeat(65)}${"22".repeat(65)}`);
    });
    it("does not broadcast when the direct Safe threshold cannot be met", async () => {
        const { minter, broadcast, safeContract } = await setup("direct");
        safeContract.getThreshold.mockResolvedValue(ethers.BigNumber.from(3));
        await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toThrow(
            "Not enough signatures"
        );
        expect(broadcast).not.toHaveBeenCalled();
    });
    it("does not retry execution when the Safe SDK omits the transaction response", async () => {
        const { minter, broadcast, wait } = await setup("api");
        broadcast.mockResolvedValue({});
        await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toThrow(
            "Transaction response is undefined after execution"
        );
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(wait).not.toHaveBeenCalled();
    });
    it("does not report success or resubmit when the receipt is missing", async () => {
        const { minter, broadcast, wait } = await setup("api");
        wait.mockResolvedValue(undefined);
        await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toThrow(
            "Transaction receipt is undefined"
        );
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledTimes(1);
    });
    // These fail-closed guards protect the two execution modes and pending
    // transaction lifecycle. Invoke their internal entry points deliberately:
    // the public mint method normally guarantees their preconditions.
    it("rejects a direct proposal when only the Safe API is configured", async () => {
        const { minter, sdk, broadcast } = await setup("api");
        await expect(
            minter["proposeMintTransactionDirect"]("1", RECIPIENT)
        ).rejects.toThrow("Safe contract is not initialized");
        expect(sdk.createTransaction).not.toHaveBeenCalled();
        expect(sdk.signTransactionHash).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
    });

    it("rejects signing a direct transaction before one has been proposed", async () => {
        const { minter, sdk, broadcast } = await setup("direct");
        await expect(minter["confirmTransactionDirect"]()).rejects.toThrow(
            "No pending transaction to confirm"
        );
        expect(sdk.signTransactionHash).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
    });

    it("clears the completed direct transaction so executing it again cannot rebroadcast", async () => {
        const { minter, broadcast, wait } = await setup("direct");
        await expect(minter.mint(RECIPIENT, AMOUNT)).resolves.toBe(TX_HASH);
        await expect(minter["broadcastTransactionDirect"]()).rejects.toThrow(
            "No pending transaction to execute or Safe contract not initialized"
        );
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledTimes(1);
    });

    it.each([
        {
            name: "proposal",
            call: (minter: Minter) =>
                minter["proposeMintTransaction"]("1", RECIPIENT),
        },
        {
            name: "confirmation",
            call: (minter: Minter) => minter["confirmTransaction"](),
        },
        {
            name: "execution",
            call: (minter: Minter) => minter["executeTransaction"](TX_HASH),
        },
    ])(
        "rejects Safe API $name in direct-only mode before any side effect",
        async ({ call }) => {
            const { minter, sdk, broadcast, serviceConstructor } = await setup(
                "direct"
            );
            await expect(call(minter)).rejects.toThrow(
                "Safe service is not initialized"
            );
            expect(serviceConstructor).not.toHaveBeenCalled();
            expect(sdk.createTransaction).not.toHaveBeenCalled();
            expect(sdk.signTransactionHash).not.toHaveBeenCalled();
            expect(sdk.getBalance).not.toHaveBeenCalled();
            expect(broadcast).not.toHaveBeenCalled();
        }
    );
});
