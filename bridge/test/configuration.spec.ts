import { assert } from "chai";
import { Configuration } from "../src/configuration";

const ENV_NAME = "NAME";

describe("Configuration", () => {
    describe("get", () => {
        context("with valid value", () => {
            it("should return string value", () => {
                process.env[ENV_NAME] = "VALUE";
                assert.equal(Configuration.get(ENV_NAME), "VALUE");
                assert.equal(Configuration.get(ENV_NAME, false), "VALUE");
                assert.equal(Configuration.get("UNDEFINED", false), undefined);
            });

            it("should return integer value", () => {
                const expected = 100;
                process.env[ENV_NAME] = expected.toString();
                assert.equal(Configuration.get(ENV_NAME, true, "integer"), expected);
                assert.equal(Configuration.get(ENV_NAME, false, "integer"), expected);
                assert.equal(Configuration.get("UNDEFINED", false, "integer"), undefined);
            });

            it("should return 'TRUE' as boolean value", () => {
                process.env[ENV_NAME] = "TRUE";
                assert.equal(Configuration.get(ENV_NAME, true, "boolean"), true);
                assert.equal(Configuration.get(ENV_NAME, false, "boolean"), true);
                assert.equal(Configuration.get("UNDEFINED", false, "boolean"), false);
            });

            it("should return 'FALSE' as boolean value", () => {
                process.env[ENV_NAME] = "FALSE";
                assert.equal(Configuration.get(ENV_NAME, true, "boolean"), false);
                assert.equal(Configuration.get(ENV_NAME, false, "boolean"), false);
                assert.equal(Configuration.get("UNDEFINED", false, "boolean"), false);
            });
        });

        for (const testcase of [".1", "FALSE", "", "*"]) {
            context(`with incorrect number '${testcase}'`, () => {
                it("should throw error", () => {
                    process.env[ENV_NAME] = testcase;
                    assert.throw(() => Configuration.get(ENV_NAME, true, "integer"));
                    assert.throw(() => Configuration.get(ENV_NAME, false, "integer"));
                });
            });
        }

        for (const testcase of [".", "", "NOT", "TRON"]) {
            context(`with incorrect boolean '${testcase}'`, () => {
                it("should throw error", () => {
                    process.env[ENV_NAME] = testcase;
                    assert.throw(() => Configuration.get(ENV_NAME, true, "boolean"));
                    assert.throw(() => Configuration.get(ENV_NAME, false, "boolean"));
                });
            });
        }
    });
});
