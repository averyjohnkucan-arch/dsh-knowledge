/** Cover the entire input when an embedding model has a short context window. */
export declare function embeddingWindows(text: string, limit: number, count: (text: string) => Promise<number>): Promise<Array<{
    text: string;
    tokens: number;
}>>;
export declare function mergeWindowVectors(vectors: readonly number[][], weights: readonly number[]): number[];
//# sourceMappingURL=embedding-context.d.ts.map