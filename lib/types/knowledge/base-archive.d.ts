import { Readable } from 'node:stream';
import type { KnowledgeDocument } from './types.js';
type Item = Pick<KnowledgeDocument, 'id' | 'title' | 'sourceType' | 'fileName' | 'mimeType' | 'url' | 'parentDirectoryId'> & {
    text?: string;
    original?: string;
};
interface ArchiveBase {
    name: string;
    description?: string;
    group?: string;
}
export interface ArchiveWriter {
    create(base: ArchiveBase): Promise<string>;
    add(baseId: string, item: Item, parent?: string): Promise<string>;
    discard(baseId: string): Promise<void>;
}
export declare function exportArchive(base: ArchiveBase, docs: readonly KnowledgeDocument[], load: (id: string) => Promise<{
    text?: string;
    original?: string;
}>): any;
export declare function importArchive(source: Readable, writer: ArchiveWriter): Promise<{
    id: string;
    documents: number;
}>;
export {};
//# sourceMappingURL=base-archive.d.ts.map