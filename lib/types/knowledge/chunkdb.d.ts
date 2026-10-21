/**
 * Chunk storage for dsh-knowledge: a plugin-owned SQLite file (Cherry Studio's
 * "derived index" idea — the durable domain keeps business state, chunks live
 * in a dedicated engine where each write is O(1)).
 *
 * Layout (one row per chunk, not per document):
 * - `chunk` holds every retrieval field; `embedding` is a plain little-endian
 *   float32 BLOB (Cherry's A1), so the DB stays engine-portable.
 * - `chunk_fts` is an external-content FTS5 table (trigram tokenizer) over the
 *   search text (context + body), kept in sync by AFTER INSERT/DELETE/UPDATE
 *   triggers — the lexical lane.
 * - The vector lane brute-force scans the scope's BLOBs at query time (no ANN
 *   index yet — the same posture as Cherry's first version).
 *
 * Nothing is loaded into memory at open: every read is a bounded SQL query, so
 * resident memory no longer scales with the corpus.
 * @module dsh-knowledge/knowledge/chunkdb
 */
import type { KnowledgeChunk, KnowledgeDocument } from './types.js';
/** Resolve the chunk database path: explicit config, else `<DSH_HOME>/storages/`. */
export declare function resolveChunkStorePath(explicit: string | undefined): string;
/** Legacy location of the old unit file whose chunks table feeds the one-time migration. */
export declare function legacyChunkFilePath(): string;
/**
 * Stable hash of the exact text fed to the embedding model — the dedup key for
 * vector reuse (Cherry's `embedding_text_hash` / decision A4). Two chunks with
 * the same hash + embedding model share one embedding, so a re-embed (reindex,
 * chunk-size change) reuses stored vectors instead of re-spending the API.
 * The hash covers the SAME text `embedTexts` receives (context + body), so an
 * identical hash guarantees an identical vector.
 */
export declare function hashEmbeddingText(text: string): string;
/** One candidate returned by a retrieval lane: a chunk plus its lane score. */
export interface LaneHit extends KnowledgeChunk {
    score: number;
}
export interface LaneResult {
    /** Size of the scanned candidate pool (the pre-limit corpus). */
    total: number;
    hits: LaneHit[];
}
/** Document selection shared by lexical and vector candidate retrieval. */
export interface RetrievalDocumentFilter {
    /** Absent means unrestricted; an empty array matches no documents. */
    readonly docIds?: readonly string[];
    /** Exact ids removed before counting, scoring, or limiting candidates. */
    readonly excludeDocIds?: readonly string[];
    /** Vector lane only: never score a different model/export/vector format. */
    readonly embeddingModel?: string;
}
export interface RetrievalLane {
    /** FTS5 BM25 hits over the scope (score normalized into [0, 1)). */
    lexical(query: string, baseIds: readonly string[], limit: number, filter?: RetrievalDocumentFilter, deadlineAt?: number): Promise<LaneResult>;
    /** Brute-force cosine hits over the scope's stored vectors. */
    vector(embedding: readonly number[], baseIds: readonly string[], limit: number, filter?: RetrievalDocumentFilter, deadlineAt?: number): Promise<LaneResult>;
}
export interface StagedDocumentGeneration {
    readonly document: KnowledgeDocument;
    readonly chunks: KnowledgeChunk[];
}
export interface PendingDocumentGeneration {
    readonly document: KnowledgeDocument;
    readonly previousCreatedAt: number;
}
export declare function validateDocumentGeneration(doc: KnowledgeDocument, chunks: readonly KnowledgeChunk[]): void;
/** The chunk store: bounded SQL reads, single-transaction writes. */
export declare class ChunkDatabase implements RetrievalLane {
    private readonly path;
    private readonly db;
    /**
     * Per-base vector cache for the brute-force lane: vectors load lazily on
     * the first vector query for a base and stay in sync with every write
     * path, so repeated searches never re-fetch/re-decode the BLOBs. Float32
     * storage keeps the cosine loop on typed arrays. Invalidation stays
     * exact (per doc / per base), never a whole-store flush.
     */
    private readonly vectorCache;
    /** `PRAGMA data_version` observed when each base's cache was loaded, so a
     *  write from another connection invalidates it instead of being invisible. */
    private readonly vectorCacheDataVersion;
    private static readonly SELECT_COLUMNS;
    private readonly summaryWorkers;
    private readonly summaryRequests;
    constructor(path: string);
    private migrateEvidenceColumns;
    /**
     * Schema evolution for the stable FTS surrogate key: older stores keyed the
     * external-content FTS on the implicit `rowid`, which VACUUM renumbers — the
     * FTS then silently points at the wrong rows (Cherry's #16132 class). Adds
     * the `fts_rowid` column, backfills it from the current rowid, and rebuilds
     * `chunk_fts` (virtual tables cannot change their content_rowid in place).
     * Idempotent: a fresh store already has both, so only the unique index is
     * ensured. `fts_rowid` must be unique so the MAX+1 assignment in the insert
     * trigger stays a correct key — the UNIQUE index makes a violation loud.
     */
    private migrateFtsRowidColumn;
    /** One transaction and a durable marker: stale legacy rows can never resurrect deletions. */
    migrateDocumentMetadata(records: Iterable<[string, KnowledgeDocument]>): number;
    putDocumentMetadata(document: KnowledgeDocument): void;
    getDocumentMetadata(id: string): KnowledgeDocument | undefined;
    listDocumentMetadata(baseId?: string, includeRawText?: boolean): KnowledgeDocument[];
    /** Check source availability in SQL without materializing the library's text. */
    hasDocumentsWithoutSource(baseId: string): boolean;
    deleteDocumentMetadata(id: string): boolean;
    private readMeta;
    private writeMeta;
    /**
     * Schema evolution for the `embedding_text_hash` dedup column: add it to a
     * store created by an older version, then backfill the hash of every stored
     * vector from its `search_text` (the exact text the embedding model saw, so
     * the hash is authoritative for reuse). Idempotent — a fresh store already
     * has the column and nothing to backfill. The index is created here, AFTER
     * the column exists: on an old store the column does not exist when the
     * constructor's CREATE TABLE runs, and a CREATE INDEX on a missing column
     * would fail the whole open.
     */
    private migrateEmbeddingHashColumn;
    /** One-time migration from the previous per-document bundle layout. */
    private migrateFromBundleLayout;
    get size(): number;
    listChunks(baseId: string): KnowledgeChunk[];
    getChunk(id: string): KnowledgeChunk | undefined;
    listChunksByDoc(docId: string, limit?: number, offset?: number): KnowledgeChunk[];
    /** Chunks of one document whose index falls in `[fromIdx, toIdx]` — the
     *  sibling context around a search hit, fetched with one bounded SQL query. */
    listChunksByIndexRange(docId: string, fromIdx: number, toIdx: number): KnowledgeChunk[];
    /** Fetch several already-merged document ranges in one SQL statement. */
    listChunksByIndexRanges(ranges: readonly {
        docId: string;
        fromIdx: number;
        toIdx: number;
    }[]): KnowledgeChunk[];
    /** Actual chunk count per document, for reconciling stale document metadata. */
    chunkCountsByDoc(baseIds: readonly string[]): Map<string, number>;
    putChunks(chunks: KnowledgeChunk[]): void;
    /**
     * Incrementally persist a batch of chunks WITHOUT clearing the document's
     * other rows (unlike {@link putChunks}, which replaces the whole bundle).
     * This is the crash-recovery write path: `ingestDocument` embeds in batches
     * and lands each batch here, so a crash mid-embedding leaves every completed
     * batch in the store. On restart the recovery pass re-runs the embed with
     * hash reuse (decision A4) and only the missing batches hit the API.
     *
     * `ON CONFLICT(chunk_id) DO UPDATE` (not REPLACE) keeps the rowid stable, so
     * the external-content FTS trigger chain stays consistent.
     */
    putChunkBatch(chunks: KnowledgeChunk[]): void;
    /** Durable candidate batches remain invisible to both retrieval lanes. */
    stageDocumentGeneration(doc: KnowledgeDocument, chunks: KnowledgeChunk[]): void;
    getStagedDocumentGeneration(docId: string): StagedDocumentGeneration | undefined;
    /** Replace the live generation and its recovery record in ONE transaction. */
    publishDocumentGeneration(doc: KnowledgeDocument, chunks: KnowledgeChunk[], previousCreatedAt: number, atomicMetadata?: boolean): void;
    pendingDocumentGenerations(): PendingDocumentGeneration[];
    stagedDocumentHeaders(): KnowledgeDocument[];
    discardPublishedGeneration(doc: KnowledgeDocument): void;
    pendingDocumentGeneration(docId: string): PendingDocumentGeneration | undefined;
    acknowledgeDocumentGeneration(docId: string): void;
    /** Purge a KB's pending/committed generations with three scoped SQL deletes. */
    discardBaseGenerations(baseId: string): void;
    discardDocumentGenerations(docId: string): void;
    discardStagedDocumentGeneration(docId: string): void;
    deleteChunks(docId: string, baseId?: string): Promise<void>;
    deleteChunksByBase(baseId: string): Promise<void>;
    /**
     * Return space a large delete freed back to the OS (Cherry's
     * `KnowledgeIndexStore.reclaimSpace` + driver thresholds). Best-effort:
     * - Checkpoint first — cheap, and folds the delete's committed frees into
     *   the main file so `freelist_count` reflects them.
     * - VACUUM only when the freelist is a large share of the file AND a
     *   meaningful byte count; below either bound it just truncates the WAL.
     * - The external-content FTS only TOMBSTONES its trigram rows on delete (via
     *   the chunk delete trigger); the dead segment blobs linger in the shadow
     *   table, which VACUUM cannot reclaim on its own. 'optimize' merges and
     *   drops them, gated behind the same threshold so a small delete never pays
     *   the whole-index segment merge.
     * - VACUUM rewrites into the WAL, so checkpoint again to release it.
     */
    reclaimSpace(): {
        vacuumed: boolean;
        reclaimedBytes: number;
    };
    private reclaimSpaceUnchecked;
    private readPragmaInt;
    /**
     * Library-wide vector reuse (Cherry's `listExistingEmbeddingHashes`, decision
     * A4): for each embedding-text hash already stored under `embeddingModel`,
     * return its vector. The caller embeds only the hashes missing from this
     * map, so a re-embed of unchanged chunk text reuses the stored vector instead
     * of re-spending the embedding API. Matching is (hash, embedding_model) —
     * two bases in one store may use different models, so a hash alone is not a
     * valid reuse key (vectors from another model are not comparable). Rows
     * without a vector (a failed/lexical-only import) never match.
     *
     * Batch size stays well under SQLite's bound-parameter limit (Cherry uses
     * 500 for the same reason).
     */
    listEmbeddingVectorsByHashes(hashes: readonly string[], embeddingModel: string): Map<string, number[]>;
    /** Per-doc chunk presence + embedding coverage in one grouped pass (listDocuments). */
    docChunkStatus(baseId: string, expectedModel?: string): {
        withChunks: Set<string>;
        missingEmbedding: Set<string>;
    };
    /** Every document id that still has chunk rows, for orphan reconciliation:
     *  a delete that landed mid-embedding can leave batches behind whose document
     *  row is already gone, and those rows would keep matching the retrieval
     *  lanes (they scope by base, not by document existence) forever. */
    docIdsWithChunks(): Set<string>;
    /** UI scans use a read-only worker so millions of rows cannot stall LLM streaming. */
    private readSummary;
    chunkStatsAsync(baseIds: readonly string[]): Promise<ReturnType<ChunkDatabase['chunkStats']>>;
    docChunkStatusAsync(baseId: string, expectedModel?: string): Promise<ReturnType<ChunkDatabase['docChunkStatus']>>;
    /** Aggregate chunk stats for `stats()`: counts, embedding presence/dimensions, model tags. */
    chunkStats(baseIds: readonly string[]): {
        count: number;
        embedded: boolean;
        embeddedCount: number;
        dimensions?: number;
        embeddingModelCounts: Array<{
            baseId: string;
            model: string;
            count: number;
        }>;
    };
    lexical(query: string, baseIds: readonly string[], limit: number, filter?: RetrievalDocumentFilter, deadlineAt?: number): Promise<LaneResult>;
    private lexicalUnchecked;
    vector(embedding: readonly number[], baseIds: readonly string[], limit: number, filter?: RetrievalDocumentFilter, deadlineAt?: number): Promise<LaneResult>;
    /** Lazy-load a base's vectors into the cache (SQL once, then in-memory).
     *  `PRAGMA data_version` changes when ANOTHER connection commits to this
     *  file, so a second DSH process (or a second store instance) that deletes or
     *  re-embeds chunks cannot leave this lane serving vectors for rows that are
     *  gone — the "resurrect a deleted document" failure. Own writes do not bump
     *  it, which is why the local write paths still update the cache in place. */
    private ensureVectorCache;
    /** Rebuild one base's cache entry for a chunk after a write. */
    private upsertVectorCache;
    /** Drop a document's cached vectors (delete path). */
    private dropVectorCacheByDoc;
    close(): void;
}
/** The search/embedding text of a chunk: context (title/heading path) + body. */
export declare function searchTextOf(chunk: KnowledgeChunk): string;
/**
 * One-time migration: move chunks out of the legacy JSON unit file into the
 * SQLite store. No-op when the file is absent.
 *
 * Resumable on purpose: the previous guard skipped the whole migration as soon
 * as the store held *any* row (`db.size > 0`), so a crash — or one bad record —
 * after the first document left the remaining documents stranded in the legacy
 * file forever, with a success-shaped return. Each document is now migrated
 * only when the store holds none of its chunks yet.
 *
 * @returns the number of documents migrated by this call.
 */
export declare function migrateLegacyChunkFile(jsonPath: string, db: ChunkDatabase, log: (message: string) => void): Promise<number>;
//# sourceMappingURL=chunkdb.d.ts.map