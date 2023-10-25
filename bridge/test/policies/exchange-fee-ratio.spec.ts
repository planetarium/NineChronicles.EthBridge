import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";

describe(FixedExchangeFeeRatioPolicy.name, () => {
    const exchangeFeeRange1Info = {
        start: new Decimal(100),
        end: new Decimal(500),
        ratio: new Decimal(0.01),
    };
    const exchangeFeeRange2Info = {
        start: new Decimal(500),
        end: new Decimal(1000),
        ratio: new Decimal(0.02),
    };

    const policy = new FixedExchangeFeeRatioPolicy(
        exchangeFeeRange1Info,
        exchangeFeeRange2Info,
        {
            criterion: new Decimal(100),
            fee: new Decimal(10),
        }
    );

    describe(FixedExchangeFeeRatioPolicy.prototype.getFee.name, () => {
        it("should return value of exchange fee ratio information", () => {
            expect(policy.getFee(new Decimal(50))).toEqual(new Decimal(10));
            expect(policy.getFee(new Decimal(100))).toEqual(new Decimal(1));
            expect(policy.getFee(new Decimal(150))).toEqual(new Decimal(1.5));
            expect(policy.getFee(new Decimal(500))).toEqual(new Decimal(5));
            expect(policy.getFee(new Decimal(700))).toEqual(new Decimal(14));
        });

        it("should return error", () => {
            try {
                const fee = policy.getFee(new Decimal(5000));
            } catch (e: any) {
                expect(e.message).toBe("Invalid amount for getting fee.");
            }
        });
    });
});
