/** Optional enrichment never competes with imports, vectorization or foreground inference. */
export declare class IdleEnrichment {
    private readonly busy;
    private readonly next;
    private readonly idleMs;
    private controller?;
    private idleSince;
    private nextScan;
    private stopped;
    constructor(busy: () => boolean, next: (signal: AbortSignal) => Promise<boolean>, idleMs?: number);
    interrupt(): void;
    stop(): void;
    tick(): Promise<void>;
}
//# sourceMappingURL=idle-enrichment.d.ts.map