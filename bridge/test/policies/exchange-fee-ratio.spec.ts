import Decimal from "decimal.js";
import { FixedExchangeFeeRatioPolicy } from "../../src/policies/exchange-fee-ratio";
import { ACCOUNT_TYPE } from "../../src/whitelist/account-type";

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
        it("should throw error if transfer amount < 100 for general account type", () => {
            const expectedError = new Error(
                "The transfer amount should be greater than 100 NCG"
            );
            expect(() => {
                policy.getFee(new Decimal(99), new Decimal(0));
            }).toThrow(expectedError);
            expect(() => {
                policy.getFee(new Decimal(-1), new Decimal(0));
            }).toThrow(expectedError);
            expect(() => {
                policy.getFee(new Decimal(0), new Decimal(0));
            }).toThrow(expectedError);
            expect(() => {
                policy.getFee(new Decimal(1), new Decimal(0));
            }).toThrow(expectedError);
        });

        it("should throw error if 50000 < transfer amount for general account type", () => {
            const expectedError = new Error(
                "The transfer amount should be less than or equal to 50000 NCG"
            );
            expect(() => {
                policy.getFee(new Decimal(50001), new Decimal(0));
            }).toThrow(expectedError);
        });

        it("should throw error if 50000 < after-transfer amount for general account type", () => {
            const expectedError = new Error(
                "24hr transfer amount should be less than or equal to 50000 NCG"
            );
            expect(() => {
                policy.getFee(new Decimal(101), new Decimal(49900));
            }).toThrow(expectedError);
            expect(() => {
                policy.getFee(new Decimal(49900), new Decimal(101));
            }).toThrow(expectedError);
        });

        it("should return value of exchange fee ratio information", () => {
            /**
             * transferredAmountInLast24Hours == 0
             */
            // transferAmount < policy.criterion (1000)
            expect(policy.getFee(new Decimal(100), new Decimal(0))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(0))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(0))).toEqual(
                new Decimal(10)
            );
            // transferAmount == policy.criterion
            expect(policy.getFee(new Decimal(1000), new Decimal(0))).toEqual(
                new Decimal(10)
            );
            // transferAmount > policy.criterion (1000)
            expect(policy.getFee(new Decimal(1001), new Decimal(0))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(9999), new Decimal(0))).toEqual(
                new Decimal(99.99)
            );
            // transferAmount == policy.feeRangeDividerAmount (10000)
            expect(policy.getFee(new Decimal(10000), new Decimal(0))).toEqual(
                new Decimal(100)
            );
            // transferAmount > policy.feeRangeDividerAmount (10000)
            expect(policy.getFee(new Decimal(10001), new Decimal(0))).toEqual(
                new Decimal(100.03)
            );
            expect(policy.getFee(new Decimal(49999), new Decimal(0))).toEqual(
                new Decimal(1299.97)
            );

            /**
             * transferredAmountInLast24Hours <= policy.criterion (1000)
             */
            expect(policy.getFee(new Decimal(100), new Decimal(100))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(101))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(1000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(101), new Decimal(100))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(101))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(1000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(999), new Decimal(100))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(101))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(1000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(1000), new Decimal(100))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(1000), new Decimal(101))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(1000), new Decimal(999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(1000), new Decimal(1000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(1001), new Decimal(100))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(1001), new Decimal(101))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(1001), new Decimal(999))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(1001), new Decimal(1000))).toEqual(
                new Decimal(10.01)
            );

            /**
             * transferredAmountInLast24Hours <= policy.feeRangeDividerAmount (10000)
             */
            expect(policy.getFee(new Decimal(100), new Decimal(1001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(9999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(10000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(101), new Decimal(1001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(9999))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(10000))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(999), new Decimal(1001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(9999))).toEqual(
                new Decimal(29.95)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(10000))).toEqual(
                new Decimal(29.97)
            );

            expect(policy.getFee(new Decimal(1000), new Decimal(1001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(1000), new Decimal(9999))).toEqual(
                new Decimal(29.98)
            );
            expect(
                policy.getFee(new Decimal(1000), new Decimal(10000))
            ).toEqual(new Decimal(30));

            expect(policy.getFee(new Decimal(1001), new Decimal(1001))).toEqual(
                new Decimal(10.01)
            );
            expect(policy.getFee(new Decimal(1001), new Decimal(9999))).toEqual(
                new Decimal(30.01)
            );
            expect(
                policy.getFee(new Decimal(1001), new Decimal(10000))
            ).toEqual(new Decimal(30.03));

            expect(policy.getFee(new Decimal(9999), new Decimal(1001))).toEqual(
                new Decimal(119.99)
            );
            expect(policy.getFee(new Decimal(9999), new Decimal(9999))).toEqual(
                new Decimal(299.95)
            );
            expect(
                policy.getFee(new Decimal(9999), new Decimal(10000))
            ).toEqual(new Decimal(299.97));

            expect(
                policy.getFee(new Decimal(10000), new Decimal(1001))
            ).toEqual(new Decimal(120.02));
            expect(
                policy.getFee(new Decimal(10000), new Decimal(9999))
            ).toEqual(new Decimal(299.98));
            expect(
                policy.getFee(new Decimal(10000), new Decimal(10000))
            ).toEqual(new Decimal(300));

            expect(
                policy.getFee(new Decimal(10001), new Decimal(1001))
            ).toEqual(new Decimal(120.05));
            expect(
                policy.getFee(new Decimal(10001), new Decimal(9999))
            ).toEqual(new Decimal(300.01));
            expect(
                policy.getFee(new Decimal(10001), new Decimal(10000))
            ).toEqual(new Decimal(300.03));

            expect(
                policy.getFee(new Decimal(48999), new Decimal(1001))
            ).toEqual(new Decimal(1289.99));
            expect(
                policy.getFee(new Decimal(40001), new Decimal(9999))
            ).toEqual(new Decimal(1200.01));
            expect(
                policy.getFee(new Decimal(40000), new Decimal(10000))
            ).toEqual(new Decimal(1200));

            /**
             * policy.feeRangeDividerAmount (10000) < transferredAmountInLast24Hours
             */
            expect(policy.getFee(new Decimal(100), new Decimal(10001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(100), new Decimal(49900))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(101), new Decimal(10001))).toEqual(
                new Decimal(10)
            );
            expect(policy.getFee(new Decimal(101), new Decimal(49899))).toEqual(
                new Decimal(10)
            );

            expect(policy.getFee(new Decimal(999), new Decimal(10001))).toEqual(
                new Decimal(29.97)
            );
            expect(policy.getFee(new Decimal(999), new Decimal(49001))).toEqual(
                new Decimal(29.97)
            );

            expect(
                policy.getFee(new Decimal(1000), new Decimal(10001))
            ).toEqual(new Decimal(30));
            expect(
                policy.getFee(new Decimal(1000), new Decimal(49000))
            ).toEqual(new Decimal(30));

            expect(
                policy.getFee(new Decimal(1001), new Decimal(10001))
            ).toEqual(new Decimal(30.03));
            expect(
                policy.getFee(new Decimal(1001), new Decimal(48999))
            ).toEqual(new Decimal(30.03));

            expect(
                policy.getFee(new Decimal(9999), new Decimal(10001))
            ).toEqual(new Decimal(299.97));
            expect(
                policy.getFee(new Decimal(9999), new Decimal(40001))
            ).toEqual(new Decimal(299.97));

            expect(
                policy.getFee(new Decimal(10000), new Decimal(10001))
            ).toEqual(new Decimal(300));
            expect(
                policy.getFee(new Decimal(10000), new Decimal(40000))
            ).toEqual(new Decimal(300));

            expect(
                policy.getFee(new Decimal(10001), new Decimal(10001))
            ).toEqual(new Decimal(300.03));
            expect(
                policy.getFee(new Decimal(10001), new Decimal(39999))
            ).toEqual(new Decimal(300.03));

            expect(
                policy.getFee(new Decimal(39999), new Decimal(10001))
            ).toEqual(new Decimal(1199.97));
            expect(policy.getFee(new Decimal(100), new Decimal(49900))).toEqual(
                new Decimal(10)
            );

            // NO_LIMIT_ONE_PERCENT_FEE accounts
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(1));
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(1));
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(1));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(100));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(100));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(100));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(500));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(500));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(500));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(10000));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(10000));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_ONE_PERCENT_FEE
                )
            ).toEqual(new Decimal(10000));

            // NO_LIMIT_NO_FEE accounts
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(100),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(10000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(50000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(0),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(10001),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
            expect(
                policy.getFee(
                    new Decimal(1000000),
                    new Decimal(50000),
                    ACCOUNT_TYPE.NO_LIMIT_NO_FEE
                )
            ).toEqual(new Decimal(0));
        });
    });
});
