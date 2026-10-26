/** Import-wide barriers. A task owns capacity only while executing its current
 * stage; queued documents never retain a parser/OCR worker while waiting for
 * the rest of the import. Stage results must be checkpointed by the caller. */
export declare const IMPORT_STAGES: readonly ["ocr", "parsing", "chunking", "vectorization"];
export type ImportStage = typeof IMPORT_STAGES[number];
export interface ImportStageProgress {
    stage: ImportStage;
    total: number;
    completed: number;
    running: number;
    failed: number;
}
export interface ImportStageItem {
    id: string;
}
export interface ImportStageFailure {
    id: string;
    stage: ImportStage;
    error: unknown;
}
export interface ImportStageOptions<T extends ImportStageItem> {
    items: readonly T[];
    signal: AbortSignal;
    /** Device managers retain their own foreground/VRAM admission. */
    concurrency(stage: ImportStage): number;
    enterStage?(stage: ImportStage): Promise<void>;
    failure?(failure: ImportStageFailure): void;
    execute(stage: ImportStage, item: T, signal: AbortSignal): Promise<void>;
    progress?(progress: ImportStageProgress): void;
}
export declare function runImportStages<T extends ImportStageItem>(options: ImportStageOptions<T>): Promise<{
    completed: string[];
    failures: ImportStageFailure[];
}>;
/** Scheduler occupancy, not a hardware-utilization percentage. */
export interface PipelineDeviceState {
    device: string;
    activeTasks: number;
    state: 'running' | 'ready' | 'waiting' | 'unavailable';
    reason: string;
}
//# sourceMappingURL=import-stages.d.ts.map