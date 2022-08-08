import Decimal from "decimal.js";
import {
    GasPriceLimitPolicy,
    GasPricePolicies,
    GasPriceTipPolicy,
    IGasPricePolicy,
} from "../../src/policies/gas-price";

describe(GasPriceTipPolicy.name, () => {
    describe(GasPriceTipPolicy.prototype.calculateGasPrice.name, () => {
        it("should return price with tip", () => {
            const tipRatio = new Decimal(1.5);
            const gasPricePolicy: IGasPricePolicy = new GasPriceTipPolicy(
                tipRatio
            );
            const caculatedGasPrice = gasPricePolicy.calculateGasPrice(
                new Decimal(10)
            );

            expect(caculatedGasPrice).toStrictEqual(new Decimal(15));
        });
    });
});

describe(GasPricePolicies.name, () => {
    describe(GasPricePolicies.prototype.calculateGasPrice.name, () => {
        it("should iterate all", () => {
            const gasPricePolicy: IGasPricePolicy = new GasPricePolicies([
                {
                    calculateGasPrice: jest.fn<Decimal, [Decimal]>((x) =>
                        x.mul(1.5)
                    ),
                },
                {
                    calculateGasPrice: jest.fn<Decimal, [Decimal]>((x) =>
                        x.sub(1)
                    ),
                },
            ]);

            const caculatedGasPrice = gasPricePolicy.calculateGasPrice(
                new Decimal(10)
            );
            expect(caculatedGasPrice).toStrictEqual(new Decimal(14));
        });
    });
});

describe(GasPriceLimitPolicy.name, () => {
    describe(GasPriceLimitPolicy.prototype.calculateGasPrice.name, () => {
        it("should return limited price", () => {
            const gasPricePolicy: IGasPricePolicy = new GasPriceLimitPolicy(
                new Decimal(1.1)
            );
            const caculatedGasPrice = gasPricePolicy.calculateGasPrice(
                new Decimal(10)
            );
            expect(caculatedGasPrice).toStrictEqual(new Decimal(1.1));
        });
    });
});
