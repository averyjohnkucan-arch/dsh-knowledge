/**
 * The host knowledge service (`ctx.knowledge`): durable bases/documents/chunks
 * over `ctx.storageDomain`, heading-aware chunking with context injection,
 * batched embeddings, hybrid retrieval (BM25 + vector + MMR), deduplication,
 * reindexing, URL import, and statistics — plus a JSON HTTP surface.
 * @module dsh-knowledge/knowledge
 */
import { OcrAcceleration } from './ocr-acceleration.js';
import { StructureV3Manager } from './structure-v3.js';
import { Context, Service } from '@deepseek-ai/cordis';
import { MineruDeployment } from './mineru-deployment.js';
import type { DocumentEvidence, ProcessingProgress } from './processing-types.js';
import { Config } from './config.js';
import type { ConfigOverrides } from './domain.js';
import type { LocalModelStatus } from './embed.js';
import type { LocalModelSummary } from './localModels.js';
import { type OcrModelStatus } from './ocr.js';
import { type OllamaPullStatus } from './ollama.js';
import type { AddFileDocumentRequest, AddFilesRequest, AddFilesResult, AddTextDocumentRequest, BaseConfig, BaseStats, BaseSummary, CreateBaseRequest, ContextWindow, DeleteImpact, DocumentDetail, DocumentSourceType, DocumentSummary, DirectoryImportResult, DirectorySyncItem, EmbeddingProvider, ImportDirectoryRequest, ImportUrlRequest, KnowledgeBase, KnowledgeChunk, KnowledgeConfig, KnowledgeDocument, SearchRequest, SearchResult, PathImportResult, ReindexDocumentResult, ReindexDocumentsResult, UpdateBaseRequest } from './types.js';
export type * from './types.js';
export { Config } from './config.js';
export { openStore, StorageUnavailableError } from './store.js';
export { knowledgeDomainSpec } from './domain.js';
export { chunkText } from './chunk.js';
export { extractWithMineruLocal, probeMineruLocal } from './mineru-local.js';
export { composeContextWindow, estimateContextTokens, serializeContextWindow } from './context.js';
export { embedTexts, getLocalModelStatus, DEFAULT_LOCAL_MODEL } from './embed.js';
export { tokenize, cosineSimilarity, rank } from './retrieval.js';
/** Per-call execution controls that are deliberately kept out of the public
 * search request/HTTP contract. Proactive retrieval uses these controls to
 * obtain lexical candidates without accidentally invoking a configured
 * reranker. */
export interface SearchExecutionOptions {
    readonly rerank?: 'configured' | 'skip';
    readonly signal?: AbortSignal;
    /** Absolute deadline for synchronous retrieval lanes. Internal callers use
     * this alongside signal so SQLite can interrupt itself while JS is blocked. */
    readonly deadlineAt?: number;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        knowledge: KnowledgeService;
    }
}
/** User-facing message for a local-model embedding failure. Classifies the
 *  model-cache reality (checked from disk) so a broken binding/runtime error
 *  is NOT misrouted to "download the model" — the files may be intact and the
 *  fault is a worker/binding reload (e.g. "Module did not self-register"). */
export declare function localEmbeddingErrorText(onDisk: boolean, detail: string): string;
/** Curated model-id suggestions for the settings comboboxes (DSH exposes chat models, not embedding models). */
export declare const MODEL_SUGGESTIONS: {
    readonly embedding: readonly ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002", "bge-m3", "bge-large-zh-v1.5", "bge-small-zh-v1.5", "nomic-embed-text", "mxbai-embed-large", "snowflake-arctic-embed2"];
    readonly local: string[];
    readonly rerank: readonly ["jina-reranker-v2-base-multilingual", "BAAI/bge-reranker-v2-m3", "bge-reranker-base", "bce-reranker-base_v1", "local:Xenova/bge-reranker-base"];
    readonly ollamaEmbedding: readonly ["nomic-embed-text", "bge-m3", "qwen3-embedding:0.6b", "mxbai-embed-large", "snowflake-arctic-embed"];
    readonly ollamaVision: readonly ["llava", "qwen2.5vl:7b", "llama3.2-vision:11b", "minicpm-v:8b"];
};
/**
 * Hard cap for a caller-supplied `rawTextLimit`. The limit exists to bound a
 * document payload; without an upper bound a single request could ask for the
 * whole (arbitrarily large) text, and without a lower bound a negative value
 * slices from the end instead of capping. Clamping lives in the service so
 * every caller (HTTP, tools, tests) shares the same contract.
 */
export declare const MAX_RAW_TEXT_LIMIT = 5000000;
interface BackgroundJob {
    readonly baseId: string;
    /** Human label for the unit of work (file name or document title). */
    kind: 'directory' | 'reindex';
    cancelled: boolean;
    imported: number;
    skipped: number;
    total: number;
    current: string;
    errors: Array<{
        file: string;
        error: string;
    }>;
    done: boolean;
}
/** Raised by same-name conflict detection (`conflict: 'detect'`); the HTTP
 *  layer maps it to 409 Conflict so callers can re-submit with a strategy. */
export declare class ConflictError extends Error {
    readonly code = "conflict";
}
/** Raised when a caller names a base that does not exist; the HTTP layer maps
 *  it to 404 so a typo answers "not found" instead of a plausible empty
 *  summary that hides the mistake. */
export declare class NotFoundError extends Error {
    readonly code = "not_found";
}
/** A deterministic source-identity failure. Unlike a parse or provider
 * failure, retrying without resolving the identified tree would be unsafe. */
export declare class DirectorySourceError extends Error {
    readonly code: 'ambiguous_source' | 'source_path_conflict' | 'recursive_confirmation_required';
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: 'ambiguous_source' | 'source_path_conflict' | 'recursive_confirmation_required', message: string, details?: Record<string, unknown> | undefined);
}
export declare class KnowledgeService extends Service {
    static inject: string[];
    static Config: import("@deepseek-ai/schemastery").default<Config>;
    private readonly baseConfig;
    private store;
    /** Set when the durable backend exists but could not be opened, so every
     *  store-backed call can report the real reason instead of an empty library. */
    private storageError;
    private readonly storeReady;
    private resolveStore;
    private readonly jobs;
    readonly ocrAcceleration: OcrAcceleration;
    private readonly processingMeter;
    processingSummary(): import("./processing-meter.js").ProcessingSnapshot[];
    private readonly indexing;
    /**
     * Progress values that linger after a job exits (Cherry's 60s TTL), so the
     * list keeps showing the final percentage until the poll observes the
     * terminal status instead of blanking mid-frame. Purely a display aid —
     * every guard still consults {@link indexing}, never this map.
     */
    private readonly progressLinger;
    private readonly indexingFailures;
    private readonly ingestQueues;
    private readonly baseWriteChains;
    /** Last rerank failure code per model; only state transitions are logged. */
    private readonly rerankLogState;
    private artifacts;
    private externalFolders?;
    private syncingRoots;
    private shuttingDown;
    private readonly processingQueue;
    private readonly processingProgress;
    private readonly processingControllers;
    constructor(ctx: Context, config: Config);
    protected [Service.init](): Promise<void>;
    private urlRefreshTimer;
    private urlRefreshing;
    /** Arm the hourly sweep that refreshes URL documents older than `urlRefreshHours`. */
    private armUrlRefreshTimer;
    /** Re-fetch every URL document whose last update predates `hours`; failures are logged, never thrown. */
    private refreshStaleUrls;
    /**
     * Re-index documents a crash left mid-import. Each document holds rawText
     * and/or a persisted raw source file; hash reuse (decision A4) makes the
     * re-embed re-embed only missing batches. A placeholder that only has the
     * raw file (crash before/during parse) is re-parsed from source. Runs in
     * the background so startup is not blocked.
     */
    private resumeInterruptedDocuments;
    /** Resume the persisted candidate without paying for a second parse. */
    private finishRecoveredGeneration;
    /** Wait until the durable store is ready; the HTTP route awaits this. */
    whenReady(): Promise<void>;
    getConfig(): KnowledgeConfig;
    /** Static model-id suggestions for the settings comboboxes. */
    modelSuggestions(): typeof MODEL_SUGGESTIONS;
    /** Resolve one base's effective config (global + that base's overrides). */
    getConfigFor(baseId?: string): KnowledgeConfig;
    /** Emit a structured warning on behalf of model-facing retrieval helpers. */
    warn(message: string): void;
    /**
     * Rerank settings for proactive (cross-base) retrieval, which has no single
     * base config: the global rerank model wins; otherwise the first enabled
     * base that configured one. Returns undefined when none is set.
     */
    rerankSettings(): {
        model: string;
        baseUrl: string;
        apiKey: string;
    } | undefined;
    setConfig(overrides: ConfigOverrides): Promise<KnowledgeConfig>;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    getEnabledBaseIds(): string[];
    setEnabledBaseIds(ids: readonly string[]): Promise<void>;
    /**
     * Resolve the effective search scope for a model call. `undefined` means no
     * ids were configured (every base); an empty array means a non-empty saved
     * selection has gone entirely stale and must fail closed.
     */
    enabledScope(): string[] | undefined;
    /** Existing bases inside the strict model-invocation scope. */
    enabledBases(): BaseSummary[];
    assertInternalImport(baseId: string): void;
    pickSourceFolder(): Promise<{
        path: string | null;
    }>;
    updateExternalSource(id: string, request: UpdateBaseRequest & {
        reconcileNow?: boolean;
    }): Promise<KnowledgeBase>;
    createBase(request: CreateBaseRequest): Promise<KnowledgeBase>;
    /** Cherry-style restore: re-embed every source document into a fresh base
     *  (with the source's current config), returning the new base. Raw source
     *  files are copied across so the restored base keeps the rebuild source. */
    restoreBase(sourceBaseId: string, name: string, config?: BaseConfig): Promise<KnowledgeBase>;
    deleteBase(id: string): Promise<void>;
    renameBase(id: string, request: UpdateBaseRequest): Promise<KnowledgeBase>;
    private readonly embeddingBackfills;
    /** Explicit full vector pass, separate from sync, parsing and chunking. */
    revectorizeBase(baseId: string): {
        queued: true;
    };
    /** Enable vectors from saved canonical text; unchanged external files must not be skipped. */
    private backfillBaseEmbeddings;
    private runEmbeddingBackfill;
    /** Fill vectors without applying newly saved parsing/chunking settings. */
    private embedExistingDocument;
    listBases(): BaseSummary[];
    listGroups(): string[];
    createGroup(name: string): Promise<string[]>;
    renameGroup(from: string, to: string): Promise<string[]>;
    deleteGroup(name: string): Promise<void>;
    addTextDocument(request: AddTextDocumentRequest): Promise<KnowledgeDocument>;
    addFileDocument(request: AddFileDocumentRequest): Promise<KnowledgeDocument & {
        skipped?: boolean;
    }>;
    /**
     * Batch file add with Cherry's server-authoritative conflict detection:
     * `conflict: 'detect'` reports every same-name collision (against existing
     * documents AND within the batch) without adding anything; `rename`/`replace`
     * add the whole batch under that strategy. The detect round may omit file
     * contents (names alone suffice); a clean detect returns `clean` so the
     * caller re-submits with contents under the rename strategy.
     */
    addFiles(request: AddFilesRequest): Promise<AddFilesResult>;
    /** Start importing a local directory as a cancellable background job. */
    importDirectory(request: ImportDirectoryRequest): Promise<{
        jobId: string;
        total: number;
    }>;
    /** Progress snapshot of an active (or just-finished) directory import. */
    directoryImportStatus(jobId: string): BackgroundJob | undefined;
    cancelDirectoryImport(jobId: string): void;
    private runDirectoryImport;
    private pruneJobs;
    /** Create a directory container item (no chunks) under an optional parent. */
    createDirectory(baseId: string, title: string, parentDirectoryId?: string): Promise<KnowledgeDocument>;
    /** Import a local directory as a nested tree of directory containers + file items. */
    importDirectoryTree(baseId: string, path: string, parentDirectoryId?: string): Promise<DirectoryImportResult>;
    /** Resolve a directory to its real filesystem identity. The stored display
     * path remains usable for reads, while comparisons use {@link sourcePathKey}
     * so Windows casing and separators cannot create a second source root. */
    private canonicalDirectoryPath;
    /** Canonical identity for any one local source path. Two spellings of the
     * same real file — macOS `/var` versus `/private/var`, a symlink, or a
     * Windows junction — must never become two sources, so every stored local
     * path is written in its resolved form rather than the spelling the caller
     * happened to use. A path that cannot be resolved falls back to its
     * normalized form (validation has already proven it exists). */
    private canonicalSourcePath;
    /** Stable comparison key for paths that are already validated as local
     * sources. `resolve` normalizes separators; Windows uses case-insensitive
     * identity even when the physical volume preserves the original case. */
    private sourcePathKey;
    private sameSourcePath;
    private relativeSourcePath;
    /** Create or reuse exactly one source-root container. A duplicate path never
     * silently creates a second tree, and a legacy ambiguous tree is never
     * guessed or merged. */
    private prepareDirectoryImport;
    /** Import a single local file by its absolute path (server-side). */
    importFileFromPath(baseId: string, filePath: string): Promise<{
        imported: boolean;
        title: string;
    }>;
    /**
     * Import a local path (directory tree or single file) by its absolute path,
     * validating that it exists first. Directories reuse the tree import, which
     * records `sourcePath` on every container so reindex rescans the disk.
     */
    importFromPath(baseId: string, path: string): Promise<PathImportResult>;
    /**
     * Repoint exactly one top-level file or directory source. Source identity is
     * explicit: a base may contain several independent roots of the same kind,
     * and editing one must never redirect its siblings.
     */
    setBaseSourcePath(baseId: string, sourceId: string, path: string): Promise<{
        set: number;
    }>;
    addUrlDocument(request: ImportUrlRequest): Promise<KnowledgeDocument>;
    /**
     * Cherry-style URL refresh: re-fetch the page, and when its text changed,
     * overwrite the snapshot and re-index the document (hash reuse re-embeds
     * only the chunks that changed). A failed fetch or an unchanged page leaves
     * the current snapshot and index untouched — refresh never degrades.
     */
    refreshUrlDocument(id: string): Promise<{
        changed: boolean;
        title: string;
        chunkCount: number;
    }>;
    /** Preview the exact tree and durable raw snapshots affected by a delete.
     * This is read-only and is safe to call before showing a destructive UI. */
    getDeleteImpact(id: string): DeleteImpact;
    private assertDeleteImpacts;
    deleteDocument(id: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    /** Post-delete cleanup: drop chunk rows whose document is already gone (a
     *  batch that landed after the row was deleted keeps matching the retrieval
     *  lanes, which scope by base rather than by document existence), then
     *  reclaim space. */
    private reconcileAfterDelete;
    /** Threshold-gated space reclamation after a delete (Cherry's reclaimSpace). */
    private reclaimAfterDelete;
    /** Delete one document (recursing into directory containers), one write per item. */
    private deleteDocumentRecursive;
    /**
     * Throw when the document (or its base) vanished while indexing was in
     * flight — Cherry's deleting-guard: a delete that lands mid-import or
     * mid-reindex must never be resurrected by the finishing writes, and chunks
     * must never land under a deleted base.
     */
    private assertIndexTargetAlive;
    renameDocument(id: string, title: string): Promise<KnowledgeDocument>;
    reindexDocument(id: string, options?: {
        mode?: 'reparse' | 'rechunk';
        strictSource?: boolean;
    }): Promise<ReindexDocumentResult>;
    private reindexDocumentAttempt;
    /**
     * Extract a file's text through the base's configured processor chain: the
     * remote MinerU API first when this base selects it for a PDF, then the local
     * parsers. Returns the text plus the remote failure reason when one occurred.
     *
     * Import and every later rebuild (reindex, startup resume) go through here,
     * so a document imported with MinerU is rebuilt with MinerU too — a scanned
     * PDF whose remote extraction failed is recoverable by reindexing instead of
     * being stuck on a local parser that cannot read it. Throws only when the
     * remote processor was tried AND the local parsers also failed, with both
     * reasons in the message (the import row then shows why the remote failed,
     * which used to be log-only). An aborted extraction (the document was
     * deleted) is rethrown as-is: it must not fall back to a local parse that can
     * hold the worker for minutes.
     */
    private extractDocumentText;
    /** Rebuild source text of a document. A path-imported single file (sourcePath)
     *  is re-read from disk first so EDITS and a repointed source (setBaseSourcePath)
     *  are picked up, refreshing the persisted raw copy; otherwise the raw copy
     *  (parsed through the base's configured processor: MinerU first when set),
     *  then persisted text, then reconstructed chunks are used. Returns the rebuilt
     *  text and, when the raw copy was refreshed, its new base-relative path. */
    private sourceTextOf;
    /** Reindexing a tracked directory is the same operation as re-importing its
     * source: one source identity, one diff engine, and one truthful result. */
    private rescanDirectory;
    private readonly directoryWriteBatches;
    /** Synchronize a single source-root against disk. Root validation happens
     * before any write; child failures are preserved as itemized `partial`
     * outcomes instead of being rethrown after useful work succeeds. */
    private syncDirectorySource;
    private performDirectorySync;
    private bindDocumentSourcePath;
    private directoryItemError;
    /** Resolve a direct child by its physical source path. A legacy child can be
     * adopted only when its name and kind are unique; two candidates are an
     * explicit ambiguity, never a first-match guess. */
    private resolveDirectoryChild;
    private syncDirectoryNode;
    private ingestDirectoryFile;
    /** Persist source/placeholder before parsing, so path imports recover just
     * like uploads if the host stops during a long-running processor call. */
    private ingestPathFile;
    private ingestPathFileAttempt;
    /** Returns unchanged only when the live bytes exactly match the stored raw
     * snapshot. A changed source is parsed once up front so an invalid on-disk
     * replacement cannot be silently treated as a successful old-snapshot
     * rebuild. */
    private syncDirectoryFile;
    private deleteTrackedSyncSubtree;
    /** Reindex a whole base synchronously. Collects per-root failures instead of
     *  aborting the sweep: one unreadable source (a moved folder, an unmounted
     *  drive) must not stop the remaining documents, exactly as the background job
     *  and the bulk endpoint already behave. */
    reindexBase(baseId: string): Promise<{
        reindexed: number;
        skipped: number;
        failed: number;
        items: DirectorySyncItem[];
    }>;
    /** Start re-embedding a whole base as a cancellable background job.
     *
     *  `total` counts the folded SOURCE ROOTS the job walks, which is the same unit
     *  as `imported`, so `imported / total` stays meaningful. `documentTotal` is the
     *  size of the base in documents, because a client that compares the job's
     *  total with its document count would otherwise read one directory holding 200
     *  files as a single unit of work. */
    startReindexBase(baseId: string): Promise<{
        jobId: string;
        total: number;
        documentTotal: number;
    }>;
    /** Progress snapshot of an active (or just-finished) reindex job. */
    reindexJobStatus(jobId: string): BackgroundJob | undefined;
    cancelReindexJob(jobId: string): void;
    private runReindexJob;
    reindexDocuments(ids: readonly string[]): Promise<ReindexDocumentsResult>;
    /** Delete a selection (folded to its outermost roots).
     *
     *  `deleted` is the number of DOCUMENTS removed, including the descendants of
     *  a selected directory — the meaning it had before 4.0 folded the selection.
     *  Counting folded roots instead made the confirmation ("delete these N rows")
     *  and the result ("deleted: 1" for a directory holding 200 files) describe the
     *  same action with different numbers. `roots` carries the folded count. */
    deleteDocuments(ids: readonly string[], options?: {
        recursive?: boolean;
    }): Promise<{
        deleted: number;
        roots: number;
    }>;
    /**
     * Resolve inclusion metadata and title exclusions within the requested base
     * scope. Exclusion-only requests leave docIds absent rather than enumerating
     * every remaining document. An empty docIds array matches no documents.
     */
    private resolveSearchFilter;
    /**
     * Fold a set of selected document ids to its outermost roots (Cherry's
     * `getOutermostSelectedItemIds`): ids that are descendants of another
     * selected id are dropped, so a directory plus one of its children in the
     * same batch resolves to just the directory — the subtree is then handled
     * once by the recursive operations.
     */
    private outermostSelectedIds;
    listDocuments(baseId: string): DocumentSummary[];
    /** Pre-order DFS outline of one base's directory tree (kb_list outline mode). */
    listBaseOutline(baseId: string): {
        baseId: string;
        totalItems: number;
        nodes: Array<{
            depth: number;
            docId: string;
            title: string;
            type: DocumentSourceType;
            status: string;
        }>;
    };
    /** Live progress plus recent terminal failures for client-side recovery. */
    indexingStatus(): Array<{
        docId: string;
        baseId: string;
        title: string;
        phase: 'parsing' | 'embedding';
        progress: number;
        status?: 'running';
        processingProgress?: ProcessingProgress;
    } | {
        docId: string;
        baseId: string;
        title: string;
        phase: 'parsing' | 'embedding';
        progress: number;
        status: 'failed';
        error: {
            code: string;
            message: string;
        };
    }>;
    /** Probe only the saved endpoint: never accept an arbitrary caller URL. */
    readonly mineruDeployment: MineruDeployment;
    get managementBindHost(): string;
    checkProcessor(baseId?: string): Promise<import("./processing-types.js").ProcessorCapabilities>;
    cancelProcessing(id: string): {
        cancelled: boolean;
    };
    readDocumentEvidence(id: string, options?: {
        revision?: string;
        pageIndex?: number;
        blockId?: string;
        blockOffset?: number;
        maxTokens?: number;
    }): Promise<DocumentEvidence>;
    getEvidenceAsset(id: string, assetId: string, revision: string): Promise<{
        fileName: string;
        bytes: Uint8Array;
        mimeType: string;
    }>;
    /** Current download/load state of an in-process embedding model. */
    getLocalModelStatus(modelId?: string): Promise<LocalModelStatus>;
    /**
     * Embed one probe text through the given (or current) embedding config and
     * return the vector width — Cherry's `useEmbeddingDimensions` probe, run
     * before a config save so a wrong-dimension model is caught up front.
     * Local models answer from the catalog without loading the ~600MB pipeline.
     */
    probeEmbeddingDimensions(options?: {
        provider?: EmbeddingProvider;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
    }): Promise<number>;
    enterEmbeddingForeground(): Promise<() => void>;
    embeddingAccelerationStatus(model?: string): Promise<import("./embedding-acceleration.js").EmbeddingAccelerationStatus>;
    prepareEmbeddingAcceleration(model?: string): Promise<import("./embedding-acceleration.js").EmbeddingAccelerationStatus>;
    listLocalModels(): Promise<LocalModelSummary[]>;
    downloadLocalModel(id: string): Promise<LocalModelSummary>;
    registerCustomLocalReranker(id: string): Promise<LocalModelSummary>;
    selfTestLocalModel(id: string): Promise<LocalModelSummary>;
    cancelLocalModel(id: string): Promise<LocalModelSummary>;
    deleteLocalModel(id: string): Promise<LocalModelSummary>;
    readonly structureV3: StructureV3Manager;
    getStructureStatus(): Promise<import("./structure-v3.js").StructureStatus>;
    prepareStructure(): Promise<import("./structure-v3.js").StructureStatus>;
    getOcrStatus(): OcrModelStatus;
    downloadOcr(): Promise<OcrModelStatus>;
    deleteOcr(): Promise<{
        deleted: true;
    }>;
    listOllamaModels(baseUrl: string): Promise<Array<{
        name: string;
        size?: number;
    }>>;
    deleteOllamaModel(model: string, baseUrl: string): Promise<void>;
    pullOllamaModel(model: string, baseUrl: string): Promise<void>;
    cancelOllamaPull(model: string): void;
    getOllamaPullStatus(model: string): OllamaPullStatus;
    /** In-flight pulls (the panel restores its progress cards from this on open). */
    activeOllamaPulls(): Array<{
        model: string;
        status: OllamaPullStatus['status'];
        progress: number;
        message: string;
    }>;
    /** Resolve and create the directory only when the settings page opens it. */
    prepareLocalModelCacheDirectory(path?: string): Promise<{
        path: string;
    }>;
    /**
     * Migrate downloaded local models (and OCR files) from the current cache
     * directory to `to`, then point the config there. Loaded models are
     * released first so file locks (Windows) cannot block the move; moves fall
     * back to copy+delete across drives. The directory may be empty — the
     * config still switches, so future downloads land in the new location.
     */
    migrateLocalModels(to: string): Promise<{
        moved: number;
        from: string;
        to: string;
    }>;
    listChunks(documentId: string, limit?: number, offset?: number): KnowledgeChunk[];
    /** Read a bounded ordered context window around one current chunk anchor. */
    getDocumentContext(documentId: string, options: {
        anchorChunkId?: string;
        anchorIndex?: number;
        before?: number;
        after?: number;
        maxTokens?: number;
        focus?: string;
        crossHeading?: boolean;
    }): {
        id: string;
        baseId: string;
        title: string;
        sourceType: DocumentSourceType;
        charCount: number;
        chunkCount: number;
        contextWindow: ContextWindow;
    };
    getDocument(id: string, opts?: {
        includeChunks?: boolean;
        rawTextLimit?: number;
    }): DocumentDetail;
    /** Original source bytes of a file document (for the download route). */
    getRawFile(id: string): Promise<{
        bytes: Uint8Array;
        fileName: string;
        mimeType?: string;
    } | undefined>;
    /** Read one document's source text as a `[charStart, charEnd)` slice (kb_read read mode). */
    readDocumentText(id: string, charStart?: number, charEnd?: number): {
        id: string;
        baseId: string;
        title: string;
        sourceType: DocumentSourceType;
        totalChars: number;
        charStart: number;
        charEnd: number;
        content: string;
        truncated: boolean;
    };
    /** Grep one document's source text for a regular expression (kb_read grep mode). */
    grepDocument(id: string, pattern: string, maxMatches?: number, ignoreCase?: boolean): {
        id: string;
        baseId: string;
        title: string;
        totalMatches: number;
        matches: Array<{
            line: number;
            charStart: number;
            charEnd: number;
            snippet: string;
        }>;
    };
    stats(baseId?: string): BaseStats;
    search(request: SearchRequest, execution?: SearchExecutionOptions): Promise<SearchResult>;
    /** One retrieval pass. Multi-query orchestration lives in search() so each
     * variant cannot independently invoke an expensive reranker. */
    private searchSingle;
    /** Merge independent query rankings with RRF, then optionally rerank once. */
    private finishMultiQuerySearch;
    /** Shared tail: rerank (optional), threshold + top-K cut, and hit mapping. */
    private finishSearch;
    /** One canonical rerank stage for both single-query retrieval and RRF-fused
     * multi-query retrieval. It owns contextual input, deadline/retry policy,
     * stable tie handling, structured degradation, and original-order fallback. */
    private applyRerank;
    private rerankProvider;
    private notNeededRerankStatus;
    private appliedRerankStatus;
    private degradedRerankStatus;
    private logRerankFailure;
    /**
     * How many parse+ingest tasks may run concurrently per base (Cherry Studio:
     * 5, on a per-base queue). Local-model inference no longer constrains this:
     * it runs in a dedicated worker thread (see embed.ts), exactly like Cherry's
     * own-worker embedding service.
     */
    private static readonly INGEST_CONCURRENCY;
    private ingestConcurrency;
    /** Queue one parse+ingest task behind a per-base worker pool (Cherry's job queue). */
    private enqueueIngest;
    private pumpIngestQueue;
    /** Serialize a read-then-write section per base (dedup check + first persist). */
    private withBaseWriteLock;
    /**
     * Resolve once every queued/active ingest task has settled (all bases).
     * Pipeline/test helper — the HTTP surface never needs it because the client
     * polls /indexing-status. Throws when the tasks do not drain in time.
     * The initial 25ms tick lets a fire-and-forget task (e.g. the in-place
     * backfill after a model change) reach its first indexing entry before the
     * first busy() probe, avoiding a false "idle".
     */
    waitForIdle(timeoutMs?: number): Promise<void>;
    private ingestDocument;
    private processingChunks;
    private buildChunks;
    /** Embed one batch through the configured provider (empty input → empty output). */
    private embedTextsOnce;
    /**
     * Embed with Cherry's job retry policy: 3 attempts, exponential backoff
     * (1s → 30s), so a transient provider/network failure self-heals instead of
     * degrading a whole import to lexical-only. An external abort (delete)
     * interrupts the request chain immediately.
     */
    private embedWithRetry;
    /** Bump the base's updatedAt so the data view's "更新于" stays meaningful. */
    private touchBase;
    private requireStore;
}
/**
 * Clamp a caller-supplied `rawTextLimit` to `[0, MAX_RAW_TEXT_LIMIT]`.
 * `undefined` and non-finite values mean "no cap" (the caller did not ask for
 * one); anything else is truncated and bounded. Exported for tests.
 */
export declare function clampRawTextLimit(limit: number | undefined): number | undefined;
export default KnowledgeService;
//# sourceMappingURL=index.d.ts.map