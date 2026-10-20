import type { OcrAcceleration } from './ocr-acceleration.js';
export declare function useOcrAcceleration(value: OcrAcceleration | undefined): void;
/** Each process owns its native sessions. Two 8-thread workers leave room for rendering and charts. */
export declare class OcrPool {
    private clients;
    private readonly cpuConcurrency;
    get concurrency(): number;
    recognize(png: Buffer, modelDir: string): Promise<string>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=ocr-pool.d.ts.map