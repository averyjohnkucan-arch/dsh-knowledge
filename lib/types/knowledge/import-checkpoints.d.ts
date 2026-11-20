import type { ProcessingOutput } from './processing-types.js';
/** Disk-backed intermediate results: queues retain paths/IDs, not every PDF
 * and extracted document in RAM. No temporary checkpoint is a published KB
 * document. Cancellation must drain workers before close(). */
export declare class ImportCheckpoints {
    private readonly root;
    private closed;
    private constructor();
    static create(parent?: string): Promise<ImportCheckpoints>;
    private path;
    save(id: string, stage: 'ocr' | 'parsing', output: ProcessingOutput): Promise<void>;
    load(id: string, stage: 'ocr' | 'parsing'): Promise<ProcessingOutput>;
    remove(id: string, stage: 'ocr' | 'parsing'): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=import-checkpoints.d.ts.map