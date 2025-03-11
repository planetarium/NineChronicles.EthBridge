import { ethers, Signer } from "ethers";
import Decimal from "decimal.js";

import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import {
    SafeTransaction,
    SafeTransactionDataPartial,
    SafeMultisigTransactionResponse,
} from "@safe-global/safe-core-sdk-types";
import Safe from "@safe-global/safe-core-sdk";
import SafeServiceClient from "@safe-global/safe-service-client";
import EthersAdapter from "@safe-global/safe-ethers-lib";
import { Provider } from "@ethersproject/abstract-provider";
import { IGasPricePolicy } from "./policies/gas-price";

// Safe 컨트랙트 ABI (필요한 함수만 포함)
const SAFE_ABI = [
    "function getThreshold() view returns (uint256)",
    "function getOwners() view returns (address[])",
    "function nonce() view returns (uint256)",
    "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
];

// 환경 변수로 API 사용 여부 설정
const USE_SAFE_API = process.env.USE_SAFE_API !== "false";

export class SafeWrappedNCGMinter implements IWrappedNCGMinter {
    private readonly _safeService: SafeServiceClient | null;
    private readonly _safeAddress: string;
    private readonly _owner1Signer: Signer;
    private readonly _owner2Signer: Signer;
    private readonly _owner3Signer: Signer;
    private readonly _wncgContractAddress: string;
    private readonly _safeSdkOwner1: Safe;
    private readonly _safeSdkOwner2: Safe;
    private readonly _provider: Provider;
    private readonly _gasPricePolicy: IGasPricePolicy;
    private readonly _safeContract: ethers.Contract | null = null;
    private _pendingTx: {
        to: string;
        value: string;
        data: string;
        nonce: number;
        signatures: Map<string, string>;
    } | null = null;

    private constructor(
        safeService: SafeServiceClient | null,
        safeAddress: string,
        wncgContractAddress: string,
        owner1Signer: Signer,
        owner2Signer: Signer,
        owner3Signer: Signer,
        safeSdkOwner1: Safe,
        safeSdkOwner2: Safe,
        provider: Provider,
        gasPricePolicy: IGasPricePolicy
    ) {
        this._safeService = safeService;
        this._safeAddress = safeAddress;
        this._wncgContractAddress = wncgContractAddress;
        this._owner1Signer = owner1Signer;
        this._owner2Signer = owner2Signer;
        this._owner3Signer = owner3Signer;
        this._safeSdkOwner1 = safeSdkOwner1;
        this._safeSdkOwner2 = safeSdkOwner2;
        this._provider = provider;
        this._gasPricePolicy = gasPricePolicy;

        // Safe API를 사용하지 않는 경우 Safe 컨트랙트 인스턴스 생성
        if (!USE_SAFE_API) {
            this._safeContract = new ethers.Contract(
                safeAddress,
                SAFE_ABI,
                owner1Signer
            );
        }
    }

    async mint(address: string, amount: Decimal): Promise<string> {
        //NOTICE: This can be a problem if the number of digits in amount exceeds 9e+14.
        //more detail: https://mikemcl.github.io/decimal.js/#toExpPos
        console.log(
            `Minting ${amount.toString()} ${
                this._wncgContractAddress
            } to ${address}`
        );

        const adjustedAmount = amount.div(new Decimal(10).pow(18)).toString();

        if (USE_SAFE_API) {
            // Safe API 사용 방식
            await this.proposeMintTransaction(adjustedAmount, address);
            const { safeTxHash } = await this.confirmTransaction();
            const { transactionHash } = await this.executeTransaction(
                safeTxHash
            );
            return transactionHash;
        } else {
            // 직접 컨트랙트 호출 방식
            await this.proposeMintTransactionDirect(adjustedAmount, address);
            await this.confirmTransactionDirect();
            const txHash = await this.executeTransactionDirect();
            return txHash;
        }
    }

    static async create(
        txServiceUrl: string,
        safeAddress: string,
        wncgContractAddress: string,
        owner1Signer: Signer,
        owner2Signer: Signer,
        owner3Signer: Signer,
        provider: Provider,
        gasPricePolicy: IGasPricePolicy
    ): Promise<SafeWrappedNCGMinter> {
        const ethAdapterOwner1 = new EthersAdapter({
            ethers,
            signerOrProvider: owner1Signer,
        });

        let safeService = null;
        if (USE_SAFE_API) {
            safeService = new SafeServiceClient({
                txServiceUrl,
                ethAdapter: ethAdapterOwner1,
            });
        }

        const safeSdkOwner1 = await Safe.create({
            ethAdapter: ethAdapterOwner1,
            safeAddress: ethers.utils.getAddress(safeAddress),
        });

        const ethAdapterOwner2 = new EthersAdapter({
            ethers,
            signerOrProvider: owner2Signer,
        });
        const safeSdkOwner2 = await Safe.create({
            ethAdapter: ethAdapterOwner2,
            safeAddress: ethers.utils.getAddress(safeAddress),
        });

        return new SafeWrappedNCGMinter(
            safeService,
            safeAddress,
            wncgContractAddress,
            owner1Signer,
            owner2Signer,
            owner3Signer,
            safeSdkOwner1,
            safeSdkOwner2,
            provider,
            gasPricePolicy
        );
    }

    // 직접 컨트랙트 호출 방식의 메서드들
    private async proposeMintTransactionDirect(amount: string, to: string) {
        if (!this._safeContract) {
            throw new Error("Safe contract is not initialized");
        }

        Decimal.set({ toExpPos: 900000000000000 });
        const gasPrice = new Decimal(
            (await this._provider.getGasPrice()).toString()
        );
        console.log("Original gas price:", gasPrice);
        const calculatedGasPrice =
            this._gasPricePolicy.calculateGasPrice(gasPrice);
        console.log("Calculated gas price:", calculatedGasPrice);

        // Create a transaction object
        const mintAmount = ethers.utils.parseUnits(amount, 18);
        const wncgContract = new ethers.Contract(
            this._wncgContractAddress,
            ["function mint(address account, uint256 amount) public"],
            this._owner1Signer
        );

        const data = wncgContract.interface.encodeFunctionData("mint", [
            to,
            mintAmount,
        ]);

        // Safe 트랜잭션 해시 계산을 위한 파라미터
        const nonce = await this._safeContract.nonce();
        const operation = 0; // Call
        const safeTxGas = 0;
        const baseGas = 0;
        const gasToken = ethers.constants.AddressZero;
        const refundReceiver = ethers.constants.AddressZero;

        // EIP-712 해시 계산
        const txHash = await this._safeSdkOwner1.getTransactionHash({
            to: this._wncgContractAddress,
            value: "0",
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice: calculatedGasPrice.toNumber(),
            gasToken,
            refundReceiver,
            nonce: nonce.toNumber(),
        });

        // 첫 번째 소유자 서명
        const signature1 = await this._owner1Signer.signMessage(
            ethers.utils.arrayify(txHash)
        );

        // 보류 중인 트랜잭션 저장
        this._pendingTx = {
            to: this._wncgContractAddress,
            value: "0",
            data,
            nonce: nonce.toNumber(),
            signatures: new Map([
                [await this._owner1Signer.getAddress(), signature1],
            ]),
        };

        console.log("Transaction proposed directly:", {
            to: this._wncgContractAddress,
            data,
            nonce: nonce.toNumber(),
            txHash,
        });
    }

    private async confirmTransactionDirect() {
        if (!this._pendingTx) {
            throw new Error("No pending transaction to confirm");
        }

        // Safe 트랜잭션 해시 계산을 위한 파라미터
        const operation = 0; // Call
        const safeTxGas = 0;
        const baseGas = 0;
        const gasPrice = await this._gasPricePolicy.calculateGasPrice(
            new Decimal((await this._provider.getGasPrice()).toString())
        );
        const gasToken = ethers.constants.AddressZero;
        const refundReceiver = ethers.constants.AddressZero;

        // EIP-712 해시 계산
        const txHash = await this._safeSdkOwner1.getTransactionHash({
            to: this._pendingTx.to,
            value: this._pendingTx.value,
            data: this._pendingTx.data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice: gasPrice.toNumber(),
            gasToken,
            refundReceiver,
            nonce: this._pendingTx.nonce,
        });

        // 두 번째 소유자 서명
        const signature2 = await this._owner2Signer.signMessage(
            ethers.utils.arrayify(txHash)
        );

        // 서명 추가
        this._pendingTx.signatures.set(
            await this._owner2Signer.getAddress(),
            signature2
        );

        console.log("Transaction confirmed directly");
    }

    private async executeTransactionDirect(): Promise<string> {
        if (!this._pendingTx || !this._safeContract) {
            throw new Error(
                "No pending transaction to execute or Safe contract not initialized"
            );
        }

        // Safe 트랜잭션 실행을 위한 파라미터
        const operation = 0; // Call
        const safeTxGas = 0;
        const baseGas = 0;
        const gasPrice = await this._gasPricePolicy.calculateGasPrice(
            new Decimal((await this._provider.getGasPrice()).toString())
        );
        const gasToken = ethers.constants.AddressZero;
        const refundReceiver = ethers.constants.AddressZero;

        // 소유자 주소 가져오기
        const owners = await this._safeContract.getOwners();

        // 서명 정렬 및 결합
        const sortedOwners = [...owners].sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );

        let signatures = "0x";
        for (const owner of sortedOwners) {
            if (this._pendingTx.signatures.has(owner)) {
                const sig = this._pendingTx.signatures.get(owner)!;
                const { r, s, v } = ethers.utils.splitSignature(sig);
                signatures +=
                    r.slice(2) + s.slice(2) + v.toString(16).padStart(2, "0");
            }
        }

        // 트랜잭션 실행
        const tx = await this._safeContract.execTransaction(
            this._pendingTx.to,
            this._pendingTx.value,
            this._pendingTx.data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice.toNumber(),
            gasToken,
            refundReceiver,
            signatures
        );

        const receipt = await tx.wait();
        console.log("Transaction executed directly:", receipt.transactionHash);

        // 보류 중인 트랜잭션 초기화
        this._pendingTx = null;

        return receipt.transactionHash;
    }

    private async proposeMintTransaction(amount: string, to: string) {
        if (!this._safeService) {
            throw new Error("Safe service is not initialized");
        }

        Decimal.set({ toExpPos: 900000000000000 });
        const gasPrice = new Decimal(
            (await this._provider.getGasPrice()).toString()
        );
        console.log("Original gas price:", gasPrice);
        const calculatedGasPrice =
            this._gasPricePolicy.calculateGasPrice(gasPrice);
        console.log("Calculated gas price:", calculatedGasPrice);

        // Create a transaction object
        const mintAmount = ethers.utils.parseUnits(amount, 18);
        const contract = new ethers.Contract(
            this._wncgContractAddress,
            ["function mint(address account, uint256 amount) public"],
            this._owner1Signer
        );

        const data = contract.interface.encodeFunctionData("mint", [
            to,
            mintAmount,
        ]);

        // TODO: gas price policy? See `WrappedNCGMinter.mint()` method.
        const safeTransactionData: SafeTransactionDataPartial = {
            to: this._wncgContractAddress,
            value: "0",
            gasPrice: calculatedGasPrice.toNumber(),
            data: data,
        };

        // Create a Safe transaction with the provided parameters
        const safeTransaction: SafeTransaction =
            await this._safeSdkOwner1.createTransaction({
                safeTransactionData,
            });

        // Deterministic hash based on transaction parameters
        const safeTxHash = await this._safeSdkOwner1.getTransactionHash(
            safeTransaction
        );

        // Sign transaction to verify that the transaction is coming from owner 1
        const senderSignature = await this._safeSdkOwner1.signTransactionHash(
            safeTxHash
        );

        console.log({
            safeAddress: this._safeAddress,
            safeTransactionData: safeTransaction.data,
            safeTxHash,
            senderAddress: await this._owner1Signer.getAddress(),
            senderSignature: senderSignature.data,
        });
        await this._safeService.proposeTransaction({
            safeAddress: this._safeAddress,
            safeTransactionData: safeTransaction.data,
            safeTxHash,
            senderAddress: await this._owner1Signer.getAddress(),
            senderSignature: senderSignature.data,
        });
    }

    private async confirmTransaction() {
        if (!this._safeService) {
            throw new Error("Safe service is not initialized");
        }

        const pendingTransactions = (
            await this._safeService.getPendingTransactions(this._safeAddress)
        ).results;

        // Assumes that the first pending transaction is the transaction we want to confirm
        const transaction = pendingTransactions[0];
        const safeTxHash = transaction.safeTxHash;

        const signature = await this._safeSdkOwner2.signTransactionHash(
            safeTxHash
        );
        const response = await this._safeService.confirmTransaction(
            safeTxHash,
            signature.data
        );

        console.log("Transaction confirmed:", response);
        return { safeTxHash, confirmationResponse: response };
    }

    private async executeTransaction(
        safeTxHash: string
    ): Promise<ethers.ContractReceipt> {
        if (!this._safeService) {
            throw new Error("Safe service is not initialized");
        }

        let safeBalance = await this._safeSdkOwner1.getBalance();

        console.log(
            `[Before Transaction] Safe Balance: ${ethers.utils.formatUnits(
                safeBalance,
                "ether"
            )} ETH`
        );

        const safeTransaction = await this._safeService.getTransaction(
            safeTxHash
        );
        const executeTxResponse = await this._safeSdkOwner1.executeTransaction(
            safeTransaction
        );
        const receipt = await executeTxResponse.transactionResponse?.wait();
        safeBalance = await this._safeSdkOwner1.getBalance();

        console.log(
            `[After Transaction] Safe Balance: ${ethers.utils.formatUnits(
                safeBalance,
                "ether"
            )} ETH`
        );

        if (receipt === undefined) {
            throw new Error("Transaction receipt is undefined");
        }

        return receipt;
    }
}
