export type PrivatePythonRunner = (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
/** Bootstrap from Node itself: no system Python, shell installer or global package changes. */
export declare function ensurePrivatePython(root: string, run: PrivatePythonRunner): Promise<string>;
//# sourceMappingURL=private-python.d.ts.map