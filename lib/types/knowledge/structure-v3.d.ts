import type { ProcessingOutput } from './processing-types.js';
export interface StructureStatus {
    status: 'not_downloaded' | 'installing' | 'ready' | 'error';
    progress: number;
    message: string;
    device: 'cpu';
}
export declare class StructureV3Manager {
    private state;
    private children;
    private setup?;
    private queue;
    private stopped;
    private worker?;
    private workerRoot?;
    root(): string;
    python(): string;
    status(): Promise<StructureStatus>;
    private run;
    prepare(): Promise<StructureStatus>;
    extract(bytes: Uint8Array, fingerprint: string, charts: boolean, timeout: number, signal?: AbortSignal, tablesOnly?: boolean): Promise<ProcessingOutput>;
    dispose(): void;
}
export declare const structureV3: StructureV3Manager;
//# sourceMappingURL=structure-v3.d.ts.map