import type { PipelineDeviceState } from './import-stages.js';
interface Device {
    device: string;
    name: string;
    qualified: boolean;
    medianMs?: number;
    error?: string;
    enabled?: boolean;
    pending?: number;
    completed?: number;
}
export interface OcrAccelerationStatus {
    status: 'not_installed' | 'installing' | 'ready' | 'error';
    message: string;
    devices: Device[];
}
export declare function ocrDeviceWorkActive(foreground: number, usedAt: number, pending: number, now?: number): boolean;
export declare function acceleratorEnvironment(root: string): NodeJS.ProcessEnv;
/** Measured shortest-work queue across explicit devices; a failed device falls back to the existing CPU engine. */
export declare class OcrAcceleration {
    private lanes;
    private excludedDevices;
    private loadedRoot?;
    private modelHash?;
    private cudaQualifiedHash?;
    private cudaQualification?;
    private state?;
    private preparation?;
    private setupChild?;
    private stopped;
    private igpuReservations;
    private foreground;
    private usedAt;
    private polling;
    private timer?;
    private readonly intelAvailability;
    private unregisterDevices;
    private gpuRetryAt;
    private gpuWorkers;
    configure(options?: {
        localOcrGpuWorkers?: number;
    }): void;
    private gpuPython;
    private makeLane;
    private stopLane;
    enterForeground(yieldIgpu?: boolean): Promise<() => void>;
    private balanceCpu;
    yieldMainGpu(): Promise<void>;
    private updateDevices;
    root(): string;
    python(): string;
    get concurrency(): number;
    runtimeDevices(): PipelineDeviceState[];
    status(): Promise<OcrAccelerationStatus>;
    recognize(png: Buffer): Promise<string | undefined>;
    private command;
    prepare(): Promise<OcrAccelerationStatus>;
    releaseWorkers(): void;
    dispose(): void;
}
export {};
//# sourceMappingURL=ocr-acceleration.d.ts.map