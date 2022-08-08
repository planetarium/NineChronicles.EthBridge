export type ForceOmit<T, K extends keyof T> = Omit<T, K> &
    Partial<Record<K, never>>;
