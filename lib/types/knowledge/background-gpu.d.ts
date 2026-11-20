/** Cooperative admission for all Knowledge CUDA workers. CPU/NPU work continues
 * while a chat owns the GPU; the shared scheduler owns model unloading. */
export interface BackgroundLease {
    signal: AbortSignal;
    release(): void;
}
export interface BackgroundDriver {
    key: string;
    name: string;
    gpu: number;
    priority: 'background';
    fingerprint: string;
    load(signal: AbortSignal): Promise<void>;
    unload(): Promise<void>;
}
export interface BackgroundScheduler {
    acquire(driver: BackgroundDriver, signal?: AbortSignal): Promise<BackgroundLease>;
    unload(key: string): Promise<unknown>;
}
export declare class BackgroundGpuAdmission {
    private scheduler?;
    private driver?;
    private demand;
    private lease?;
    private acquiring?;
    private timer?;
    private admitted;
    private generation;
    private retryAt;
    get allowed(): boolean;
    attach(scheduler: BackgroundScheduler, stop: () => Promise<void>): () => Promise<void>;
    hasOtherDemand(owner: object): boolean;
    request(owner: object, active: boolean): void;
    private tick;
}
export declare const knowledgeGpuAdmission: BackgroundGpuAdmission;
//# sourceMappingURL=background-gpu.d.ts.map