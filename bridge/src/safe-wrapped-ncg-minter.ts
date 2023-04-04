import { ethers, Signer } from "ethers";
import Decimal from "decimal.js";

import { IWrappedNCGMinter } from "./interfaces/wrapped-ncg-minter";
import {
    SafeTransaction,
    SafeTransactionDataPartial,
} from "@safe-global/safe-core-sdk-types";
import Safe from "@safe-global/safe-core-sdk";
import SafeServiceClient from "@safe-global/safe-service-client";
import EthersAdapter from "@safe-global/safe-ethers-lib";

export class SafeWrappedNCGMinter implements IWrappedNCGMinter {
    private readonly _safeService: SafeServiceClient;
    private readonly _safeAddress: string;
    private readonly _owner1Signer: Signer;
    private readonly _owner2Signer: Signer;
    private readonly _owner3Signer: Signer;
    private readonly _wncgContractAddress: string;
    private readonly _safeSdkOwner1: Safe;
    private readonly _safeSdkOwner2: Safe;

    private constructor(
        safeService: SafeServiceClient,
        safeAddress: string,
        wncgContractAddress: string,
        owner1Signer: Signer,
        owner2Signer: Signer,
        owner3Signer: Signer,
        safeSdkOwner1: Safe,
        safeSdkOwner2: Safe
    ) {
        this._safeService = safeService;
        this._safeAddress = safeAddress;
        this._wncgContractAddress = wncgContractAddress;
        this._owner1Signer = owner1Signer;
        this._owner2Signer = owner2Signer;
        this._owner3Signer = owner3Signer;
        this._safeSdkOwner1 = safeSdkOwner1;
        this._safeSdkOwner2 = safeSdkOwner2;
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
        await this.proposeMintTransaction(adjustedAmount, address);
        const { safeTxHash } = await this.confirmTransaction();
        const { transactionHash } = await this.executeTransaction(safeTxHash);
        return transactionHash;
    }

    static async create(
        txServiceUrl: string,
        safeAddress: string,
        wncgContractAddress: string,
        owner1Signer: Signer,
        owner2Signer: Signer,
        owner3Signer: Signer
    ): Promise<SafeWrappedNCGMinter> {
        const ethAdapterOwner1 = new EthersAdapter({
            ethers,
            signerOrProvider: owner1Signer,
        });
        const safeService = new SafeServiceClient({
            txServiceUrl,
            ethAdapter: ethAdapterOwner1,
        });
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
            safeSdkOwner2
        );
    }

    private async proposeMintTransaction(amount: string, to: string) {
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
