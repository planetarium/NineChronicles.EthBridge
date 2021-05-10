import { TransactionReceipt } from "web3-core";

/**
 * A minter of {@link wrapped-ncg-token.ts#wNCGToken | Wrapped NCG} to Ethereum network.
 */
export interface IWrappedNCGMinter {
    /**
     * Mint {@link wrapped-ncg-token.ts#wNCGToken | Wrapped NCG} to [Ethereum network](https://ethereum.org/).
     * @param address The address to mint {@link wrapped-ncg-token.ts#wNCGToken | Wrapped NCG}.
     * @param amount The amount of {@link wrapped-ncg-token.ts#wNCGToken | Wrapped NCG} to mint.
     */
    mint(address: string, amount: number): Promise<TransactionReceipt>;
}
