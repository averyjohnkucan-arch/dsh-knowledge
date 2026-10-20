/**
 * Plugin configuration (schemastery) and resolved-config merging. The
 * cordis.yml `config:` block supplies deployment defaults; the browser panel
 * can override them at runtime (persisted in the domain global slot), and
 * every base can layer its own per-base config on top.
 * @module dsh-knowledge/knowledge/config
 */
import Schema from '@deepseek-ai/schemastery';
import type { ConfigOverrides } from './domain.js';
import type { BaseConfig, EmbeddingProvider, KnowledgeConfig, SearchMode } from './types.js';
import type { DocumentProcessor, MineruTier } from './processing-types.js';
export interface Config {
    ocrEnabled?: boolean;
    structureV3Charts?: boolean;
    embeddingProvider: EmbeddingProvider;
    embeddingBaseUrl: string;
    embeddingModel: string;
    embeddingApiKey: string;
    rerankModel: string;
    rerankBaseUrl: string;
    rerankApiKey: string;
    /** Total local rerank budget, including queue wait (10–300 seconds). */
    localRerankTimeoutMs: number;
    smartChunk: boolean;
    chunkSeparator: string;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    searchMode: SearchMode;
    similarityThreshold: number;
    mmrDiversity: number;
    /** Relative weight of the vector lane in RRF hybrid fusion (0.1–5, 1 = balanced). */
    rrfVectorWeight: number;
    embeddingBatchSize: number;
    /** Neighbouring chunks (±) attached to each search hit as context (0–3). */
    siblingChunks: number;
    /** Local-model cache root; empty = `<DSH_HOME>/cache/dsh-knowledge/local-models`. */
    localModelCacheDir: string;
    /** Hugging Face endpoint override (mirror); empty = official hub / `HF_ENDPOINT` env. */
    hfEndpoint: string;
    /** Optional package index for the isolated managed MinerU environment. */
    mineruPythonIndexUrl?: string;
    /** Chunk SQLite file; empty = `<DSH_HOME>/storages/knowledge-chunks.sqlite`. */
    chunkStorePath: string;
    /** Built-in parsing, legacy MinerU cloud, or an independently deployed V1 service. */
    documentProcessorProvider: Exclude<DocumentProcessor, 'paddle'>;
    /** MinerU API key (required when provider is `mineru`). */
    mineruApiKey: string;
    /** MinerU API host; empty = https://mineru.net */
    mineruApiHost: string;
    mineruLocalUrl?: string;
    mineruLocalApiKey?: string;
    mineruTier?: MineruTier;
    documentProcessingTimeoutMs?: number;
    structuredChunking?: boolean;
    /** Semantic chunking: embed paragraph-level segments and merge similar adjacent ones. */
    semanticChunk: boolean;
    /** Cosine threshold below which adjacent segments start a new chunk (0–1). */
    semanticChunkThreshold: number;
    /** Token budget per chunk (0 = off); oversized chunks split at preferred boundaries. */
    chunkTokenLimit: number;
    /** Same-name conflict strategy for file imports: keep / replace / rename (Cherry's default). */
    conflictStrategy: 'keep' | 'replace' | 'rename';
    /** Auto-refresh URL documents older than this many hours (0 = off). */
    urlRefreshHours: number;
    /** Image/table captioning: `off` / `openai` (vision chat API) / `ollama` (local VLM). */
    imageCaptionProvider: 'off' | 'paddle' | 'openai' | 'ollama';
    /** Captioning model id (OpenAI-compatible vision model, or an Ollama VLM like llava / qwen2.5vl). */
    imageCaptionModel: string;
    /** Captioning API root; empty = the embedding base URL (openai) or http://127.0.0.1:11434 (ollama). */
    imageCaptionBaseUrl: string;
    /** Captioning API key (openai provider). */
    imageCaptionApiKey: string;
    /**
     * Re-run interrupted imports on startup (hash reuse re-embeds only the
     * batches that never landed). Off = mark them failed instead — Cherry's
     * posture: a deliberate app quit must not re-spend the embedding API.
     */
    resumeInterruptedOnStartup: boolean;
    /**
     * Proactive auto-retrieval: on every user message, cheaply search the
     * enabled bases and inject clearly relevant chunks as model-visible
     * background, so imported facts reach the model even without an explicit
     * "use the knowledge base" instruction or a knowledge_search call.
     */
    autoRetrieve: boolean;
    /** Include the short available-base list in the system prompt. */
    injectUsagePrompt?: boolean;
    /**
     * Auto-retrieve seat cap per base (0–5, default 3; 0 excludes a base):
     * how many of THIS base's chunks may enter one injection.
     */
    autoRetrieveWeight: number;
    /**
     * Local-model worker idle timeout in ms (default 60000). After this much
     * idle time the worker UNLOADS its loaded models (pipeline.dispose frees
     * the ~600MB ONNX sessions) but STAYS ALIVE — the binding is loaded exactly
     * once per process, so the Linux respawn failure ("Module did not
     * self-register") cannot happen; the next request reloads from disk (~1s).
     * 0 keeps the models hot forever (fastest, at the cost of resident memory).
     */
    localEmbeddingIgpuIdle?: boolean;
    localEmbeddingMainGpuIdle?: boolean;
    localEmbeddingThreads?: number;
    localEmbeddingInstances?: number;
    localEmbeddingMicroBatchSize?: number;
    localWorkerIdleTimeoutMs: number;
}
export declare const Config: Schema<Config>;
/** Resolve a full config from deployment defaults plus runtime overrides. */
export declare function resolveConfig(config: Config, overrides: ConfigOverrides): KnowledgeConfig;
/**
 * Resolve one base's effective config: plugin defaults, then global runtime
 * overrides, then that base's own per-base config (highest precedence for
 * the fields it sets).
 */
export declare function resolveConfigFor(config: Config, overrides: ConfigOverrides, baseConfig?: BaseConfig): KnowledgeConfig;
//# sourceMappingURL=config.d.ts.map