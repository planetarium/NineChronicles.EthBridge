export interface IAddressBanPolicy {
    isBannedAddress(address: string): boolean;
}

export class AddressBanPolicy implements IAddressBanPolicy {
    private readonly _bannedAddresses: string[];

    constructor(bannedAddresses: string[]) {
        this._bannedAddresses = bannedAddresses;
    }

    isBannedAddress(address: string): boolean {
        return this._bannedAddresses.indexOf(address) !== -1;
    }
}
