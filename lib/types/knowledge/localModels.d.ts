import { type LocalRerankFailureCode } from './local-rerank.js';
export interface LocalModelDescriptor {
    readonly id: string;
    readonly name: string;
    readonly kind: 'embedding' | 'reranking';
    readonly subtitle: string;
    readonly support?: 'official' | 'experimental';
    readonly dimensions?: number;
    readonly maxTokens?: number;
    readonly recommendedBatchSize?: number;
}
export interface LocalModelSummary extends LocalModelDescriptor {
    readonly status: 'ready' | 'not_downloaded' | 'downloading' | 'validating' | 'unhealthy' | 'error';
    readonly health: 'unchecked' | 'checking' | 'healthy' | 'unhealthy';
    readonly progress: number;
    readonly message: string;
    readonly lastCheckedAt?: number;
    readonly latencyMs?: number;
}
export declare const LOCAL_MODELS: readonly LocalModelDescriptor[];
export declare function validateHuggingFaceRepoId(id: string): string;
export declare function listLocalModels(): Promise<LocalModelSummary[]>;
export declare function hasActiveLocalRerankDownload(): boolean;
export declare function selfTestLocalModel(id: string): Promise<LocalModelSummary>;
export declare function downloadLocalModel(id: string): Promise<LocalModelSummary>;
export declare function registerCustomLocalReranker(id: string): Promise<LocalModelSummary>;
export declare function cancelLocalModelDownload(id: string): Promise<LocalModelSummary>;
export declare function deleteLocalModel(id: string): Promise<LocalModelSummary>;
export declare function assertLocalRerankerReady(modelId: string): Promise<void>;
export declare function localRerankActionFor(code: LocalRerankFailureCode): 'download_model' | 'run_self_test' | 'check_config' | 'retry_later';
//# sourceMappingURL=localModels.d.ts.map