// This file exercises SafeWrappedNCGMinter's USE_SAFE_API=false ("direct
// contract call") path, which reads that flag once from process.env at
// module-load time. It's kept in its own test file (rather than alongside
// the USE_SAFE_API=true tests in safe-wrapped-ncg-minter.spec.ts) so the env
// var can simply be set before anything evaluates the module - Jest already
// runs each test file in its own isolated module registry, so this can't
// affect the USE_SAFE_API=true tests in the other file.
//
// `SafeWrappedNCGMinter` itself is loaded with `require()`, not a static
// `import`, specifically because static imports are hoisted above plain
// statements (including the `process.env` assignment below) once
// transpiled - a hoisted import would evaluate the module, and so read
// USE_SAFE_API, before this file's own top gets a chance to set it.
process.env.USE_SAFE_API = "false";

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
import type { SafeWrappedNCGMinter as SafeWrappedNCGMinterType } from "../src/safe-wrapped-ncg-minter";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SafeWrappedNCGMinter } =
    require("../src/safe-wrapped-ncg-minter") as typeof import("../src/safe-wrapped-ncg-minter");

const OWNER1_ADDRESS = "0x0000000000000000000000000000000000000001";
const OWNER2_ADDRESS = "0x0000000000000000000000000000000000000002";
const OWNER3_ADDRESS = "0x0000000000000000000000000000000000000003";

describe(`${SafeWrappedNCGMinter.name} (USE_SAFE_API=false, direct contract call path)`, () => {
    // The minter waits by hash through the provider (ethers' Contract drops
    // tx.wait's timeout); route it to the broadcast response's `wait` mock.
    let currentWait: jest.Mock | undefined;
    const mockProvider = {
        getGasPrice: jest
            .fn()
            .mockResolvedValue(ethers.BigNumber.from(1_000_000_000)),
        waitForTransaction: jest.fn(
            (_hash: string, confirmations?: number, timeout?: number) =>
                currentWait!(confirmations, timeout)
        ),
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

    function makeMockSafeSdk() {
        return {
            createTransaction: jest
                .fn()
                .mockResolvedValue({ data: { nonce: 0 } }),
            getTransactionHash: jest.fn().mockResolvedValue("0xSAFE_TX_HASH"),
            signTransactionHash: jest
                .fn()
                .mockResolvedValue({ data: "0xSIGNATURE" }),
            getBalance: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
        };
    }

    // `_safeContract` is a real ethers.Contract constructed internally in
    // this (USE_SAFE_API=false) path; overwriting it after construction with
    // a plain mock keeps this test focused on SafeWrappedNCGMinter's own
    // orchestration logic (and the retry-wrap around the receipt wait)
    // rather than re-testing ethers.Contract itself.
    function makeMockSafeContract(execTransaction: jest.Mock) {
        return {
            nonce: jest.fn().mockResolvedValue(ethers.BigNumber.from(0)),
            getOwners: jest
                .fn()
                .mockResolvedValue([
                    OWNER1_ADDRESS,
                    OWNER2_ADDRESS,
                    OWNER3_ADDRESS,
                ]),
            getThreshold: jest.fn().mockResolvedValue(ethers.BigNumber.from(2)),
            execTransaction,
        };
    }

    async function createMinter(): Promise<SafeWrappedNCGMinterType> {
        (Safe.create as jest.Mock).mockResolvedValue(makeMockSafeSdk());

        return SafeWrappedNCGMinter.create(
            "https://safe-tx-service.example",
            "0x1234567890123456789012345678901234567890",
            "0x83Ca4618dFD2d6cD2D321e00968112c1BDC13157",
            makeMockSigner(OWNER1_ADDRESS),
            makeMockSigner(OWNER2_ADDRESS),
            makeMockSigner(OWNER3_ADDRESS),
            mockProvider,
            mockGasPricePolicy,
            { maxRetry: 3, delayMs: 1 }
        );
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("proposes, confirms and executes directly, broadcasting exactly once even when the receipt wait times out and is retried", async () => {
        const wait = jest
            .fn()
            .mockRejectedValueOnce({ code: "TIMEOUT" })
            .mockResolvedValueOnce({
                transactionHash: "0xDIRECT_MINT_TX_HASH",
            });
        const execTransaction = jest.fn().mockResolvedValue({
            hash: "0xDIRECT_MINT_TX_HASH",
            wait: (currentWait = wait),
        });

        const minter = await createMinter();
        (minter as unknown as { _safeContract: unknown })._safeContract =
            makeMockSafeContract(execTransaction);

        const txHash = await minter.mint(
            "0x870737cb9a2D78Bb48511508159fA39c23797355",
            new Decimal(1000).mul(new Decimal(10).pow(18))
        );

        expect(txHash).toEqual("0xDIRECT_MINT_TX_HASH");
        // The broadcast itself happens exactly once, no matter how many
        // times the receipt wait was retried.
        expect(execTransaction).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledTimes(2);
    });

    it("throws when there aren't enough collected signatures to meet the threshold", async () => {
        const execTransaction = jest.fn();
        const minter = await createMinter();
        const mockContract = makeMockSafeContract(execTransaction);
        mockContract.getThreshold.mockResolvedValue(
            ethers.BigNumber.from(3) // requires all 3 owners; only 2 ever sign
        );
        (minter as unknown as { _safeContract: unknown })._safeContract =
            mockContract;

        await expect(
            minter.mint(
                "0x870737cb9a2D78Bb48511508159fA39c23797355",
                new Decimal(1000).mul(new Decimal(10).pow(18))
            )
        ).rejects.toThrow(/Not enough signatures/);

        expect(execTransaction).not.toHaveBeenCalled();
    });
});
