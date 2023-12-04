import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";

describe(FixedExchangeFeeRatioPolicy.name, () => {
    const policy = new FixedExchangeFeeRatioPolicy(
        new Decimal(50000),
        new Decimal(10000),
        {
            criterion: new Decimal(1000),
            fee: new Decimal(10),
        },
        {
            range1: new Decimal(0.01),
            range2: new Decimal(0.02),
        }
    );

    describe(FixedExchangeFeeRatioPolicy.prototype.getFee.name, () => {
        it("should return value of exchange fee ratio information", () => {
            // base fee
            expect(policy.getFee(new Decimal(300))).toEqual(new Decimal(10));
            expect(policy.getFee(new Decimal(500))).toEqual(new Decimal(10));

            // range1 - 0.01
            expect(policy.getFee(new Decimal(1000))).toEqual(new Decimal(10));
            expect(policy.getFee(new Decimal(1001))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(5000))).toEqual(new Decimal(50));
            expect(policy.getFee(new Decimal(10000))).toEqual(new Decimal(100));

            // range2 - ( 1% fee + 2% surCharge applied )
            expect(policy.getFee(new Decimal(12000))).toEqual(new Decimal(160));
            expect(policy.getFee(new Decimal(15000))).toEqual(new Decimal(250));
            expect(policy.getFee(new Decimal(20000))).toEqual(new Decimal(400));
            expect(policy.getFee(new Decimal(32500))).toEqual(new Decimal(775));
            expect(policy.getFee(new Decimal(50000))).toEqual(
                new Decimal(1300)
            );
        });
    });
});
