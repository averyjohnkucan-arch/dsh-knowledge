import type { KnowledgeChunk, KnowledgeDocument } from './types.js';
export interface MarkdownRange {
    start: number;
    end: number;
    lineStart: number;
    lineEnd: number;
}
export interface MarkdownPassage {
    chunkId: string;
    index: number;
    text: string;
    ranges: MarkdownRange[];
}
export interface MarkdownSnapshot {
    schema: 1;
    baseId: string;
    documentId: string;
    revision: string;
    title: string;
    sha256: string;
    createdAt: number;
    processingRevision?: string;
    text: string;
    passages: MarkdownPassage[];
}
/** Map only verifiable passages, in order. Never invent offsets for transformed text. */
export declare function mapMarkdownPassages(text: string, chunks: readonly KnowledgeChunk[]): MarkdownPassage[];
/** Versioned derived text, separate from original source files and parse artifacts. */
export declare class MarkdownSnapshots {
    private root?;
    private memory;
    private writes;
    private deleted;
    constructor(root?: string | undefined);
    private key;
    save(doc: KnowledgeDocument, text: string, chunks: readonly KnowledgeChunk[]): Promise<string>;
    private saveVersion;
    has(base: string, doc: string, revision: string): Promise<boolean>;
    load(baseId: string, documentId: string, revision: string): Promise<MarkdownSnapshot | undefined>;
    removeRevision(base: string, doc: string, revision: string): Promise<void>;
    removeBase(base: string): Promise<void>;
    removeDocument(base: string, doc: string): Promise<void>;
}
/** Script-free, escaped source viewer; offsets refer only to this saved revision. */
export declare function renderMarkdownSnapshot(snapshot: MarkdownSnapshot, chunkId?: string): string;
//# sourceMappingURL=markdown-snapshots.d.ts.map