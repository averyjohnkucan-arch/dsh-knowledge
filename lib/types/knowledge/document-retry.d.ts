export declare const DOCUMENT_MAX_ATTEMPTS = 3;
export declare function markAttemptsExhausted<T extends object>(error: T): T;
/** Nested processing stages must not multiply three attempts into nine. */
export declare function attemptsExhausted(error: unknown): boolean;
export declare function retryDocument<T>(operation: (attempt: number) => Promise<T>, options?: {
    signal?: AbortSignal;
    onRetry?: (attempt: number, error: unknown) => void | Promise<void>;
}): Promise<T>;
//# sourceMappingURL=document-retry.d.ts.map