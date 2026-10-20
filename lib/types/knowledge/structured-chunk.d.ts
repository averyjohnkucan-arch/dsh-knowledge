import { type ChunkPiece } from './chunk.js';
import type { DocumentSourceSpan, ParsedDocument } from './processing-types.js';
export interface StructuredChunkPiece extends ChunkPiece {
    readonly sourceSpans?: readonly DocumentSourceSpan[];
}
/** Structure-aware, exactly mapped chunks. Ordinary unstructured text keeps its old splitter. */
export declare function chunkParsedDocument(parsed: ParsedDocument, revision: string, size: number, overlap: number, options?: {
    structured?: boolean;
    smartChunk?: boolean;
    separator?: string;
    tokenLimit?: number;
}): StructuredChunkPiece[];
//# sourceMappingURL=structured-chunk.d.ts.map