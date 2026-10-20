export interface IdleEvidence {
    idleSeconds: number | null;
    reason: string;
}
export interface MainGpuDecision {
    allowed: boolean;
    reason: string;
    idleSeconds: number | null;
}
export declare function decideMainGpu(input: {
    enabled: boolean;
    foreground: boolean;
    idleSeconds: number | null;
    idleAfterSeconds: number;
    externalCompute: boolean;
    freeMiB: number;
}): MainGpuDecision;
export declare function desktopIdle(): Promise<IdleEvidence>;
export declare class ResourcePolicy {
    private foreground;
    private consumers;
    enabled: boolean;
    idleAfterSeconds: number;
    register(consumer: {
        stop(): Promise<void>;
        pid(): number | undefined;
    }): () => void;
    enterForeground(): Promise<() => void>;
    mainGpu(): Promise<MainGpuDecision>;
}
//# sourceMappingURL=resource-policy.d.ts.map