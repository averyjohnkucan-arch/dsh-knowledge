import type { MineruDeploymentPlan } from './mineru-deployment-types.js';
export interface ModelDownloadProgress {
    completedBytes: number;
    totalBytes: number;
    file: string;
}
/** Fixed revision, no credentials, no untrusted browser URLs. Partial files are
 * retained, but never exposed to inference before full content verification. */
export declare function downloadMineruModels(plan: MineruDeploymentPlan, signal: AbortSignal, progress: (value: ModelDownloadProgress) => void, fetcher?: typeof fetch): Promise<void>;
//# sourceMappingURL=mineru-download.d.ts.map