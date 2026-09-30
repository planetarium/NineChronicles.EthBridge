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
async function setup(mode: Mode) {
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
    const minter = await SafeWrappedNCGMinter.create(
        "https://safe-service.invalid",
        SAFE,
        TOKEN,
        signers[0],
        signers[1],
        signers[2],
        {
            getGasPrice: jest
                .fn()
                .mockResolvedValue(ethers.BigNumber.from(1_000_000_000)),
        } as unknown as ethers.providers.Provider,
        { calculateGasPrice: (price: Decimal) => price },
        { maxRetry: 2, delayMs: 1 }
    );
    return { minter, wait, broadcast, sdk, serviceConstructor, safeContract };
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
        it.each([
            { code: "CALL_EXCEPTION", transactionHash: TX_HASH },
            { code: "SERVER_ERROR", error: { code: -32602 } },
            { code: "TRANSACTION_REPLACED", cancelled: true },
        ])(
            "propagates a terminal receipt error without retrying: %j",
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
        it("exhausts its receipt retry budget without resubmitting", async () => {
            const { minter, broadcast, wait } = await setup(mode);
            const error = { code: "TIMEOUT" };
            wait.mockRejectedValue(error);
            await expect(minter.mint(RECIPIENT, AMOUNT)).rejects.toBe(error);
            expect(broadcast).toHaveBeenCalledTimes(1);
            expect(wait).toHaveBeenCalledTimes(3);
        });
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
});
