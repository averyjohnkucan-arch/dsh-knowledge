/** A bounded FIFO shared by every file-processing entry point in one service.
 * A queued cancellation removes only itself; an active task owns its signal. */
export declare class ProcessingQueue {
    private readonly concurrency;
    private readonly limit;
    private running;
    private readonly waiting;
    constructor(concurrency?: number, limit?: number);
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T>;
}
//# sourceMappingURL=processing-queue.d.ts.map