export interface NativePdfResult {
    text: string;
    pages?: string[];
    scanned?: number[];
}
/** Persistent independent pdf.js heaps; a crash/timeout affects only its own lane. */
export declare class PdfParserPool {
    private readonly capacity;
    private readonly modulePath;
    private readonly timeoutMs;
    private lanes;
    private sequence;
    private stopped;
    constructor(capacity?: number, modulePath?: string, timeoutMs?: number);
    private fail;
    private createLane;
    parse(bytes: Uint8Array): Promise<NativePdfResult>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=pdf-parser-pool.d.ts.map