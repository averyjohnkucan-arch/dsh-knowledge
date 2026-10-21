export declare const FP16_EMBEDDING_MODEL = "dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated";
export declare const OPENVINO_EMBEDDING_MODEL = "OpenVINO/Qwen3-Embedding-0.6B-int8-ov";
interface Device {
    maxTokens?: number;
    device: string;
    name?: string;
    qualified: boolean;
    medianMs?: number;
    minimumCosine?: number;
    error?: string;
    blockedReason?: string;
}
export interface EmbeddingAccelerationStatus {
    status: 'not_installed' | 'installing' | 'ready' | 'error';
    message: string;
    devices: Device[];
}
export declare class EmbeddingAcceleration {
    private readonly fp16;
    private unregisterDevices?;
    constructor(fp16?: boolean);
    private registerDevices;
    private cache;
    private lanes;
    private ready?;
    private setup?;
    private setupChild?;
    private readonly intelAvailability;
    private used;
    private foreground;
    private timer?;
    private checking;
    private polling;
    private stopped;
    private npuRevalidation?;
    private npuRecoveryLane?;
    private warming?;
    private warmed;
    private reference?;
    private gpuRetryAt;
    private igpuAllowed;
    private mainGpuAllowed;
    private mainGpuCopies;
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
    warm(): Promise<void>;
    embed(texts: readonly string[], purpose?: 'query' | 'index'): Promise<number[][]>;
    private revalidateNpu;
    private stopGpu;
    enterForeground(): Promise<() => void>;
    private updateGpus;
    remove(): Promise<void>;
    release(): void;
    dispose(): void;
}
export declare const embeddingAcceleration: EmbeddingAcceleration;
export declare const embeddingFp16Acceleration: EmbeddingAcceleration;
export {};
//# sourceMappingURL=embedding-acceleration.d.ts.map