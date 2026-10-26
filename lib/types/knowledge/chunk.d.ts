/**
 * Text chunking: split a document into overlapping character windows,
 * preferring paragraph, heading, and sentence boundaries so a chunk rarely
 * starts or ends mid-sentence. Each chunk records the markdown heading path
 * that introduces it, so retrieval can inject it as context.
 * @module dsh-knowledge/knowledge/chunk
 */
import type { DocumentSourceSpan } from './processing-types.js';
/** One chunk: its text plus the markdown heading path introducing it. */
export interface ChunkPiece {
    readonly text: string;
    readonly heading?: string;
    readonly sourceSpans?: readonly DocumentSourceSpan[];
}
/** Normalize line endings and collapse excessive blank lines. */
export declare function normalizeText(text: string): string;
/**
 * Split `text` into chunks of at most `size` characters with `overlap`
 * characters shared between consecutive chunks. With `smartChunk` (default)
 * blocks are paragraphs and markdown headings; otherwise the text splits on
 * `separator` only. Long blocks are windowed at sentence boundaries.
 * @returns non-empty array of chunks (guaranteed one chunk for non-empty input).
 */
export declare function chunkText(text: string, size: number, overlap: number, options?: {
    smartChunk?: boolean;
    separator?: string;
}): ChunkPiece[];
/**
 * Semantic-chunking mode: split into paragraph-level candidate segments
 * (heading-aware, never windowed) so the caller can embed each segment and
 * merge adjacent similar ones via {@link mergeSemanticSegments}. Exported for
 * the service layer.
 */
export declare function splitSemanticSegments(text: string, options?: {
    separator?: string;
    candidateTokens?: number;
}): ChunkPiece[];
/**
 * Greedy merge of embedded candidate segments within one heading. Adjacent
 * prose segments merge while (a) their cosine similarity is at
 * least `threshold` (semantically coherent) and (b) the combined length stays
 * within `size`. The merged chunk's vector is the length-weighted mean of its
 * segments' vectors (renormalized), so semantic chunking costs no extra
 * embedding pass. Returns chunks with the merged text, the first segment's
 * heading, and the merged vector (when vectors were provided).
 */
export declare function mergeSemanticSegments(segments: readonly ChunkPiece[], vectors: readonly (number[] | undefined)[], size: number, threshold?: number): Array<ChunkPiece & {
    embedding?: number[];
}>;
/** Consume embedded batches immediately; retain final vectors and one running
 * sum instead of a second complete collection of every paragraph vector. */
export declare function createSemanticMerger(segments: readonly ChunkPiece[], size: number, threshold?: number): {
    add(segment: ChunkPiece, vector?: number[]): void;
    finish(): Array<ChunkPiece & {
        embedding?: number[];
    }>;
};
/**
 * Refine chunks to a token budget (Cherry's `refineChunksByTokenLimit`): any
 * chunk whose estimated token count exceeds `tokenLimit` is split at the
 * nearest preferred boundary (blank line → 。/！/？ → ， → space) around the
 * midpoint, recursively, until every piece fits. Pieces with no usable
 * boundary are kept whole (splitting mid-word would hurt retrieval). A
 * `tokenLimit` of 0 (or below) is a no-op.
 */
export declare function refineChunksByTokenLimit(chunks: readonly ChunkPiece[], tokenLimit: number, estimateTokens: (text: string) => number): ChunkPiece[];
//# sourceMappingURL=chunk.d.ts.map