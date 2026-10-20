/** Optional directory capabilities normalized across DSH client versions. */
export interface DirectoryActions {
    pickDirectory?: () => Promise<string | null>;
    openPath?: (path: string) => Promise<void>;
    canOpenPath?: () => Promise<boolean>;
}
interface DirectoryServices {
    nativePicker?: unknown;
    uiWorkspace?: unknown;
    remote?: unknown;
    workspaces?: unknown;
}
/** Preserve the desktop picker window owner and the receiving service's this.
 * A resolver additionally follows service registration and replacement after
 * slot props have been cached; static service snapshots retain their behavior. */
export declare function createDirectoryActions(services: DirectoryServices | (() => DirectoryServices)): DirectoryActions;
export {};
//# sourceMappingURL=directory-actions.d.ts.map