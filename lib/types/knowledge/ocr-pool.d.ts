import type { OcrAcceleration } from './ocr-acceleration.js';
export declare function enterOcrPoolForeground(): Promise<() => void>;
export declare function useOcrAcceleration(value: OcrAcceleration | undefined): void;
/** Eight threads per CPU session; a shared gate caps foreground OCR to one session. */
export declare class OcrPool {
    constructor();
    private stopped;
    private clients;
    private readonly cpuConcurrency;
    get concurrency(): number;
    recognize(png: Buffer, modelDir: string): Promise<string>;
    stopFallbackWorkers(): Promise<void>;
    dispose(): Promise<void>;
}
//# sourceMappingURL=ocr-pool.d.ts.map