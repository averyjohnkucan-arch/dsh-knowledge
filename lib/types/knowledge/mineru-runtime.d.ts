import { type ChildProcess } from 'node:child_process';
import type { MineruPythonEnvironment, MineruValidationSteps } from './mineru-deployment-types.js';
export declare function runtimeEnvironment(root: string, configPath?: string): NodeJS.ProcessEnv;
/** Only owned child trees are terminated; never look up a PID by port. */
export declare function stopOwnedChild(child: ChildProcess): Promise<void>;
export declare function runManagedCommand(executable: string, args: string[], root: string, signal: AbortSignal, timeoutMs: number): Promise<string>;
export declare function prepareRuntime(root: string, environmentId: string, signal: AbortSignal, selected?: MineruPythonEnvironment, onValidated?: (step: keyof MineruValidationSteps) => void, pythonIndexUrl?: string): Promise<string>;
export interface ManagedService {
    child: ChildProcess;
    url: string;
    apiKey: string;
    stop(): Promise<void>;
}
export declare function startManagedService(root: string, envRoot: string, port: number, signal: AbortSignal): Promise<ManagedService>;
export declare function syntheticMineruPdf(): Uint8Array;
export declare function probeManagedService(service: ManagedService, signal: AbortSignal): Promise<void>;
//# sourceMappingURL=mineru-runtime.d.ts.map