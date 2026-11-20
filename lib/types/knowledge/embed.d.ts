import { LOCAL_MODEL_RUNTIME } from './local-model-runtime.js';
import type { EmbeddingProvider } from './types.js';
/** Default in-process model — the ONNX repo Cherry Studio ships. */
export declare const DEFAULT_LOCAL_MODEL = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
/**
 * Override the local-model cache root from deployment config. An empty or
 * unset value falls back to DSH's shared home resolution (`$DSH_HOME` → `~/.dsh`).
 */
export declare function setLocalModelCacheDir(dir: string | undefined): void;
/**
 * Override the Hugging Face endpoint from deployment/runtime config — the
 * mirror switch for networks that cannot reach huggingface.co directly
 * (e.g. `https://hf-mirror.com`). An empty value falls back to the
 * `HF_ENDPOINT` environment variable, then to the official hub.
 */
export declare function setHfEndpoint(url: string | undefined): void;
/** The effective HF endpoint override (mirror), or undefined (tests/telemetry). */
export declare function getHfEndpoint(): string | undefined;
export declare function expandHomePath(input: string): string;
/** Persistent cache directory for downloaded local models (mirrors DSH's `resolveDshHome`). */
export declare function localModelCacheDir(): string;
/** Embed many texts into normalized vectors. Throws when the provider is `none` or the call fails. */
export declare function embedTexts(provider: EmbeddingProvider, baseUrl: string, model: string, apiKey: string, texts: readonly string[], signal?: AbortSignal, purpose?: 'query' | 'index', dimensions?: number): Promise<number[][]>;
export interface LocalModelStatus {
    model: string;
    status: 'idle' | 'downloading' | 'ready' | 'error';
    /** 0–100 download progress while `downloading`. */
    progress: number;
    message: string;
}
/** Persistent evidence that a local embedding model was opened in the
 * isolated runtime and produced a validated vector. */
export interface LocalEmbeddingReadiness {
    readonly schemaVersion: 1;
    readonly modelId: string;
    readonly fingerprint: string;
    readonly dimensions: number;
    readonly validatedAt: number;
    readonly runtime: typeof LOCAL_MODEL_RUNTIME & {
        readonly node: string;
    };
}
type Pooling = 'last_token' | 'cls' | 'mean';
/**
 * Per-model pooling strategy, mirroring Cherry Studio's `pooling.ts`: the
 * model family decides how the token embeddings are collapsed into one vector.
 * - Qwen3-Embedding → last-token pooling
 * - BGE (small/base, zh/en) → CLS token pooling
 * - GTE / E5 → mean pooling (transformers.js default)
 * Unknown ids fall back to mean pooling, which is the safest general choice.
 */
export declare function poolingFor(modelId: string): Pooling;
export declare function getLocalModelStatus(modelId: string): LocalModelStatus;
/** Surface a background download/load failure so the settings poller can show it (never swallow). */
export declare function markLocalModelError(modelId: string, message: string): void;
/** Whether a model's cached weights are already on disk (a real `.onnx` weight file). */
export declare function isLocalModelDownloaded(modelId: string): Promise<boolean>;
export declare function getLocalEmbeddingReadiness(modelId: string): Promise<LocalEmbeddingReadiness | undefined>;
export declare function setLocalEmbeddingTuning(config: {
    localEmbeddingThreads?: number;
    localEmbeddingInstances?: number;
    localEmbeddingMicroBatchSize?: number;
}): void;
/** Configure the local-model process idle release timeout (0 = never release). */
export declare function setLocalWorkerIdleTimeoutMs(ms: number): void;
/**
 * Local cross-encoder rerank (bge-reranker family): scores each candidate
 * text against the query, index-aligned. It deliberately uses the separate
 * rerank child process so its lifecycle can never disturb embeddings.
 */
export declare function rerankLocal(modelId: string, query: string, texts: readonly string[]): Promise<number[]>;
/** Download + load a local model in an isolated process (no inference). */
export declare function loadLocalModel(modelId: string, task?: 'feature-extraction' | 'reranking'): Promise<void>;
/** Cancel only an active download. A previously ready model is never removed. */
export declare function cancelLocalModel(modelId: string): Promise<void>;
/** Drop a loaded extractor (frees its native sessions) and delete its cached weights. */
export declare function removeLocalModel(modelId: string): Promise<void>;
/** Gracefully terminate the isolated embedding process during plugin teardown. */
export declare function disposeLocalModelWorker(): Promise<void>;
/** Whether any local model download is currently in flight (migration guard). */
export declare function hasActiveLocalModelDownload(): boolean;
/** L2-normalize a vector in place. */
export declare function normalize(vector: number[]): number[];
export {};
//# sourceMappingURL=embed.d.ts.map