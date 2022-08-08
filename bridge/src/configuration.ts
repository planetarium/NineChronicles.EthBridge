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

        if (type === "string") {
            return environmentVariable;
        }

        if (type === "integer") {
            if (environmentVariable === undefined) {
                return environmentVariable;
            }

            const asInt = parseInt(environmentVariable);
            if (isNaN(asInt)) {
                throw new Error(
                    `Please set '${name}' with valid integer format at .env`
                );
            }

            return asInt;
        }

        if (type === "float") {
            if (environmentVariable === undefined) {
                return environmentVariable;
            }

            const asFloat = parseFloat(environmentVariable);
            if (isNaN(asFloat) || asFloat.toString() !== environmentVariable) {
                throw new Error(
                    `Please set '${name}' with valid float format at .env`
                );
            }

            return asFloat;
        }

        if (type === "boolean") {
            if (
                environmentVariable === undefined ||
                environmentVariable === "FALSE"
            ) {
                return false;
            }

            if (environmentVariable === "TRUE") {
                return true;
            }

            throw new Error(
                `Please set '${name}' as 'TRUE' or 'FALSE', or remove '${name}' at .env.`
            );
        }
    }
}
