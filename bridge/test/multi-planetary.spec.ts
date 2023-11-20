import Decimal from "decimal.js";
import { MultiPlanetary } from "../src/multi-planetary";

describe(MultiPlanetary.name, () => {
    const planetIds = {
        odin: "0x100000000000",
        heimdall: "0x100000000001",
    };
    const planetVaultAddress = {
        heimdall: "0xaaaaa6db35d5eff2f0b0758c5ac4c354debaf118",
    };
    const multiPlanetary = new MultiPlanetary(planetIds, planetVaultAddress);

    const ncAddress = "0x6d29f9923C86294363e59BAaA46FcBc37Ee5aE2e";

    const odinRequest = planetIds.odin + ncAddress.slice(2) + "0".repeat(12);
    const heimdallRequest =
        planetIds.heimdall + ncAddress.slice(2) + "0".repeat(12);

    const otherValidMultiPlanetTypeId = "0x100000000002";
    const otherValidPlanetRequest =
        otherValidMultiPlanetTypeId + ncAddress.slice(2) + "0".repeat(12);

    const invalidMultiPlanetTypeId = "0xabc000000123";
    const invalidPlanetRequest =
        invalidMultiPlanetTypeId + ncAddress.slice(2) + "0".repeat(12);

    describe("Check Methods of MultiPlanetary", () => {
        it("isMultiPlanetRequest", () => {
            expect(multiPlanetary.isMultiPlanetRequest(odinRequest)).toEqual(
                true
            );

            expect(
                multiPlanetary.isMultiPlanetRequest(heimdallRequest)
            ).toEqual(true);

            expect(
                multiPlanetary.isMultiPlanetRequest(otherValidPlanetRequest)
            ).toEqual(true);

            expect(
                multiPlanetary.isMultiPlanetRequest(invalidPlanetRequest)
            ).toEqual(false);
        });

        it("getRequestPlanetName", () => {
            expect(
                multiPlanetary.getRequestPlanetName(invalidPlanetRequest)
            ).toEqual("odin");

            expect(
                multiPlanetary.getRequestPlanetName(otherValidPlanetRequest)
            ).toEqual("odin");

            expect(multiPlanetary.getRequestPlanetName(odinRequest)).toEqual(
                "odin"
            );

            expect(
                multiPlanetary.getRequestPlanetName(heimdallRequest)
            ).toEqual("heimdall");
        });

        it("isOtherPlanetRequest", () => {
            expect(multiPlanetary.isOtherPlanetRequest("odin")).toEqual(false);
            expect(multiPlanetary.isOtherPlanetRequest("heimdall")).toEqual(
                true
            );

            expect(multiPlanetary.isOtherPlanetRequest("otherPlanet")).toEqual(
                true
            );
        });

        it("getPlanetVaultAddress", () => {
            expect(multiPlanetary.getPlanetVaultAddress("heimdall")).toEqual(
                planetVaultAddress.heimdall
            );
        });
    });
});
