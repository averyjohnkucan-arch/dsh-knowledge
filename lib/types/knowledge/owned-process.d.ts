import { type ChildProcess } from 'node:child_process';
/** Only use for child processes created with a private process group. */
export declare function stopOwnedProcess(child: ChildProcess, signal?: NodeJS.Signals): void;
//# sourceMappingURL=owned-process.d.ts.map