/** A FIFO shared by file-processing entry points in one service.
 * A queued cancellation removes only itself; an active task owns its signal. */
export declare class ProcessingQueue {
    private readonly concurrency;
    private readonly limit;
    private running;
    private readonly waiting;
    constructor(concurrency?: number, limit?: number);
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>;
}
/** Admit work BEFORE reading source bytes. Waiters retain paths/IDs, not PDFs.
 * Heavy files have their own gate so OCR cannot fill every lightweight slot.
 * Nested sync/reindex/import calls share their admission instead of deadlocking.
 * The parser itself waits for capacity; internal congestion is not a failure. */
export declare class DocumentAdmission {
    private readonly context;
    private readonly files;
    private readonly heavy;
    private readonly stop;
    constructor(concurrency?: number, heavyConcurrency?: number);
    run<T>(fileName: string, task: () => Promise<T>, signal?: AbortSignal, heavy?: boolean): Promise<T>;
    close(): void;
}
//# sourceMappingURL=processing-queue.d.ts.map