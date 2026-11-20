/** MinerU 4.0.6 V1 adapter. This never calls the cloud adapter or installs models. */
import type { MineruTier, ProcessingOutput, ProcessingProgress, ProcessorCapabilities } from './processing-types.js';
export { ProcessorError } from './processor-transport.js';
export interface MineruLocalSettings {
    apiUrl: string;
    apiKey?: string;
    tier?: MineruTier;
    timeoutMs?: number;
}
export interface MineruLocalOptions {
    signal?: AbortSignal;
    onProgress?: (progress: ProcessingProgress) => void;
    /** Only resume a persisted job bound by the caller to these source bytes/options. */
    resumeJobId?: string;
}
export declare function probeMineruLocal(settings: MineruLocalSettings, signal?: AbortSignal): Promise<ProcessorCapabilities>;
export declare function extractWithMineruLocal(bytes: Uint8Array, fileName: string, settings: MineruLocalSettings, options?: MineruLocalOptions): Promise<ProcessingOutput>;
//# sourceMappingURL=mineru-local.d.ts.map