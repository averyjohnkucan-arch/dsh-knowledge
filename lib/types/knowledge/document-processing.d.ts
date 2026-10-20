import { type StructureV3Manager } from './structure-v3.js';
import type { ArtifactRepository } from './artifacts.js';
import type { KnowledgeConfig } from './types.js';
import type { DocumentProcessingInfo, ParsedDocument, ProcessingProgress } from './processing-types.js';
export interface ProcessedFile {
    readonly text: string;
    readonly parsed: ParsedDocument;
    readonly processing: DocumentProcessingInfo;
}
export declare function processorFingerprint(config: KnowledgeConfig): string;
export declare function processorErrorCode(error: unknown): string;
/** Do not copy upstream response bodies/URLs/tokens into persisted diagnostics. */
export declare function processorErrorMessage(error: unknown): string;
export interface ProcessFileInput {
    readonly structureV3?: StructureV3Manager;
    readonly baseId: string;
    readonly documentId: string;
    readonly fileName: string;
    readonly mimeType?: string;
    readonly bytes: Uint8Array;
    readonly config: KnowledgeConfig;
    readonly artifacts: ArtifactRepository;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ProcessingProgress) => void;
    /** Startup-only recovery, never silently reuse artifacts for explicit reparse. */
    readonly resume?: boolean;
}
/** All file entry points use this function. Cloud is only contacted when the
 * user explicitly selected the legacy cloud provider (never as local fallback). */
export declare function processDocumentFile(input: ProcessFileInput): Promise<ProcessedFile>;
//# sourceMappingURL=document-processing.d.ts.map