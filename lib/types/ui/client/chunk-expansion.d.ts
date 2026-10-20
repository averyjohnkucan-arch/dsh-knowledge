/** Expansion state for the document chunk-preview cards. */
export interface ChunkExpansionState {
    readonly allExpanded: boolean;
    readonly expandedChunkIds: ReadonlySet<string>;
}
/** Start (or reset) a document preview with every chunk collapsed. */
export declare function collapsedChunkExpansion(): ChunkExpansionState;
/** Expand every loaded chunk and any chunks loaded later. */
export declare function expandAllChunks(): ChunkExpansionState;
/** Collapse every chunk and stop auto-expanding chunks loaded later. */
export declare function collapseAllChunks(): ChunkExpansionState;
export declare function isChunkExpanded(state: ChunkExpansionState, chunkId: string): boolean;
/**
 * Toggle one chunk without surprising the rest of the list. When one card is
 * collapsed from all-expanded mode, every other currently loaded card remains
 * explicitly expanded and chunks loaded later start collapsed.
 */
export declare function toggleChunkExpansion(state: ChunkExpansionState, loadedChunkIds: readonly string[], chunkId: string): ChunkExpansionState;
/** A selector-safe, stable ID for aria-controls. */
export declare function chunkPreviewBodyId(documentId: string, chunkId: string): string;
//# sourceMappingURL=chunk-expansion.d.ts.map