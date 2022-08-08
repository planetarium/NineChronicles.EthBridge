import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy, ZeroExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";

describe(FixedExchangeFeeRatioPolicy.name, () => {
    const addresses = [
        "0x9093dd96c4bb6b44a9e0a522e2de49641f146223",
        "0x939731b907cf30e34360670859d5440ab1a9503b",
    ];
    const exchangeFeeRatio = new Decimal(0.1);
    const policy = new FixedExchangeFeeRatioPolicy(exchangeFeeRatio);

    describe(FixedExchangeFeeRatioPolicy.prototype.getFee.name, () => {
        it("should always return same value for every addresses", () => {
            for (const address of addresses) {
                expect(policy.getFee(address)).toEqual(new Decimal(0.1));
            }
        });
    });
});

describe(ZeroExchangeFeeRatioPolicy.name, () => {
    const policy = new ZeroExchangeFeeRatioPolicy("0x939731b907cf30e34360670859d5440ab1a9503b");

    describe(ZeroExchangeFeeRatioPolicy.prototype.getFee.name, () => {
        it("should always return zero value for target address", () => {
            expect(policy.getFee("0x939731b907cf30e34360670859d5440ab1a9503b")).toEqual(new Decimal(0));
        });

        it("should always return false value for not target addresses", () => {
            expect(policy.getFee("0x890d602ff01555b01b6cea1e2ca4c27b410b8fcc")).toBeFalsy();
            expect(policy.getFee("0xe4f5351e02b1fd391712776a22db87884e02be5b")).toBeFalsy();
        });
    });
});
