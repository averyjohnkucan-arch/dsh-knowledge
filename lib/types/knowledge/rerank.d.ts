/**
 * Rerank step (Cherry Studio's 重排模型): re-score the merged candidates
 * against the query through a Jina / SiliconFlow / Cohere-v2 style rerank
 * API (`POST {baseUrl}/rerank`), or through a local cross-encoder
 * (bge-reranker via transformers.js in the model worker) when the model id
 * carries the `local:` prefix. Disabled when no rerank model is set.
 * @module dsh-knowledge/knowledge/rerank
 */
import type { RerankErrorDetail } from './types.js';
export interface RerankCandidate {
    id: string;
    text: string;
}
/** Per-call controls for both remote and local rerank execution. */
export interface RerankExecutionOptions {
    /** Maximum number of candidates retained; defaults to every candidate. */
    topN?: number;
    /** Maximum duration of one attempt/local operation (default 60 seconds). */
    timeoutMs?: number;
    /** Absolute wall-clock deadline shared across remote retry attempts. */
    deadlineAt?: number;
    /** Extra remote attempts after the first failure (default 1). */
    retries?: number;
    /** Owner cancellation. An external abort is never retried. */
    signal?: AbortSignal;
}
export declare class RerankExecutionError extends Error {
    readonly detail: RerankErrorDetail;
    readonly status?: number | undefined;
    constructor(detail: RerankErrorDetail, status?: number | undefined, technicalMessage?: string);
}
export declare function rerankErrorDetail(error: unknown): RerankErrorDetail;
export declare function rerankTechnicalMessage(error: unknown): string;
/**
 * Rerank candidates, choosing the local worker when the model is `local:...`.
 * @param baseUrl - API root (ignored for local rerankers).
 * @param model - rerank model id (e.g. `jina-reranker-v2-base-multilingual`
 *   or `local:Xenova/bge-reranker-base`).
 * @param options - result count, timeout/shared deadline, retries, and owner
 *   cancellation. The old positional `topN, timeoutMs` form remains accepted
 *   during the 0.3.x compatibility window.
 * @returns id → validated relevance score in [0, 1], containing exactly the
 *   requested number of top-scoring candidates.
 */
export declare function rerankCandidates(baseUrl: string, model: string, apiKey: string, query: string, candidates: readonly RerankCandidate[], options?: RerankExecutionOptions): Promise<Map<string, number>>;
/** @deprecated Use the RerankExecutionOptions object overload. */
export declare function rerankCandidates(baseUrl: string, model: string, apiKey: string, query: string, candidates: readonly RerankCandidate[], topN?: number, timeoutMs?: number): Promise<Map<string, number>>;
//# sourceMappingURL=rerank.d.ts.map