/** Parent-side lifecycle, queue, timeout, and circuit breaker for local reranking. */
import { type LocalRerankProgressEvent } from './rerank-protocol.js';
export type LocalRerankFailureCode = 'model_not_downloaded' | 'model_checking' | 'model_unhealthy' | 'unsupported_model' | 'timeout' | 'invalid_response' | 'runtime_error' | 'process_crash' | 'circuit_open' | 'busy';
export declare class LocalRerankError extends Error {
    readonly code: LocalRerankFailureCode;
    readonly retryable: boolean;
    constructor(code: LocalRerankFailureCode, message: string, retryable: boolean);
}
export interface LocalRerankHealthReport {
    healthy: true;
    latencyMs: number;
    scores: number[];
    batchSize: number;
}
/** Whether a rerank request will pay a model load before it can score. */
export declare function localRerankChildIsWarm(): boolean;
export declare function setLocalRerankIdleTimeoutMs(ms: number): void;
export declare function setLocalRerankProgressListener(listener: ((event: LocalRerankProgressEvent) => void) | undefined): void;
/** Observe child teardown (idle release, timeout, crash, abort, dispose) so the
 *  caller can drop the state that only that child could have cleared. */
export declare function setLocalRerankChildGoneListener(listener: ((modelId: string) => void) | undefined): void;
export declare function rerankInLocalProcess(modelId: string, cacheDir: string, hfEndpoint: string | undefined, query: string, texts: readonly string[], timeoutMs: number, signal?: AbortSignal): Promise<number[]>;
export declare function loadLocalReranker(modelId: string, cacheDir: string, hfEndpoint?: string): Promise<void>;
export declare function selfTestLocalReranker(modelId: string, cacheDir: string, hfEndpoint?: string): Promise<LocalRerankHealthReport>;
export declare function releaseLocalReranker(modelId: string, cacheDir: string, hfEndpoint?: string): Promise<void>;
export declare function cancelLocalReranker(modelId: string): Promise<void>;
export declare function disposeLocalRerankProcess(): Promise<void>;
/** Test-only visibility without exposing process handles. */
export declare function localRerankRuntimeSnapshot(): {
    active: boolean;
    queued: number;
    process: boolean;
};
//# sourceMappingURL=local-rerank.d.ts.map