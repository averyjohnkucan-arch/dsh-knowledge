import { type EmbeddingCpuTuning } from './embedding-tuning.js';
export declare class LocalEmbeddingPool {
    private desired;
    private active;
    private lanes;
    private generation;
    private sequence;
    private configuring?;
    private idle?;
    private idleMs;
    configure(tuning: Partial<EmbeddingCpuTuning>, idleMs?: number): void;
    private ready;
    private worker;
    private request;
    embed(modelId: string, cacheDir: string, texts: readonly string[], pooling: string, hfEndpoint?: string): Promise<number[][]>;
    dispose(): Promise<void>;
}
export declare const localEmbeddingPool: LocalEmbeddingPool;
//# sourceMappingURL=local-embedding-pool.d.ts.map