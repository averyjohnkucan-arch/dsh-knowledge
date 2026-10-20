import type { MineruDeploymentPlan, MineruModelFile } from './mineru-deployment-types.js';
export declare class DeploymentError extends Error {
    readonly code: string;
    readonly status: number;
    constructor(code: string, message: string, status?: number);
}
export declare const OWNERSHIP_MARKER = ".dsh-mineru-managed.json";
export declare function sameDeploymentPath(left: string, right: string): boolean;
export declare function resolveHuggingFaceEndpoint(configured?: string): string;
export declare function resolvePythonIndexUrl(configured?: string): string;
/** Refuse drive roots, home roots, relative paths, UNC and symlink/junction ancestors.
 * This protects ordinary mistakes and planted links, not a hostile local OS user. */
export declare function checkDeploymentPath(value: string): Promise<string>;
export declare function checkOwnedRoot(root: string): Promise<void>;
export declare function verifyModelFile(root: string, file: MineruModelFile, signal?: AbortSignal): Promise<boolean>;
export declare function availableBytes(root: string): Promise<number | null>;
export declare function createDeploymentPlan(input: {
    root: string;
    existingModels?: string;
    hfEndpoint?: string;
    pythonIndexUrl?: string;
}, options?: {
    files?: readonly MineruModelFile[];
    signal?: AbortSignal;
}): Promise<MineruDeploymentPlan>;
//# sourceMappingURL=mineru-deployment-plan.d.ts.map