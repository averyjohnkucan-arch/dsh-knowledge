/** Native OCR runs in another process: a V8/ONNX fatal cannot kill DSH. */
export declare class OcrProcessClient {
    private readonly modulePath;
    private readonly timeoutMs;
    private child;
    private readonly children;
    private sequence;
    private disposing;
    private readonly pending;
    constructor(modulePath?: string, timeoutMs?: number);
    get pendingCount(): number;
    private failPending;
    private spawn;
    recognize(png: Buffer, modelDir: string): Promise<string>;
    /** Observe every owned child's exit before model files may be removed. */
    dispose(): Promise<void>;
}
//# sourceMappingURL=ocr-process-client.d.ts.map