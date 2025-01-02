import { config } from "dotenv";

config();

type ConversionType = "string" | "integer" | "float" | "boolean";

export class Configuration {
    static get(name: string): string;
    static get(name: string, required: false): string | undefined;
    static get(name: string, required: true, type: "string"): string;
    static get(
        name: string,
        required: boolean,
        type: "string"
    ): string | undefined;
    static get(name: string, required: true, type: "integer"): number;
    static get(
        name: string,
        required: boolean,
        type: "integer"
    ): number | undefined;
    static get(name: string, required: true, type: "float"): number;
    static get(
        name: string,
        required: boolean,
        type: "float"
    ): number | undefined;
    static get(name: string, required: true, type: "boolean"): boolean;
    static get(name: string, required: boolean, type: "boolean"): boolean;
    static get(
        name: string,
        required: boolean = true,
        type: ConversionType = "string"
    ): string | undefined | number | boolean {
        const environmentVariable = process.env[name];

        if (environmentVariable === undefined && required) {
            throw new Error(`Please set '${name}' at .env`);
        }

        return this.handleType(environmentVariable, name, type);
    }

    private static handleType(
        variable: string | undefined,
        name: string,
        type: ConversionType
    ): string | number | boolean | undefined {
        switch (type) {
            case "string":
                return variable;

            case "integer":
                return this.parseInteger(variable, name);

            case "float":
                return this.parseFloat(variable, name);

            case "boolean":
                return this.parseBoolean(variable, name);

            default:
                throw new Error(`Unsupported type: ${type}`);
        }
    }

    private static parseInteger(
        variable: string | undefined,
        name: string
    ): number | undefined {
        if (variable === undefined) return undefined;

        const asInt = parseInt(variable);
        if (isNaN(asInt)) {
            throw new Error(
                `Please set '${name}' with valid integer format at .env`
            );
        }

        return asInt;
    }

    private static parseFloat(
        variable: string | undefined,
        name: string
    ): number | undefined {
        if (variable === undefined) return undefined;

        const asFloat = parseFloat(variable);
        if (isNaN(asFloat) || asFloat.toString() !== variable) {
            throw new Error(
                `Please set '${name}' with valid float format at .env`
            );
        }

        return asFloat;
    }

    private static parseBoolean(
        variable: string | undefined,
        name: string
    ): boolean {
        if (variable === undefined || variable === "FALSE") {
            return false;
        }

        if (variable === "TRUE") {
            return true;
        }

        throw new Error(
            `Please set '${name}' as 'TRUE' or 'FALSE', or remove '${name}' at .env.`
        );
    }
}
