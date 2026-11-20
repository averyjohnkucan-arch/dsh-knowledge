import type { DocumentProcessingInfo, ParsedDocument, ProcessingOutput, ProcessingProgress } from './processing-types.js';
export interface ProcessingJobRecord {
    readonly version: 1;
    readonly baseId: string;
    readonly documentId: string;
    readonly sourceHash: string;
    readonly fingerprint: string;
    readonly state: 'running' | 'completed' | 'failed' | 'canceled';
    readonly progress: ProcessingProgress;
    readonly updatedAt: number;
    readonly artifact?: DocumentProcessingInfo;
    readonly errorCode?: string;
    /** Durable count incremented before each automatic startup parse attempt. */
    readonly startupAttempts?: number;
    /** Attempt within the current processing run (three total before failure). */
    readonly attempt?: number;
}
/** Immutable artifacts scoped to one document. No downloaded paths are used as
 * filesystem names: asset ids select bounded blobs through a manifest. */
export declare class ArtifactRepository {
    private readonly root?;
    private readonly memory;
    private readonly memoryJobs;
    private readonly jobWrites;
    private readonly deleted;
    private readonly saves;
    constructor(root?: string | undefined);
    private key;
    private path;
    save(baseId: string, documentId: string, output: ProcessingOutput): Promise<DocumentProcessingInfo>;
    private saveRevision;
    private boundedRead;
    load(baseId: string, documentId: string, info: DocumentProcessingInfo): Promise<ParsedDocument>;
    readAsset(baseId: string, documentId: string, info: DocumentProcessingInfo, assetId: string): Promise<{
        bytes: Uint8Array;
        mimeType: string;
    } | undefined>;
    getJob(baseId: string, documentId: string): Promise<ProcessingJobRecord | undefined>;
    saveJob(job: ProcessingJobRecord): Promise<void>;
    deleteDocument(baseId: string, documentId: string): Promise<void>;
    /** Startup-only GC. Live, staged and recoverable job revisions are pinned;
     * recent candidates are retained for seven days. Never follow symlinks. */
    collectDocument(baseId: string, documentId: string, pinned: readonly string[], now?: number): Promise<number>;
    deleteBase(baseId: string): Promise<void>;
}
//# sourceMappingURL=artifacts.d.ts.map