import type { KnowledgeConfig } from './types.js';
/** Preload only selected, installed models. A warmup never downloads weights or
 * leases a GPU. Calls are coalesced while starting, and stop at plugin disposal. */
export declare class RetrievalWarmup {
    private readonly warn;
    private readonly pending;
    private disposed;
    constructor(warn: (message: string) => void);
    warm(configs: readonly Pick<KnowledgeConfig, 'embeddingProvider' | 'embeddingModel' | 'rerankModel'>[]): Promise<void>;
    private start;
    dispose(): void;
}
//# sourceMappingURL=retrieval-warmup.d.ts.map