import type { KnowledgeService } from '../index.js';
import type { KnowledgeDocument, SearchMode } from '../types.js';
import { type Mapping } from './config.js';
import type { Access } from './session.js';
export type SourceRow = Pick<KnowledgeDocument, 'id' | 'baseId' | 'sourceType' | 'sourcePath' | 'processing' | 'incomplete' | 'markdownRevision'>;
export type ReaderStore = Pick<KnowledgeService, 'getConfigFor' | 'adSourceBases' | 'adSourceRows' | 'adCurrentSource' | 'adSearch' | 'getDocument' | 'getRawFile' | 'getMarkdownSnapshot' | 'listChunks'>;
export type ReaderQuery = {
    query: string;
    topK?: number;
    mode?: SearchMode;
    baseId?: string;
};
export type ReaderHit = {
    documentId: string;
    title: string;
    text: string;
    score: number;
    citation: string;
};
export declare class AdLibrary {
    private store;
    private mappings;
    constructor(store: ReaderStore, mappings: readonly Mapping[]);
    private bases;
    private entries;
    private current;
    browse(access: Access, baseId?: string, folderId?: string): Promise<{
        id: string;
        name: string;
        kind: string;
    }[]>;
    private link;
    search(access: Access, query: ReaderQuery): Promise<{
        hits: ReaderHit[];
        reranked: boolean;
    }>;
    read(access: Access, id: string, digest: string, kind: 'markdown' | 'original', chunk?: string): Promise<{
        name: string;
        bytes: Buffer<ArrayBuffer>;
    }>;
}
//# sourceMappingURL=retrieval.d.ts.map