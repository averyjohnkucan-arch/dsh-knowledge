export interface EmbeddingCpuTuning {
    threads: number;
    instances: number;
    microBatch: number;
}
export declare function resolveEmbeddingCpuTuning(input: Partial<EmbeddingCpuTuning>, cores: number, freeBytes: number): EmbeddingCpuTuning;
/** Each lane owns a separate model instance; preserve caller order and drain failures. */
export declare function orderedEmbeddingLanes<T, R>(items: readonly T[], lanes: number, run: (item: T, index: number, lane: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=embedding-tuning.d.ts.map