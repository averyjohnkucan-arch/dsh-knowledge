/** One serialized request per persistent process; bounded diagnostics, no document text over stdout. */
export declare class StructureProcess {
    private command;
    private args;
    private env;
    private prefix;
    private child?;
    private pending?;
    private sequence;
    private log;
    constructor(command: string, args: string[], env: NodeJS.ProcessEnv, prefix?: string);
    private stop;
    private start;
    run(input: string, output: string, charts: boolean, timeout: number, signal?: AbortSignal): Promise<void>;
    request(payload: Record<string, unknown>, timeout: number, signal?: AbortSignal): Promise<Record<string, unknown>>;
    get pid(): number | undefined;
    stopAndWait(): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=structure-process.d.ts.map