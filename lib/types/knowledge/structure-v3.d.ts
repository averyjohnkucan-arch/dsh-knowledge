import type { PipelineDeviceState } from './import-stages.js';
import type { ProcessingOutput } from './processing-types.js';
export interface StructureStatus {
    status: 'not_downloaded' | 'installing' | 'ready' | 'error';
    progress: number;
    message: string;
    device: 'cpu';
    activity?: {
        activeDocuments: number;
        foreground: boolean;
        devices: {
            device: string;
            active: number;
            pages: number;
            requests: number;
            seconds: number;
        }[];
    };
}
export declare class StructureV3Manager {
    private state;
    private children;
    private setup?;
    private readonly concurrency;
    private readonly queue;
    private readonly cpuQueue;
    private cudaMemoryReduced;
    private cudaReclaim?;
    private cudaDevices;
    private deferRichToCuda;
    private cpuChartThreads;
    private chartBatchSize;
    private directCharts;
    private cpuRequests;
    private readonly capacityWaiters;
    private active;
    private readonly measurements;
    private readonly stop;
    private readonly workers;
    private foreground;
    private readonly intelAvailability;
    private readonly unregisterDevices;
    private layoutFailed;
    private readonly reservedDevices;
    private reserveDevice;
    private stopped;
    private workerRoot?;
    root(): string;
    python(): string;
    runtimeDevices(): PipelineDeviceState[];
    status(): Promise<StructureStatus>;
    private run;
    prepare(): Promise<StructureStatus>;
    private notifyCapacity;
    private waitCapacity;
    private layoutDevice;
    yieldMainGpu(): Promise<void>;
    private stopLane;
    enterForeground(): Promise<() => void>;
    private worker;
    extract(bytes: Uint8Array, fingerprint: string, charts: boolean, timeout: number, signal?: AbortSignal, tablesOnly?: boolean): Promise<ProcessingOutput>;
    dispose(): void;
}
export declare const structureV3: StructureV3Manager;
//# sourceMappingURL=structure-v3.d.ts.map