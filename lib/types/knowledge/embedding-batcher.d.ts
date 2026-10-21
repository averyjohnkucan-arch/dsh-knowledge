export declare class EmbeddingQueueTimeout extends Error {
    constructor();
}
/** Coalesce concurrent vector requests into bounded batches, preserving order. */
export declare class EmbeddingBatcher {
    private execute;
    private maxBatch;
    private queue;
    private timer?;
    private running;
    private enabled;
    constructor(execute: (texts: string[]) => Promise<{
        vectors: number[][];
        elapsedMs: number;
    }>, maxBatch?: number);
    request(text: string, priority?: 'query' | 'index', maxQueueWaitMs?: number): Promise<{
        vector: number[];
        elapsedMs: number;
    }>;
    resume(): void;
    pause(): void;
    private arm;
    private flush;
}
//# sourceMappingURL=embedding-batcher.d.ts.map