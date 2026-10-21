/**
 * Store abstraction over the knowledge data. The service reads and writes
 * plain data through one interface; implementations back it:
 * - a durable `DomainStore` — business state (bases, documents, runtime
 *   config) over `ctx.storageDomain`, chunks in a dedicated SQLite file
 *   (`ChunkDatabase`) so writes stay O(1) no matter how much data grows;
 * - an in-memory `MemoryStore` used when the storage backend is unavailable
 *   (e.g. a headless profile without a configured storage route, or tests).
 * @module dsh-knowledge/knowledge/store
 */
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain';
import type { ConfigOverrides } from './domain.js';
import type { RetrievalLane, StagedDocumentGeneration } from './chunkdb.js';
import type { KnowledgeBase, KnowledgeChunk, KnowledgeDocument } from './types.js';
export type ChunkIdentity = Pick<KnowledgeChunk, 'id' | 'index' | 'text'> & {
    searchText: string;
};
export interface ChunkStats {
    documents?: {
        documentCount: number;
        storedDocCount: number;
        charCount: number;
        tokenCount: number;
    };
    count: number;
    embedded: boolean;
    embeddedCount: number;
    dimensions?: number;
    /** Distinct embedding-model tags on embedded chunks (count per base+model). */
    embeddingModelCounts: Array<{
        baseId: string;
        model: string;
        count: number;
    }>;
}
/**
 * Original source bytes of uploaded documents (Cherry's `raw/` material store):
 * "import means copy" — the base keeps its own stable copy, and reindex can
 * re-read + re-parse the source instead of only reusing the persisted text.
 * Stored under `<chunkStorePath dir>/knowledge-raw/<baseId>/<docId><ext>`.
 */
export interface RawFileStore {
    /** Persist one document's source bytes; returns the base-relative path. */
    write(baseId: string, docId: string, ext: string, bytes: Uint8Array): Promise<string>;
    /**
     * Persist bytes at a caller-chosen base-relative path (e.g. a directory
     * import's `sub/name.pdf`), preserving the on-disk tree. Returns the
     * base-relative path.
     */
    writeRel(baseId: string, relativePath: string, bytes: Uint8Array): Promise<string>;
    /** Read a document's source bytes back (null when absent). */
    read(relativePath: string): Promise<Uint8Array | null>;
    /** Every stored base-relative path (for orphan-raw reconciliation). */
    listAll(): Promise<string[]>;
    /** Remove one document's source file by its stored relative path (missing = no-op). */
    delete(relativePath: string): Promise<void>;
    /** Remove every source file of a base. */
    deleteBase(baseId: string): Promise<void>;
}
/** Filesystem-backed {@link RawFileStore}. */
export declare class RawFileStorage implements RawFileStore {
    private readonly root;
    constructor(root: string);
    private pathOf;
    write(baseId: string, docId: string, ext: string, bytes: Uint8Array): Promise<string>;
    writeRel(baseId: string, relativePath: string, bytes: Uint8Array): Promise<string>;
    read(relativePath: string): Promise<Uint8Array | null>;
    listAll(): Promise<string[]>;
    delete(relativePath: string): Promise<void>;
    deleteBase(baseId: string): Promise<void>;
}
export interface Store {
    listBases(): KnowledgeBase[];
    writeDiagnostics?(): {
        batches: number;
        documents: number;
        batchSizes: Record<string, number>;
        pendingDocuments: number;
        pendingEstimatedBytes: number;
    };
    getBase(id: string): KnowledgeBase | undefined;
    putBase(base: KnowledgeBase): Promise<void>;
    deleteBase(id: string): Promise<void>;
    listDocuments(baseId: string, options?: {
        includeRawText?: boolean;
    }): KnowledgeDocument[];
    getDocument(id: string): KnowledgeDocument | undefined;
    hasDocumentsWithoutSource(baseId: string): boolean;
    putDocument(doc: KnowledgeDocument): Promise<void>;
    deleteDocument(id: string): Promise<void>;
    /** Incremental candidate batches, invisible until commit; same revision upserts. */
    stageDocumentGeneration(doc: KnowledgeDocument, chunks: KnowledgeChunk[]): Promise<void>;
    discardStagedDocumentGeneration(docId: string): Promise<void>;
    getStagedDocumentGeneration(docId: string): StagedDocumentGeneration | undefined;
    /** Publish complete chunks + recovery metadata, then reconcile DomainKV. */
    commitDocumentGeneration(doc: KnowledgeDocument, chunks: KnowledgeChunk[]): Promise<void>;
    recoverDocumentGenerations(): Promise<number>;
    listChunks(baseId: string): KnowledgeChunk[];
    getChunk(id: string): KnowledgeChunk | undefined;
    listChunksByDoc(docId: string, limit?: number, offset?: number): KnowledgeChunk[];
    /** Text identities only; avoids loading vectors merely to retain stable citation IDs. */
    listChunkIdentitiesByDoc?(docId: string): ChunkIdentity[];
    /** Chunks of one document whose index falls in `[fromIdx, toIdx]` (sibling context around a search hit). */
    listChunksByIndexRange(docId: string, fromIdx: number, toIdx: number): KnowledgeChunk[];
    /** Several merged document ranges fetched as one storage operation. */
    listChunksByIndexRanges(ranges: readonly {
        docId: string;
        fromIdx: number;
        toIdx: number;
    }[]): KnowledgeChunk[];
    putChunks(chunks: KnowledgeChunk[]): Promise<void>;
    /**
     * Incrementally persist a batch of chunks WITHOUT clearing the document's
     * other rows (the crash-recovery write path — each embedded batch lands
     * here, so a mid-embedding crash keeps every completed batch).
     */
    putChunkBatch(chunks: KnowledgeChunk[]): Promise<void>;
    /** Delete a document's chunks; pass `baseId` to scope the delete to one base. */
    deleteChunks(docId: string, baseId?: string): Promise<void>;
    /** Drop every chunk of a base in one operation (used by deleteBase). */
    deleteChunksByBase(baseId: string): Promise<void>;
    /**
     * Library-wide vector reuse: stored vectors for the given embedding-text
     * hashes under one embedding model (Cherry's `listExistingEmbeddingHashes` /
     * decision A4). The caller embeds only the hashes missing from the result,
     * so re-embedding unchanged chunk text reuses the stored vector.
     */
    listEmbeddingVectorsByHashes(hashes: readonly string[], embeddingModel: string): Map<string, number[]>;
    /** Actual chunk count per document, for reconciling stale document metadata. */
    chunkCountsByDoc(baseIds: readonly string[]): Map<string, number>;
    /** Per-doc chunk presence + embedding coverage in one pass (document lists). */
    docEmbeddingStatus?(docId: string, expectedModel?: string): {
        count: number;
        embeddedCount: number;
    };
    docChunkStatus(baseId: string, expectedModel?: string): {
        withChunks: Set<string>;
        missingEmbedding: Set<string>;
    };
    /**
     * Startup self-healing, returning:
     * - `removed`: documents a crashed import left behind with nothing to
     *   recover — non-directory items with no chunks, no rawText AND no raw
     *   source file whose last update predates this process's start.
     * - `resume`: documents that hold recoverable material — rawText (crash
     *   mid-embedding, chunks partial) or a persisted raw source file (crash
     *   before/during parse) — re-indexed by the service after startup.
     */
    recoverInterruptedImports(startedAt: number): Promise<{
        removed: number;
        resume: string[];
    }>;
    /** Remove raw source copies no document references (orphans from failed/duplicate imports). */
    reconcileOrphanRaws(): Promise<number>;
    /** Remove chunk rows whose document no longer exists — the mirror of
     *  {@link reconcileOrphanRaws} for the chunk store. Returns how many orphaned
     *  documents had their chunks removed. A delete that lands while a batch is
     *  in flight can leave rows behind that keep matching the retrieval lanes
     *  (they scope by base, not by document existence). */
    reconcileOrphanChunks(): Promise<number>;
    /** Aggregate chunk stats without loading chunk rows. */
    chunkStats(baseIds: readonly string[]): ChunkStats;
    chunkStatsAsync?(baseIds: readonly string[]): Promise<ChunkStats>;
    docChunkStatusAsync?(baseId: string, expectedModel?: string): Promise<{
        withChunks: Set<string>;
        missingEmbedding: Set<string>;
    }>;
    /** SQL-backed retrieval lanes (FTS5 + vector scan); absent on in-memory stores. */
    readonly retrievalLane?: RetrievalLane;
    /** Original source bytes of uploaded documents (absent on in-memory stores). */
    readonly raw?: RawFileStore;
    /**
     * Return space a large delete freed back to the OS (Cherry's
     * `reclaimSpace`): WAL checkpoint, threshold-gated VACUUM + FTS optimize.
     * Absent on in-memory stores.
     */
    readonly reclaimSpace?: () => {
        vacuumed: boolean;
        reclaimedBytes: number;
    };
    getConfigOverrides(): ConfigOverrides;
    setConfigOverrides(overrides: ConfigOverrides): Promise<void>;
    getGroups(): string[];
    setGroups(groups: string[]): Promise<void>;
    getEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<void>;
    getEnabledBaseIds(): string[];
    setEnabledBaseIds(ids: string[]): Promise<void>;
    close(): Promise<void>;
}
/** Facility surface the store needs — typed locally because the class type is package-private. */
export interface StorageDomainFacility {
    open<S extends DomainSpec>(spec: S): Promise<Domain<S>>;
}
export interface OpenStoreOptions {
    /** Legacy adapter retained for compatibility tests; new stores use incremental SQLite metadata. */
    documentMetadataBackend?: 'domain' | 'sqlite';
    /** Chunk SQLite file; default `<DSH_HOME>/storages/knowledge-chunks.sqlite`. */
    chunkStorePath?: string;
    /** Legacy JSON unit file to migrate chunks from; default `<DSH_HOME>/storages/knowledge.json`. */
    legacyJsonPath?: string;
}
/** The durable backend exists but could not be opened or healed. Callers must
 *  report this rather than pretend the library is empty: the data is intact on
 *  disk, and an ephemeral store would silently discard every later write. */
export declare class StorageUnavailableError extends Error {
    constructor(message: string, options?: {
        cause?: unknown;
    });
}
/** SQL publication succeeded. Do not roll back sources or overwrite metadata. */
export declare class DocumentGenerationCommitError extends Error {
    readonly published = true;
    constructor(options?: {
        cause?: unknown;
    });
}
/**
 * Open a durable store. Business state comes from the domain facility; chunks
 * live in a plugin-owned SQLite file (`chunkStorePath`, defaulted under
 * `<DSH_HOME>/storages`). A one-time migration moves any chunks still stored
 * in the legacy JSON unit file into the SQLite store.
 *
 * Falls back to memory only when there is no facility at all (headless runs and
 * tests). Once the durable backend has been opened, a later failure — a failed
 * migration, a locked file, a rejected reconciliation write — throws
 * {@link StorageUnavailableError} instead of degrading: an in-memory store
 * would show an empty library while the user's data sits safely on disk, and
 * everything written that session would be lost on restart.
 */
export declare function openStore(facility: StorageDomainFacility | undefined, options?: OpenStoreOptions): Promise<Store>;
//# sourceMappingURL=store.d.ts.map