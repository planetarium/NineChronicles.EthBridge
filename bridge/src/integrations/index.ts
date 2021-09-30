export interface Integration {
    error(summary: string, error: Record<string, any>): void;
}
