import { type StructureV3Manager } from './structure-v3.js';
import type { ArtifactRepository } from './artifacts.js';
import type { KnowledgeConfig } from './types.js';
import type { DocumentProcessingInfo, ParsedDocument, ProcessingOutput, ProcessingProgress } from './processing-types.js';
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
    readonly managedCaption?: import('./managed-caption.js').ManagedCaption;
    readonly structureV3?: StructureV3Manager;
    /** Gate parsing only; optional structure enrichment must not hold parser capacity. */
    readonly runParsing?: <T>(task: () => Promise<T>) => Promise<T>;
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
    /** Validated output from the import-wide extraction/parsing stages. */
    readonly prepared?: ProcessingOutput;
}
/** All file entry points use this function. Cloud is only contacted when the
 * user explicitly selected the legacy cloud provider (never as local fallback). */
export declare function processDocumentFile(input: ProcessFileInput): Promise<ProcessedFile>;
/** Source decoding/OCR without table/chart inference or artifact publication.
 * PDF decoding is a prerequisite for selecting and rendering OCR pages. */
export declare function extractDocumentContent(input: Pick<ProcessFileInput, 'bytes' | 'fileName' | 'mimeType' | 'config' | 'signal' | 'onProgress'> & {
    resumeJobId?: string;
}): Promise<ProcessingOutput>;
/** Parsing/enrichment consumes completed extraction; it never reruns OCR of
 * the source PDF through parseDocumentBuffer. Structure models retain their
 * own internal recognition where required to interpret a table or chart. */
export declare function enrichDocumentContent(input: Pick<ProcessFileInput, 'bytes' | 'fileName' | 'config' | 'signal' | 'structureV3' | 'managedCaption'>, output: ProcessingOutput, progress?: (value: ProcessingProgress) => void): Promise<ProcessingOutput>;
//# sourceMappingURL=document-processing.d.ts.map