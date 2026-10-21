export declare function registerBackgroundDevices(owner: () => readonly (number | undefined)[]): () => void;
export declare function backgroundDevicePids(local?: ReadonlySet<number>): Set<number>;
export interface DeviceAvailability {
    available: boolean;
    reason: string;
    freeMiB?: number;
}
export declare function parseIntelActivity(text: string): {
    client: string;
    nanoseconds: number;
} | undefined;
export declare function intelActivityAvailable(previous: number, current: number, elapsedMs: number): boolean;
export declare class IntelEmbeddingAvailability {
    private files;
    private scanned;
    private previous;
    sample(owned: ReadonlySet<number>): Promise<DeviceAvailability>;
}
export declare function foreignNvidiaGraphics(text: string, owned: ReadonlySet<number>): boolean;
export declare function nvidiaMemorySufficient(freeMiB: number, hasOwnedWorker: boolean): boolean;
export declare function nvidiaEmbeddingAvailability(owned: ReadonlySet<number> | (() => ReadonlySet<number>)): Promise<DeviceAvailability>;
//# sourceMappingURL=embedding-device-availability.d.ts.map