import Decimal from "decimal.js";
import { GasPriceTipPolicy, IGasPricePolicy } from "../../src/policies/gas-price";

describe(GasPriceTipPolicy.name, () => {
    describe(GasPriceTipPolicy.prototype.calculateGasPrice.name, () => {
        it("should return price with tip", () => {
            const tipRatio = new Decimal(1.5);
            const gasPricePolicy: IGasPricePolicy = new GasPriceTipPolicy(tipRatio);
            const caculatedGasPrice = gasPricePolicy.calculateGasPrice(new Decimal(10));

            expect(caculatedGasPrice).toStrictEqual(new Decimal(15));
        })
    })
})
