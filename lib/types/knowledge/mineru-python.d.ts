import type { MineruPythonDiscovery, MineruPythonEnvironment } from './mineru-deployment-types.js';
type CommandRunner = (file: string, args: string[], signal?: AbortSignal) => Promise<string>;
export declare function validatePythonExecutable(value: string): string;
export declare function parsePythonProbe(executable: string, source: string, output: string): MineruPythonEnvironment;
export declare function probePythonExecutable(value: string, signal?: AbortSignal, runner?: CommandRunner, source?: string): Promise<MineruPythonEnvironment>;
export declare function parsePythonLauncherPaths(output: string): string[];
export declare function discoverPythonEnvironments(signal?: AbortSignal): Promise<MineruPythonDiscovery>;
export {};
//# sourceMappingURL=mineru-python.d.ts.map