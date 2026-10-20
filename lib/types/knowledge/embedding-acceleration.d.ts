export declare const OPENVINO_EMBEDDING_MODEL = "OpenVINO/Qwen3-Embedding-0.6B-int8-ov";
interface Device {
    device: string;
    name?: string;
    qualified: boolean;
    medianMs?: number;
    minimumCosine?: number;
    error?: string;
}
export interface EmbeddingAccelerationStatus {
    status: 'not_installed' | 'installing' | 'ready' | 'error';
    message: string;
    devices: Device[];
}
export declare class EmbeddingAcceleration {
    private cache;
    private lanes;
    private ready?;
    private setup?;
    private setupChild?;
    private foreground;
    private timer?;
    private checking;
    private stopped;
    private igpuAllowed;
    private mainGpuAllowed;
    private gpuTried;
    private threads;
    private cpuInstances;
    private tuningKey;
    private needsReload;
    configure(cache: string, options?: {
        localEmbeddingThreads?: number;
        localEmbeddingInstances?: number;
        localEmbeddingIgpuIdle?: boolean;
        localEmbeddingMainGpuIdle?: boolean;
    }): void;
    get snapshot(): EmbeddingAccelerationStatus;
    private root;
    private models;
    private runtime;
    private python;
    private environment;
    private lane;
    status(): Promise<EmbeddingAccelerationStatus>;
    private command;
    prepare(): Promise<EmbeddingAccelerationStatus>;
    private run;
    embed(texts: readonly string[]): Promise<number[][]>;
    private stopGpu;
    enterForeground(): Promise<() => void>;
    private updateGpus;
    remove(): Promise<void>;
    release(): void;
    dispose(): void;
}
export declare const embeddingAcceleration: EmbeddingAcceleration;
export {};
//# sourceMappingURL=embedding-acceleration.d.ts.map