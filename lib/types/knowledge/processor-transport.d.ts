/** Bounded transport for optional document processors. Never retries mutations. */
export declare class ProcessorError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare function processorUrl(value: string, base?: URL): URL;
export declare function checkProcessingAbort(signal: AbortSignal): void;
export declare function processingBudget(timeoutMs: number, external?: AbortSignal): {
    signal: AbortSignal;
    dispose: () => void;
};
export declare function processingDelay(ms: number, signal: AbortSignal): Promise<void>;
export declare function readProcessorBytes(response: Response, maximum: number, signal: AbortSignal): Promise<Uint8Array>;
export interface ProcessorRequest {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    maxBytes?: number;
    allowRedirects?: boolean;
    /** A transport failure cannot prove that this side effect did not occur. */
    ambiguousSubmission?: boolean;
    missingJob?: boolean;
}
export declare class ProcessorTransport {
    private readonly apiKey;
    readonly signal: AbortSignal;
    readonly base: URL;
    constructor(apiUrl: string, apiKey: string | undefined, signal: AbortSignal);
    endpoint(path: string): URL;
    bytes(target: URL, options?: ProcessorRequest): Promise<Uint8Array>;
    json(path: string, options?: ProcessorRequest): Promise<Record<string, unknown>>;
}
export declare function object(value: unknown): Record<string, unknown>;
export declare function identifier(value: unknown): string;
export declare function stringList(value: unknown): string[];
//# sourceMappingURL=processor-transport.d.ts.map