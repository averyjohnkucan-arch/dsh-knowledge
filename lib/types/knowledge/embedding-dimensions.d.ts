/** Shared model capability policy; never truncate an arbitrary embedding model. */
export interface DimensionConfig {
    embeddingProvider: string;
    embeddingModel: string;
    /** Zero/absent keeps native output, preserving existing vector identities. */
    embeddingDimensions?: number;
}
export declare function embeddingDimensionSupport(model: string): {
    native?: number;
    min?: number;
};
export declare function embeddingOutputDimensions(config: DimensionConfig): number;
/** Matryoshka prefix followed by L2 normalization; used identically for documents and queries. */
export declare function resizeEmbeddingVectors(vectors: number[][], dimensions: number): number[][];
export declare function embeddingDimensionTag(config: DimensionConfig): string;
//# sourceMappingURL=embedding-dimensions.d.ts.map