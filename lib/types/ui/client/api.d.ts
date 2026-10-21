import type { ProcessingSnapshot } from '../../knowledge/processing-meter.js';
/**
 * Browser fetch client for the knowledge host service. Same-origin JSON calls
 * against `/knowledge/*`, with local types mirroring the host vocabulary (the
 * client bundle never imports host modules).
 * @module dsh-knowledge/client/api
 */
import type { DocumentProcessingInfo, DocumentSourceSpan, MineruTier, ParsedAsset, ParsedBlock, ProcessingProgress, ProcessorCapabilities } from '../../knowledge/processing-types.js';
import type { MineruDeploymentPlan, MineruDeploymentStatus, MineruPythonDiscovery, MineruPythonEnvironment } from '../../knowledge/mineru-deployment-types.js';
export type { MineruDeploymentPlan, MineruDeploymentStatus, MineruPythonDiscovery, MineruPythonEnvironment };
export type { DocumentProcessingInfo, DocumentSourceSpan, MineruTier, ParsedAsset, ParsedBlock, ProcessingProgress, ProcessorCapabilities };
export type EmbeddingProvider = 'openai' | 'ollama' | 'local' | 'none';
export type SearchMode = 'auto' | 'hybrid' | 'vector' | 'lexical';
export interface BaseConfig {
    embeddingProvider?: EmbeddingProvider;
    embeddingBaseUrl?: string;
    embeddingModel?: string;
    embeddingApiKey?: string;
    rerankModel?: string;
    rerankBaseUrl?: string;
    rerankApiKey?: string;
    localRerankTimeoutMs?: number;
    keepInternalMarkdown?: boolean;
    smartChunk?: boolean;
    chunkSeparator?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    searchMode?: SearchMode;
    similarityThreshold?: number;
    mmrDiversity?: number;
    rrfVectorWeight?: number;
    embeddingBatchSize?: number;
    siblingChunks?: number;
    ocrEnabled?: boolean;
    structureV3Charts?: boolean;
    documentProcessorProvider?: 'builtin' | 'mineru' | 'mineru-local';
    mineruApiKey?: string;
    mineruApiHost?: string;
    mineruLocalUrl?: string;
    mineruLocalApiKey?: string;
    mineruTier?: MineruTier;
    documentProcessingTimeoutMs?: number;
    structuredChunking?: boolean;
    semanticChunk?: boolean;
    semanticChunkThreshold?: number;
    semanticChunkCandidateTokens?: number;
    chunkTokenLimit?: number;
    conflictStrategy?: 'keep' | 'replace' | 'rename';
    urlRefreshHours?: number;
    imageCaptionProvider?: 'off' | 'paddle' | 'openai' | 'ollama';
    imageCaptionModel?: string;
    imageCaptionBaseUrl?: string;
    imageCaptionApiKey?: string;
    autoRetrieve?: boolean;
    injectUsagePrompt?: boolean;
    autoRetrieveWeight?: number;
    resumeInterruptedOnStartup?: boolean;
}
/** One origin line for a base: where its content came from (shown under the
 *  base name in the detail header — path for directories/files, link for URLs,
 *  "node" for manually added text). */
export interface BaseSourceInfo {
    /** Top-level document/container that owns this source. */
    sourceId: string;
    kind: 'text' | 'file' | 'url' | 'directory';
    /** Directory path / file name / URL / 'node'. */
    text: string;
    /** Absolute tracked path when this source can be repointed. */
    sourcePath?: string;
}
export interface BaseSummary {
    storageMode?: 'internal' | 'external';
    externalPath?: string;
    syncEnabled?: boolean;
    syncIntervalSeconds?: number;
    syncStatus?: {
        state: string;
        message?: string;
        checkedAt?: number;
    };
    id: string;
    name: string;
    description: string;
    group?: string;
    documentCount: number;
    /** Documents with a persisted raw source copy (actually imported & stored). */
    storedDocCount: number;
    chunkCount: number;
    charCount: number;
    tokenCount: number;
    config?: BaseConfig;
    /** Top-level sources of the base's content, for display (bounded). */
    sourceInfo?: BaseSourceInfo[];
    createdAt: number;
    updatedAt: number;
}
/** One itemized outcome of a directory synchronization, mirroring the host. */
export interface DirectorySyncItem {
    relativePath: string;
    kind: 'file' | 'directory';
    documentId?: string;
    action: 'created' | 'updated' | 'unchanged' | 'deleted' | 'failed';
    error?: {
        code: string;
        message: string;
    };
}
/** The truthful aggregate a directory import or rescan returns. */
export interface DirectorySyncResult {
    sourceId: string;
    status: 'synced' | 'unchanged' | 'partial';
    created: number;
    updated: number;
    unchanged: number;
    deleted: number;
    failed: number;
    items: DirectorySyncItem[];
}
/** Read-only preview of what one delete would remove. The panel fetches this
 *  before a destructive call so a cascading directory delete is never silent. */
export interface DeleteImpact {
    documentId: string;
    baseId: string;
    directories: number;
    files: number;
    chunks: number;
    rawSnapshots: number;
    /** True only when the target is a non-empty directory that needs an explicit
     *  recursive confirmation before the host will accept the delete. */
    requiresRecursive: boolean;
}
export interface DocumentSummary {
    markdownRevision?: string;
    id: string;
    baseId: string;
    title: string;
    sourceType: 'text' | 'file' | 'url' | 'directory';
    fileName?: string;
    url?: string;
    parentDirectoryId?: string;
    /** Absolute tracked path for a local-path source (administrative view only). */
    sourcePath?: string;
    charCount: number;
    tokenCount?: number;
    chunkCount: number;
    childCount?: number;
    embedded: boolean;
    embeddingError?: string;
    errorCode?: 'interrupted' | 'dimension_mismatch' | 'parse_failed' | 'embedding_provider';
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    indexingProgress?: number;
    indexingPhase?: 'parsing' | 'embedding';
    processing?: DocumentProcessingInfo;
    processingProgress?: ProcessingProgress;
    createdAt: number;
    updatedAt?: number;
}
export interface LocalModelStatus {
    model: string;
    status: 'idle' | 'downloading' | 'ready' | 'error';
    progress: number;
    message: string;
}
export interface ModelSuggestions {
    embedding: string[];
    local: string[];
    rerank: string[];
    /** Ollama registry embedding recommendations (for provider `ollama`). */
    ollamaEmbedding: string[];
    /** Ollama registry vision-model recommendations (for image captioning). */
    ollamaVision: string[];
}
export interface LocalModelSummary {
    id: string;
    name: string;
    kind: 'embedding' | 'reranking';
    support?: 'official' | 'experimental';
    subtitle: string;
    status: 'ready' | 'not_downloaded' | 'downloading' | 'validating' | 'unhealthy' | 'error';
    health: 'unchecked' | 'checking' | 'healthy' | 'unhealthy';
    progress: number;
    message: string;
    lastCheckedAt?: number;
    latencyMs?: number;
}
export interface ChunkView {
    id: string;
    docId: string;
    baseId: string;
    index: number;
    text: string;
    heading?: string;
    context?: string;
    sourceSpans?: readonly DocumentSourceSpan[];
}
export interface KnowledgeConfig {
    embeddingProvider: EmbeddingProvider;
    embeddingBaseUrl: string;
    embeddingModel: string;
    embeddingApiKey: string;
    rerankModel: string;
    rerankBaseUrl: string;
    rerankApiKey: string;
    localRerankTimeoutMs: number;
    keepInternalMarkdown?: boolean;
    smartChunk: boolean;
    chunkSeparator: string;
    chunkSize: number;
    chunkOverlap: number;
    topK: number;
    searchMode: SearchMode;
    similarityThreshold: number;
    mmrDiversity: number;
    rrfVectorWeight: number;
    embeddingBatchSize: number;
    semanticChunk: boolean;
    semanticChunkThreshold: number;
    semanticChunkCandidateTokens?: number;
    chunkTokenLimit: number;
    conflictStrategy: 'keep' | 'replace' | 'rename';
    urlRefreshHours: number;
    imageCaptionProvider: 'off' | 'paddle' | 'openai' | 'ollama';
    imageCaptionModel: string;
    imageCaptionBaseUrl: string;
    imageCaptionApiKey: string;
    localModelCacheDir: string;
    siblingChunks: number;
    hfEndpoint: string;
    mineruPythonIndexUrl?: string;
    ocrEnabled?: boolean;
    structureV3Charts?: boolean;
    documentProcessorProvider: 'builtin' | 'mineru' | 'mineru-local';
    mineruApiKey: string;
    mineruApiHost: string;
    mineruLocalUrl?: string;
    mineruLocalApiKey?: string;
    mineruTier?: MineruTier;
    documentProcessingTimeoutMs?: number;
    structuredChunking?: boolean;
    resumeInterruptedOnStartup: boolean;
    autoRetrieve: boolean;
    injectUsagePrompt?: boolean;
    autoRetrieveWeight: number;
    /** Local-model worker idle timeout in ms (0 = never release; keeps the
     *  model hot and avoids an onnxruntime binding reload on respawn). */
    localEmbeddingIgpuIdle?: boolean;
    localEmbeddingMainGpuIdle?: boolean;
    localOcrGpuWorkers?: number;
    localEmbeddingThreads?: number;
    localEmbeddingInstances?: number;
    localEmbeddingMicroBatchSize?: number;
    localWorkerIdleTimeoutMs: number;
}
export interface SearchHit {
    indexedMarkdownUrl?: string;
    chunkId: string;
    docId: string;
    baseId: string;
    documentTitle: string;
    heading?: string;
    index: number;
    text: string;
    /** Ordered, token-bounded evidence around the canonical hit. Optional for
     * compatibility with 0.3.7 servers and persisted responses. */
    contextWindow?: ContextWindow;
    /** @deprecated Prefer contextWindow; retained throughout 0.3.x. */
    siblingContext?: string;
    score: number;
    vectorScore?: number;
    lexicalScore?: number;
    sourceSpans?: readonly DocumentSourceSpan[];
}
export interface ContextChunkExcerpt {
    chunkId: string;
    index: number;
    heading?: string;
    text: string;
    /** UTF-16 offsets relative to this chunk's canonical text. */
    textStart: number;
    textEnd: number;
    truncatedStart: boolean;
    truncatedEnd: boolean;
    sourceSpans?: readonly DocumentSourceSpan[];
}
export interface ContextWindow {
    anchorChunkId: string;
    anchorIndex: number;
    before: ContextChunkExcerpt[];
    anchor: ContextChunkExcerpt;
    after: ContextChunkExcerpt[];
    estimatedTokens: number;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
}
export interface SearchResult {
    query: string;
    mode: SearchMode;
    scoreKind?: 'lexical_relevance' | 'vector_similarity' | 'rrf' | 'rerank';
    retrieval?: {
        requestedMode: SearchMode;
        effectiveMode: SearchMode;
        lexical: {
            attempted: boolean;
            succeeded: boolean;
            returnedCount: number;
            errorCode?: string;
        };
        vector: {
            attempted: boolean;
            succeeded: boolean;
            returnedCount: number;
            errorCode?: string;
        };
    };
    total: number;
    reranked: boolean;
    rerank?: RerankStatus;
    elapsedMs: number;
    hits: SearchHit[];
}
export interface RerankStatus {
    configured: true;
    provider: 'local' | 'remote';
    model: string;
    status: 'applied' | 'not_needed' | 'skipped' | 'degraded';
    attempted: boolean;
    applied: boolean;
    candidateCount: number;
    elapsedMs?: number;
    error?: {
        code: 'model_not_downloaded' | 'model_checking' | 'model_unhealthy' | 'unsupported_model' | 'timeout' | 'invalid_response' | 'runtime_error' | 'process_crash' | 'circuit_open' | 'busy' | 'provider_error';
        message: string;
        retryable: boolean;
        action?: 'download_model' | 'run_self_test' | 'check_config' | 'retry_later';
    };
}
export interface BaseStats {
    baseId?: string;
    documentCount: number;
    /** Documents with a persisted raw source copy (actually imported & stored). */
    storedDocCount: number;
    chunkCount: number;
    charCount: number;
    tokenCount: number;
    embedded: boolean;
    embeddedChunkCount?: number;
    embeddingDimensions?: number;
    staleEmbeddings?: boolean;
    staleChunkCount?: number;
}
export interface DocumentDetail {
    markdownRevision?: string;
    id: string;
    baseId: string;
    title: string;
    sourceType: 'text' | 'file' | 'url' | 'directory';
    fileName?: string;
    url?: string;
    rawText?: string;
    rawTextTruncated?: boolean;
    charCount: number;
    tokenCount?: number;
    chunkCount: number;
    createdAt: number;
    chunks?: ChunkView[];
    processing?: DocumentProcessingInfo;
}
export interface DocumentEvidence {
    documentId: string;
    title: string;
    processing?: DocumentProcessingInfo;
    blocks: ParsedBlock[];
    assets: ParsedAsset[];
    estimatedTokens: number;
    truncated: boolean;
    next?: {
        blockId: string;
        blockOffset: number;
    };
}
export interface DirectoryImportStatus {
    baseId: string;
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
export declare class KnowledgeApi {
    private call;
    getConfig(): Promise<KnowledgeConfig>;
    planMineruDeployment(root: string, existingModels?: string, pythonExecutable?: string): Promise<MineruDeploymentPlan>;
    detectMineruPython(executable?: string): Promise<MineruPythonDiscovery>;
    mineruDeploymentStatus(): Promise<MineruDeploymentStatus>;
    prepareMineruDeployment(planId: string): Promise<MineruDeploymentStatus>;
    mineruDeploymentAction(action: 'start' | 'stop' | 'cancel'): Promise<MineruDeploymentStatus>;
    useManagedMineru(): Promise<{
        applied: boolean;
    }>;
    checkProcessor(baseId?: string): Promise<ProcessorCapabilities>;
    getLocalModelStatus(model?: string): Promise<LocalModelStatus>;
    getModelSuggestions(): Promise<ModelSuggestions>;
    listLocalModels(): Promise<LocalModelSummary[]>;
    downloadLocalModel(id: string): Promise<LocalModelSummary>;
    registerCustomLocalReranker(id: string): Promise<LocalModelSummary>;
    selfTestLocalModel(id: string): Promise<LocalModelSummary>;
    cancelLocalModel(id: string): Promise<LocalModelSummary>;
    removeLocalModel(id: string): Promise<LocalModelSummary>;
    getOcrAcceleration(): Promise<{
        status: string;
        message: string;
        devices: Array<{
            device: string;
            name: string;
            qualified: boolean;
            medianMs?: number;
            error?: string;
        }>;
    }>;
    prepareOcrAcceleration(): Promise<{
        status: string;
        message: string;
        devices: Array<{
            device: string;
            name: string;
            qualified: boolean;
            medianMs?: number;
            error?: string;
        }>;
    }>;
    getStructureStatus(): Promise<{
        status: string;
        progress: number;
        message: string;
        device: string;
    }>;
    prepareStructure(): Promise<{
        status: string;
        progress: number;
        message: string;
        device: string;
    }>;
    getOcrStatus(): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    downloadOcr(): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    removeOcr(): Promise<{
        deleted: boolean;
    }>;
    migrateLocalModels(to: string): Promise<{
        moved: number;
        from: string;
        to: string;
    }>;
    /** Prepare the selected/default cache directory without saving or moving models. */
    prepareLocalModelCacheDirectory(path?: string): Promise<{
        path: string;
    }>;
    listOllamaModels(baseUrl: string): Promise<{
        models: Array<{
            name: string;
            size?: number;
        }>;
    }>;
    pullOllamaModel(model: string, baseUrl: string): Promise<{
        started: boolean;
    }>;
    cancelOllamaPull(model: string): Promise<{
        cancelled: boolean;
    }>;
    deleteOllamaModel(model: string, baseUrl: string): Promise<{
        deleted: boolean;
    }>;
    getOllamaPullStatus(model: string): Promise<{
        status: string;
        progress: number;
        message: string;
    }>;
    /** In-flight pulls, so the settings panel restores its cards after close/reopen. */
    listActiveOllamaPulls(): Promise<{
        pulls: Array<{
            model: string;
            status: string;
            progress: number;
            message: string;
        }>;
    }>;
    setConfig(overrides: Partial<KnowledgeConfig>): Promise<KnowledgeConfig>;
    /**
     * Embed one probe text through the given (or current) embedding config and
     * return the vector width (Cherry's dimension probe, run before a save).
     */
    baseLive(baseId: string): Promise<{
        updatedAt: number;
        syncStatus?: BaseSummary['syncStatus'];
        stats: BaseStats;
    }>;
    getEmbeddingAcceleration(model?: string): Promise<import('../../knowledge/embedding-acceleration.js').EmbeddingAccelerationStatus>;
    prepareEmbeddingAcceleration(model?: string): Promise<import('../../knowledge/embedding-acceleration.js').EmbeddingAccelerationStatus>;
    probeEmbeddingDimensions(options?: {
        provider?: EmbeddingProvider;
        baseUrl?: string;
        model?: string;
        apiKey?: string;
    }): Promise<number>;
    pickFolder(): Promise<{
        path: string | null;
    }>;
    externalSettings(id: string, patch: {
        syncEnabled?: boolean;
        syncIntervalSeconds?: number;
        reconcileNow?: boolean;
    }): Promise<unknown>;
    listBases(): Promise<BaseSummary[]>;
    createBase(name: string, description: string, group: string, config?: BaseConfig, external?: {
        storageMode: 'internal' | 'external';
        externalPath?: string;
        syncIntervalSeconds?: number;
    }): Promise<{
        id: string;
        name: string;
    }>;
    updateBase(id: string, patch: {
        name?: string;
        description?: string;
        group?: string;
        config?: BaseConfig;
    }): Promise<{
        id: string;
        name: string;
    }>;
    /**
     * Batch file add with server-authoritative conflict detection: 'detect'
     * returns {status:'conflicts'} listing every collision (or 'clean'), and
     * 'rename'/'replace' add the whole batch under that strategy.
     */
    addFiles(baseId: string, files: Array<{
        fileName: string;
        mimeType?: string;
        contentBase64?: string;
    }>, conflict: 'detect' | 'rename' | 'replace', parentDirectoryId?: string): Promise<{
        status: 'conflicts';
        conflicts: string[];
    } | {
        status: 'clean';
    } | {
        status: 'added';
        accepted: Array<{
            id: string;
            title: string;
            fileName: string;
            skipped?: boolean;
        }>;
    }>;
    deleteBase(id: string): Promise<{
        deleted: boolean;
    }>;
    listGroups(): Promise<string[]>;
    createGroup(name: string): Promise<string[]>;
    renameGroup(from: string, to: string): Promise<string[]>;
    deleteGroup(name: string): Promise<{
        deleted: boolean;
    }>;
    getKnowledgeToggle(): Promise<{
        enabled: boolean;
        enabledBaseIds: string[];
    }>;
    setKnowledgeToggle(patch: {
        enabled?: boolean;
        enabledBaseIds?: string[];
    }): Promise<{
        enabled: boolean;
        enabledBaseIds: string[];
    }>;
    stats(baseId?: string): Promise<BaseStats>;
    startReindexBase(baseId: string): Promise<{
        jobId: string;
        total: number;
    }>;
    restoreBase(baseId: string, name: string, config?: BaseConfig): Promise<{
        id: string;
        name: string;
    }>;
    getReindexJob(jobId: string): Promise<DirectoryImportStatus>;
    cancelReindexJob(jobId: string): Promise<{
        cancelled: boolean;
    }>;
    listDocuments(baseId: string): Promise<DocumentSummary[]>;
    addTextDocument(baseId: string, title: string, content: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
    }>;
    addFileDocument(baseId: string, fileName: string, mimeType: string, contentBase64: string, conflict?: 'keep' | 'replace' | 'rename' | 'detect', parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
        skipped?: boolean;
    }>;
    createDirectory(baseId: string, title: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
    }>;
    addUrlDocument(baseId: string, url: string, parentDirectoryId?: string): Promise<{
        id: string;
        title: string;
        chunkCount: number;
    }>;
    startDirectoryImport(baseId: string, path: string): Promise<{
        jobId: string;
        total: number;
    }>;
    importDirectoryTree(baseId: string, path: string): Promise<{
        imported: number;
        directories: number;
        errors: Array<{
            file: string;
            error: string;
        }>;
        sourceId: string;
        mode: 'created' | 'synced';
        sync: DirectorySyncResult;
    }>;
    /** Import a local directory or single file by its absolute path (validated server-side). */
    importFromPath(baseId: string, path: string): Promise<{
        kind: 'directory' | 'file';
        imported: number;
        errors: Array<{
            file: string;
            error: string;
        }>;
        directories?: number;
        sourceId?: string;
        mode?: 'created' | 'synced';
        sync?: DirectorySyncResult;
    }>;
    /** Repoint the base's source path (validated server-side). */
    setBaseSourcePath(baseId: string, sourceId: string, path: string): Promise<{
        set: number;
    }>;
    getDirectoryImport(jobId: string): Promise<DirectoryImportStatus>;
    cancelDirectoryImport(jobId: string): Promise<{
        cancelled: boolean;
    }>;
    startFolderSync(id: string): Promise<{
        jobId: string;
    }>;
    folderSyncStatus(jobId: string): Promise<{
        state: 'running' | 'complete' | 'failed';
        result?: DirectorySyncResult;
        error?: string;
    }>;
    getProcessingSummary(): Promise<ProcessingSnapshot[]>;
    getIndexingStatus(): Promise<Array<{
        docId: string;
        baseId: string;
        title: string;
        phase: 'parsing' | 'embedding';
        progress: number;
        status?: 'running' | 'failed';
        processingProgress?: ProcessingProgress;
        error?: {
            code: string;
            message: string;
        };
    }>>;
    documentStatus(id: string): Promise<Pick<DocumentSummary, 'status' | 'embedded' | 'chunkCount' | 'charCount' | 'tokenCount' | 'updatedAt' | 'embeddingError' | 'errorCode' | 'indexingPhase' | 'indexingProgress'>>;
    getDocument(documentId: string, opts?: {
        rawTextLimit?: number;
    }): Promise<DocumentDetail>;
    renameDocument(documentId: string, title: string): Promise<{
        id: string;
        title: string;
    }>;
    revectorizeBase(baseId: string): Promise<{
        queued: true;
    }>;
    reindexDocument(documentId: string, mode?: 'reparse' | 'rechunk'): Promise<{
        id: string;
        chunkCount: number;
        sync?: DirectorySyncResult;
    }>;
    cancelProcessing(documentId: string): Promise<{
        cancelled: boolean;
    }>;
    readDocumentEvidence(documentId: string, options?: {
        revision?: string;
        pageIndex?: number;
        blockId?: string;
        blockOffset?: number;
        maxTokens?: number;
    }): Promise<DocumentEvidence>;
    refreshUrlDocument(documentId: string): Promise<{
        changed: boolean;
        title: string;
        chunkCount: number;
    }>;
    reindexDocuments(ids: string[]): Promise<{
        reindexed: number;
        skipped: number;
        failed: number;
        items: DirectorySyncItem[];
    }>;
    /** Preview the subtree and durable snapshots a delete would remove. */
    getDeleteImpact(documentId: string): Promise<DeleteImpact>;
    deleteDocument(id: string, recursive?: boolean): Promise<{
        deleted: boolean;
    }>;
    /** Delete a selection. `deleted` is the number of documents removed (including
     *  the descendants of a selected directory); `roots` is the folded count. */
    deleteDocuments(ids: string[], recursive?: boolean): Promise<{
        deleted: number;
        roots: number;
    }>;
    listChunks(documentId: string, limit?: number): Promise<ChunkView[]>;
    search(request: {
        query: string;
        baseId?: string;
        topK?: number;
        mode?: SearchMode;
        threshold?: number;
        filter?: {
            docIds?: string[];
            excludeDocIds?: string[];
            titleIncludes?: string;
            titleExcludes?: string[];
            sourceTypes?: string[];
            updatedAfter?: number;
            updatedBefore?: number;
        };
    }): Promise<SearchResult>;
}
//# sourceMappingURL=api.d.ts.map