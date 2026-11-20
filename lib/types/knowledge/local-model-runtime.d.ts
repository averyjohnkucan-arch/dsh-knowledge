/** Runtime that must validate cached embedding/rerank weights before use.
 * Keep this aligned with the pinned Transformers dependency and its own ONNX
 * runtime (the OCR runtime is a separate dependency/process). */
export declare const LOCAL_MODEL_RUNTIME: Readonly<{
    readonly transformers: "4.3.1";
    readonly onnxruntime: "1.30.0";
}>;
//# sourceMappingURL=local-model-runtime.d.ts.map