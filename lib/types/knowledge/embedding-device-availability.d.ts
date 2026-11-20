export declare function registerBackgroundDevices(owner: () => readonly (number | undefined)[]): () => void;
export declare function backgroundDevicePids(local?: ReadonlySet<number>): Set<number>;
export interface DeviceAvailability {
    available: boolean;
    reason: string;
    freeMiB?: number;
}
export declare function parseIntelActivity(text: string, processName?: string): {
    client: string;
    nanoseconds: number;
} | undefined;
export declare function intelActivityAvailable(previous: number, current: number, elapsedMs: number): boolean;
export declare class IntelEmbeddingAvailability {
    private files;
    private scanned;
    private previous;
    private pending;
    sample(owned: ReadonlySet<number>): Promise<DeviceAvailability>;
    private sampleNow;
}
export declare function foreignNvidiaGraphics(text: string, owned: ReadonlySet<number>): boolean;
export declare function nvidiaMemorySufficient(freeMiB: number, hasOwnedWorker: boolean): boolean;
/** Share in-flight hardware reads, but evaluate ownership separately for every caller.
 * No completed sample is cached: model reservations and VRAM can change immediately. */
export declare class NvidiaActivityProbe {
    private readonly query;
    private pending?;
    constructor(query?: (args: string[]) => Promise<string>);
    sample(): Promise<{
        apps: string;
        memory: string;
        graphics: string;
    }>;
}
export declare function nvidiaEmbeddingAvailability(owned: ReadonlySet<number> | (() => ReadonlySet<number>)): Promise<DeviceAvailability>;
//# sourceMappingURL=embedding-device-availability.d.ts.map