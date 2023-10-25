import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";

describe(FixedExchangeFeeRatioPolicy.name, () => {
    const policy = new FixedExchangeFeeRatioPolicy(
        new Decimal(1000),
        new Decimal(500),
        {
            criterion: new Decimal(100),
            fee: new Decimal(10),
        },
        {
            range1: new Decimal(0.01),
            range2: new Decimal(0.02),
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
