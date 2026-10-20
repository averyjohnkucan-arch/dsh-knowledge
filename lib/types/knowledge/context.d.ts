import type { ContextWindow, KnowledgeChunk } from './types.js';
export { estimateContextTokens, serializeContextWindow } from './context-protocol.js';
/** Options for composing an ordered evidence window from already-loaded chunks. */
export interface ComposeContextWindowOptions {
    /** Maximum chunks to include on the earlier side of the anchor. */
    readonly before?: number;
    /** Maximum chunks to include on the later side of the anchor. */
    readonly after?: number;
    /** Hard budget for the canonical serialized window. */
    readonly maxTokens?: number;
    /** Query/identifier used to centre an oversized anchor excerpt. */
    readonly focus?: string;
    /** By default context stops at a different Markdown heading path. */
    readonly crossHeading?: boolean;
    /** Total chunks in the document, when known, for an exact `hasMoreAfter`. */
    readonly documentChunkCount?: number;
    /** Explicit availability hints override inference from loaded chunks. */
    readonly hasMoreBefore?: boolean;
    readonly hasMoreAfter?: boolean;
}
/**
 * Build a deterministic context window without touching a store. `chunks` may
 * contain a whole document or only a prefetched range; unrelated documents are
 * ignored. The supplied anchor remains authoritative even when it was not part
 * of the prefetched array.
 */
export declare function composeContextWindow(chunks: readonly KnowledgeChunk[], anchor: KnowledgeChunk, options?: ComposeContextWindowOptions): ContextWindow;
//# sourceMappingURL=context.d.ts.map