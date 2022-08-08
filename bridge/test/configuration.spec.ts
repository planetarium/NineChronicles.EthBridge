import { Configuration } from "../src/configuration";

const ENV_NAME = "NAME";

describe("Configuration", () => {
    describe("get", () => {
        describe("with valid value", () => {
            it("should return string value", () => {
                process.env[ENV_NAME] = "VALUE";
                expect(Configuration.get(ENV_NAME)).toEqual("VALUE");
                expect(Configuration.get(ENV_NAME, false)).toEqual("VALUE");
                expect(Configuration.get("UNDEFINED", false)).toEqual(
                    undefined
                );
            });

            it("should return integer value", () => {
                const expected = 100;
                process.env[ENV_NAME] = expected.toString();
                expect(Configuration.get(ENV_NAME, true, "integer")).toEqual(
                    expected
                );
                expect(Configuration.get(ENV_NAME, false, "integer")).toEqual(
                    expected
                );
                expect(
                    Configuration.get("UNDEFINED", false, "integer")
                ).toEqual(undefined);
            });

            it("should return float value", () => {
                const expected = 1.1;
                process.env[ENV_NAME] = expected.toString();
                expect(Configuration.get(ENV_NAME, true, "float")).toEqual(
                    expected
                );
                expect(Configuration.get(ENV_NAME, false, "float")).toEqual(
                    expected
                );
                expect(Configuration.get("UNDEFINED", false, "float")).toEqual(
                    undefined
                );
            });

            it("should return 'TRUE' as boolean value", () => {
                process.env[ENV_NAME] = "TRUE";
                expect(Configuration.get(ENV_NAME, true, "boolean")).toEqual(
                    true
                );
                expect(Configuration.get(ENV_NAME, false, "boolean")).toEqual(
                    true
                );
                expect(
                    Configuration.get("UNDEFINED", false, "boolean")
                ).toEqual(false);
            });

            it("should return 'FALSE' as boolean value", () => {
                process.env[ENV_NAME] = "FALSE";
                expect(Configuration.get(ENV_NAME, true, "boolean")).toEqual(
                    false
                );
                expect(Configuration.get(ENV_NAME, false, "boolean")).toEqual(
                    false
                );
                expect(
                    Configuration.get("UNDEFINED", false, "boolean")
                ).toEqual(false);
            });
        });

        for (const testcase of [".1", "FALSE", "", "*"]) {
            describe(`with incorrect number '${testcase}'`, () => {
                it("should throw error", () => {
                    process.env[ENV_NAME] = testcase;
                    expect(() =>
                        Configuration.get(ENV_NAME, true, "integer")
                    ).toThrowError();
                    expect(() =>
                        Configuration.get(ENV_NAME, false, "integer")
                    ).toThrowError();
                });
            });
        }

        for (const testcase of [".1", "FALSE", "", "*", "1.1.1"]) {
            describe(`with incorrect float '${testcase}'`, () => {
                it("should throw error", () => {
                    process.env[ENV_NAME] = testcase;
                    expect(() =>
                        Configuration.get(ENV_NAME, true, "float")
                    ).toThrowError();
                    expect(() =>
                        Configuration.get(ENV_NAME, false, "float")
                    ).toThrowError();
                });
            });
        }

        for (const testcase of [".", "", "NOT", "TRON"]) {
            describe(`with incorrect boolean '${testcase}'`, () => {
                it("should throw error", () => {
                    process.env[ENV_NAME] = testcase;
                    expect(() =>
                        Configuration.get(ENV_NAME, true, "boolean")
                    ).toThrowError();
                    expect(() =>
                        Configuration.get(ENV_NAME, false, "boolean")
                    ).toThrowError();
                });
            });
        }
    });
});
