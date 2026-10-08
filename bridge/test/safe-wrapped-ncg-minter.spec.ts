import Decimal from "decimal.js";
import { ethers } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { IGasPricePolicy } from "../src/policies/gas-price";

jest.mock("@safe-global/safe-core-sdk", () => {
    return {
        __esModule: true,
        default: {
            create: jest.fn(),
        },
    };
});

jest.mock("@safe-global/safe-service-client", () => {
    return {
        __esModule: true,
        default: jest.fn(),
    };
});

jest.mock("@safe-global/safe-ethers-lib", () => {
    return {
        __esModule: true,
        default: jest.fn(),
    };
});

import Safe from "@safe-global/safe-core-sdk";
import SafeServiceClient from "@safe-global/safe-service-client";
import { SafeWrappedNCGMinter } from "../src/safe-wrapped-ncg-minter";

describe(SafeWrappedNCGMinter.name, () => {
    const mockProvider = {
        getGasPrice: jest
            .fn()
            .mockResolvedValue(ethers.BigNumber.from(1_000_000_000)),
    } as unknown as Provider;

    const mockGasPricePolicy: IGasPricePolicy = {
        calculateGasPrice: jest
            .fn()
            .mockReturnValue(new Decimal(1_500_000_000)),
    };

    function makeMockSigner(address: string) {
        return {
            _isSigner: true,
            getAddress: jest.fn().mockResolvedValue(address),
        } as unknown as ethers.Signer;
    }

    // The Safe SDK's `executeTransaction` is the one function that actually
    // broadcasts the mint to Ethereum - everything this test asserts about
    // call counts is checking that THIS function is never called more than
    // once per mint, regardless of what fails afterwards.
    function makeMockSafeSdk(executeTransaction: jest.Mock) {
        return {
            createTransaction: jest
                .fn()
                .mockResolvedValue({ data: { nonce: 0 } }),
            getTransactionHash: jest.fn().mockResolvedValue("0xSAFE_TX_HASH"),
            signTransactionHash: jest
                .fn()
                .mockResolvedValue({ data: "0xSIGNATURE" }),
            executeTransaction,
            getBalance: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
        };
    }

    function makeMockSafeService() {
        return {
            proposeTransaction: jest.fn().mockResolvedValue(undefined),
            getPendingTransactions: jest.fn().mockResolvedValue({
                results: [{ safeTxHash: "0xSAFE_TX_HASH" }],
            }),
            confirmTransaction: jest.fn().mockResolvedValue({}),
            getTransaction: jest.fn().mockResolvedValue({}),
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it(
        "broadcasts the mint transaction exactly once even when the receipt " +
            "wait times out and is retried (regression: must never double-mint)",
        async () => {
            // The broadcast succeeds immediately (we get a transaction
            // response back with a hash), but waiting for its receipt times
            // out once before succeeding - simulating a transient RPC hiccup
            // AFTER the transaction has already been submitted on-chain.
            const wait = jest
                .fn()
                .mockRejectedValueOnce({ code: "TIMEOUT" })
                .mockResolvedValueOnce({ transactionHash: "0xMINT_TX_HASH" });

            const executeTransaction = jest.fn().mockResolvedValue({
                transactionResponse: { hash: "0xMINT_TX_HASH", wait },
            });

            (Safe.create as jest.Mock).mockResolvedValue(
                makeMockSafeSdk(executeTransaction)
            );
            (SafeServiceClient as unknown as jest.Mock).mockImplementation(() =>
                makeMockSafeService()
            );

            const minter = await SafeWrappedNCGMinter.create(
                "https://safe-tx-service.example",
                "0x1234567890123456789012345678901234567890",
                "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
                makeMockSigner("0xOwner1000000000000000000000000000000000"),
                makeMockSigner("0xOwner2000000000000000000000000000000000"),
                makeMockSigner("0xOwner3000000000000000000000000000000000"),
                mockProvider,
                mockGasPricePolicy,
                { maxRetry: 3, delayMs: 1 }
            );

            const txHash = await minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            );

            expect(txHash).toEqual("0xMINT_TX_HASH");

            // The broadcast itself must happen exactly once, no matter how
            // many times the receipt wait was retried.
            expect(executeTransaction).toHaveBeenCalledTimes(1);

            // The receipt wait - a safe, idempotent read of the SAME
            // already-broadcast transaction - is the thing that retried.
            expect(wait).toHaveBeenCalledTimes(2);
        }
    );

    it("returns the confirmed mint hash when the diagnostic balance read fails", async () => {
        const wait = jest
            .fn()
            .mockResolvedValue({ transactionHash: "0xMINT_TX_HASH" });
        const executeTransaction = jest.fn().mockResolvedValue({
            transactionResponse: { hash: "0xMINT_TX_HASH", wait },
        });
        const sdk = makeMockSafeSdk(executeTransaction);
        sdk.getBalance
            .mockResolvedValueOnce(ethers.BigNumber.from(0))
            .mockRejectedValueOnce({ code: "TIMEOUT" });
        (Safe.create as jest.Mock).mockResolvedValue(sdk);
        (SafeServiceClient as unknown as jest.Mock).mockImplementation(
            makeMockSafeService
        );
        const minter = await SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner("0xOwner1000000000000000000000000000000000"),
            makeMockSigner("0xOwner2000000000000000000000000000000000"),
            makeMockSigner("0xOwner3000000000000000000000000000000000"),
            mockProvider,
            mockGasPricePolicy,
            { maxRetry: 1, delayMs: 1 }
        );
        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).resolves.toBe("0xMINT_TX_HASH");
        expect(executeTransaction).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledTimes(1);
        expect(sdk.getBalance).toHaveBeenCalledTimes(2);
    });

    it("reports an unknown outcome (without ever re-broadcasting) once receipt-wait retries are exhausted", async () => {
        const wait = jest.fn().mockRejectedValue({ code: "TIMEOUT" });

        const executeTransaction = jest.fn().mockResolvedValue({
            transactionResponse: { hash: "0xMINT_TX_HASH", wait },
        });

        (Safe.create as jest.Mock).mockResolvedValue(
            makeMockSafeSdk(executeTransaction)
        );
        (SafeServiceClient as unknown as jest.Mock).mockImplementation(() =>
            makeMockSafeService()
        );

        const minter = await SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner("0xOwner1000000000000000000000000000000000"),
            makeMockSigner("0xOwner2000000000000000000000000000000000"),
            makeMockSigner("0xOwner3000000000000000000000000000000000"),
            mockProvider,
            mockGasPricePolicy,
            { maxRetry: 2, delayMs: 1 }
        );

        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).rejects.toMatchObject({
            name: "MintOutcomeUnknownError",
            transactionHash: "0xMINT_TX_HASH",
            cause: { code: "TIMEOUT" },
        });

        // Still exactly one broadcast - exhausting retries on the receipt
        // wait must never fall back to re-broadcasting.
        expect(executeTransaction).toHaveBeenCalledTimes(1);
        // 1 initial attempt + 2 retries = 3 calls to wait().
        expect(wait).toHaveBeenCalledTimes(3);
    });

    it("never retries the broadcast itself on a non-transient error", async () => {
        const executeTransaction = jest
            .fn()
            .mockRejectedValue(new Error("execution reverted"));

        (Safe.create as jest.Mock).mockResolvedValue(
            makeMockSafeSdk(executeTransaction)
        );
        (SafeServiceClient as unknown as jest.Mock).mockImplementation(() =>
            makeMockSafeService()
        );

        const minter = await SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner("0xOwner1000000000000000000000000000000000"),
            makeMockSigner("0xOwner2000000000000000000000000000000000"),
            makeMockSigner("0xOwner3000000000000000000000000000000000"),
            mockProvider,
            mockGasPricePolicy,
            { maxRetry: 3, delayMs: 1 }
        );

        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).rejects.toThrow("execution reverted");

        expect(executeTransaction).toHaveBeenCalledTimes(1);
    });

    it("mints successfully using the default receipt-retry options when none are given", async () => {
        // No `receiptRetryOptions` argument at all (as opposed to every other
        // test in this file, which always passes one explicitly) - exercises
        // the constructor's own default value, not the caller's.
        const wait = jest
            .fn()
            .mockResolvedValue({ transactionHash: "0xMINT_TX_HASH" });
        const executeTransaction = jest.fn().mockResolvedValue({
            transactionResponse: { hash: "0xMINT_TX_HASH", wait },
        });

        (Safe.create as jest.Mock).mockResolvedValue(
            makeMockSafeSdk(executeTransaction)
        );
        (SafeServiceClient as unknown as jest.Mock).mockImplementation(() =>
            makeMockSafeService()
        );

        const minter = await SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner("0xOwner1000000000000000000000000000000000"),
            makeMockSigner("0xOwner2000000000000000000000000000000000"),
            makeMockSigner("0xOwner3000000000000000000000000000000000"),
            mockProvider,
            mockGasPricePolicy
        );

        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).resolves.toBe("0xMINT_TX_HASH");

        expect(executeTransaction).toHaveBeenCalledTimes(1);
    });

    it("throws clearly if the Safe SDK returns no transaction response after executing", async () => {
        const executeTransaction = jest
            .fn()
            .mockResolvedValue({ transactionResponse: undefined });

        (Safe.create as jest.Mock).mockResolvedValue(
            makeMockSafeSdk(executeTransaction)
        );
        (SafeServiceClient as unknown as jest.Mock).mockImplementation(() =>
            makeMockSafeService()
        );

        const minter = await SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner("0xOwner1000000000000000000000000000000000"),
            makeMockSigner("0xOwner2000000000000000000000000000000000"),
            makeMockSigner("0xOwner3000000000000000000000000000000000"),
            mockProvider,
            mockGasPricePolicy,
            { maxRetry: 3, delayMs: 1 }
        );

        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).rejects.toThrow("Transaction response is undefined after execution");

        expect(executeTransaction).toHaveBeenCalledTimes(1);
    });
});
