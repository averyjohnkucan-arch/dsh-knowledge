/** Never follow a source symlink outside the selected root. */
export declare function externalFile(root: string, path: string): Promise<string>;
export declare function readableRoot(path: string): Promise<void>;
export interface FolderState {
    state: 'checking' | 'syncing' | 'connected' | 'disconnected' | 'error' | 'paused';
    message?: string;
    checkedAt?: number;
}
export interface FolderSource {
    id: string;
    path: string;
    intervalMs: number;
    enabled: boolean;
}
/** File events are hints; periodic full reconciliation repairs missed events and restarts. */
export declare class ExternalFolders {
    private sources;
    private sync;
    readonly states: Map<string, FolderState>;
    private watchers;
    private pending;
    private forced;
    private next;
    private stopped;
    private running;
    private timer?;
    constructor(sources: () => FolderSource[], sync: (id: string) => Promise<void>);
    start(): void;
    tick(): Promise<void>;
    private reconcile;
    request(id: string, force?: boolean): void;
    stop(): void;
}
/** User-initiated host dialog. No shell interpolation of paths or user input. */
export declare function pickFolder(): Promise<string | null>;
//# sourceMappingURL=external-folders.d.ts.map