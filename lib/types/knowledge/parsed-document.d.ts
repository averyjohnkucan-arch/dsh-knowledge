import type { DocumentProcessor, MineruTier, ProcessingOutput, ProcessingWarning } from './processing-types.js';
export declare const MINERU_ARCHIVE_LIMITS: Readonly<{
    compressedBytes: number;
    expandedBytes: number;
    memberBytes: number;
    members: 4096;
    blocks: 100000;
    textChars: number;
    fieldChars: number;
}>;
export declare function processingHash(bytes: Uint8Array | string): string;
export declare function parsedTextDocument(text: string, bytes: Uint8Array, provider: DocumentProcessor, optionsFingerprint: string, warnings?: readonly ProcessingWarning[]): ProcessingOutput;
/** Reject dangerous names before JSZip can sanitize ../ or collapse duplicates. */
export declare function validateArtifactPath(path: string): string;
export interface NormalizeMineruOptions {
    tier: MineruTier;
    processorVersion?: string;
    partial?: boolean;
    signal?: AbortSignal;
}
export declare function normalizeMineruArchive(archive: Uint8Array, sourceBytes: Uint8Array, options: NormalizeMineruOptions): Promise<ProcessingOutput>;
//# sourceMappingURL=parsed-document.d.ts.map