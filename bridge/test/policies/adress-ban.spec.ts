import {
    IAddressBanPolicy,
    AddressBanPolicy,
} from "../../src/policies/address-ban";

describe(AddressBanPolicy.name, () => {
    const bannedAddresses = ["0x9093dd96c4bb6b44a9e0a522e2de49641f146223"];
    const policy = new AddressBanPolicy(bannedAddresses);

    describe(AddressBanPolicy.prototype.isBannedAddress.name, () => {
        it("should return true with banned address", () => {
            expect(
                policy.isBannedAddress(
                    "0x9093dd96c4bb6b44a9e0a522e2de49641f146223"
                )
            ).toBeTruthy();
        });

        it("should return false with not banned address", () => {
            expect(
                policy.isBannedAddress(
                    "0x0000000000000000000000000000000000000000"
                )
            ).toBeFalsy();
        });
    });
});
