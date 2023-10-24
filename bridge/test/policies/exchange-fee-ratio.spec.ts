import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";

describe(FixedExchangeFeeRatioPolicy.name, () => {
    const exchangeFeeRange1Info = {
        start: new Decimal(0),
        end: new Decimal(100),
        ratio: new Decimal(0.1),
    };
    const exchangeFeeRange2Info = {
        start: new Decimal(100),
        end: new Decimal(200),
        ratio: new Decimal(0.2),
    };

    const policy = new FixedExchangeFeeRatioPolicy(
        exchangeFeeRange1Info,
        exchangeFeeRange2Info
    );

    describe(FixedExchangeFeeRatioPolicy.prototype.getFee.name, () => {
        it("should return value of exchange fee ratio information", () => {
            expect(policy.getFee()).toEqual({
                feeRange1: exchangeFeeRange1Info,
                feeRange2: exchangeFeeRange2Info,
            });
        });
    });
});
