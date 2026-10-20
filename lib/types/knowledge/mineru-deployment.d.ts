import { createDeploymentPlan } from './mineru-deployment-plan.js';
import type { MineruDeploymentPlan, MineruDeploymentStatus } from './mineru-deployment-types.js';
import { MINERU_MODEL_REVISION, MINERU_RUNTIME_VERSION } from './mineru-manifest.js';
import { downloadMineruModels } from './mineru-download.js';
import { prepareRuntime, probeManagedService, startManagedService } from './mineru-runtime.js';
import { probePythonExecutable } from './mineru-python.js';
export { MINERU_MODEL_REVISION, MINERU_RUNTIME_VERSION };
declare const defaults: {
    plan: typeof createDeploymentPlan;
    download: typeof downloadMineruModels;
    prepare: typeof prepareRuntime;
    start: typeof startManagedService;
    probe: typeof probeManagedService;
    inspectPython: typeof probePythonExecutable;
    validate: (root: string, signal: AbortSignal) => Promise<void>;
};
/** Only server-issued plans authorize preparation. No browser-supplied commands. */
export declare class MineruDeployment {
    private readonly pointerPath?;
    private readonly sourceSettings;
    private checking;
    private controller?;
    private plans;
    private state;
    private task?;
    private service?;
    private environmentId?;
    private releaseLock?;
    private initialization?;
    private disposed;
    private readonly deps;
    constructor(pointerPath?: (() => string) | undefined, dependencies?: Partial<typeof defaults>, sourceSettings?: () => {
        hfEndpoint?: string;
        pythonIndexUrl?: string;
    });
    status(): Promise<MineruDeploymentStatus>;
    private initialize;
    private restore;
    private persist;
    pythonEnvironments(executable?: string): Promise<import("./mineru-deployment-types.js").MineruPythonDiscovery>;
    preflight(input: {
        root: string;
        existingModels?: string;
        pythonExecutable?: string;
        hfEndpoint?: string;
        pythonIndexUrl?: string;
    }): Promise<MineruDeploymentPlan>;
    private assertIdle;
    private unlock;
    private lock;
    prepare(planId: string): Promise<MineruDeploymentStatus>;
    private performPrepare;
    private failure;
    cancel(): MineruDeploymentStatus;
    start(): Promise<MineruDeploymentStatus>;
    stop(): Promise<MineruDeploymentStatus>;
    connection(): {
        mineruLocalUrl: string;
        mineruLocalApiKey: string;
    };
    dispose(): Promise<void>;
}
/** Exercise the same upload/parse contract used by local document processing. */
export declare function probeManagedMineruParse(connection: {
    mineruLocalUrl: string;
    mineruLocalApiKey: string;
}, signal: AbortSignal): Promise<void>;
//# sourceMappingURL=mineru-deployment.d.ts.map