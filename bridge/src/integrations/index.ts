export type Severity = "critical" | "error" | "warning" | "info";

export interface Integration {
    /** `severity` defaults to "warning" when omitted. */
    error(
        summary: string,
        error: Record<string, any>,
        severity?: Severity
    ): void;
}
