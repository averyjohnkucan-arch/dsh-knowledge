/** In-memory counters only; never retain document paths or content. */
export interface ProcessingSnapshot {
    id: string;
    baseId: string;
    total: number;
    completed: number;
    processed: number;
    skipped: number;
    failed: number;
    running: number;
    queued: number;
    discovering: boolean;
    active: boolean;
    etaSeconds: number | null;
    perMinute: number | null;
}
export declare class ProcessingMeter {
    private clock;
    private runs;
    constructor(clock?: () => number);
    start(id: string, baseId: string, discovering?: boolean): void;
    add(id: string, count?: number): void;
    discovered(id: string): void;
    begin(id: string): void;
    settle(id: string, outcome: 'processed' | 'skipped' | 'failed'): void;
    finish(id: string): void;
    active(id: string): boolean;
    snapshots(): ProcessingSnapshot[];
}
//# sourceMappingURL=processing-meter.d.ts.map