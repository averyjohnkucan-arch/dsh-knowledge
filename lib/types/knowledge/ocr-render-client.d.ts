export declare function disposeOcrRenderers(): Promise<void>;
/** Returns false only when the optional compiled worker is absent. Never mask a partial render as success. */
export declare function streamOcrRasters(bytes: Uint8Array, pages: readonly number[] | undefined, limits: {
    maxPages: number;
    pageBytes: number;
    totalBytes: number;
    maxDimension: number;
    timeoutMs: number;
    window: number;
}, consume: (page: number, png: Buffer) => Promise<void>, modulePath?: string): Promise<boolean>;
//# sourceMappingURL=ocr-render-client.d.ts.map