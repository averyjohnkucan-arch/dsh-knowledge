/** Strict, testable cross-encoder scoring adapter. */
export interface CrossEncoderLogits {
    data?: ArrayLike<number>;
    dims?: number[];
}
export type CrossEncoderTokenizer = (texts: string[], options: {
    text_pair: string[];
    padding: true;
    truncation: true;
}) => Promise<Record<string, unknown>>;
export type CrossEncoderModel = (inputs: Record<string, unknown>) => Promise<{
    logits?: CrossEncoderLogits;
}>;
export declare class CrossEncoderResponseError extends Error {
    readonly code = "invalid_response";
}
export declare function scoreCrossEncoder(tokenizer: CrossEncoderTokenizer, model: CrossEncoderModel, query: string, texts: readonly string[], initialBatchSize?: number): Promise<{
    scores: number[];
    batchSize: number;
}>;
//# sourceMappingURL=rerank-adapter.d.ts.map