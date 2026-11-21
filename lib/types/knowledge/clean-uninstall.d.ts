export interface UninstallProfile {
    home: string;
    dir: string;
    name: string;
}
export interface UninstallManager {
    removeBundle(name: string): Promise<{
        application: string;
        packageResult?: {
            exitCode: number | null;
            timedOut?: boolean;
        };
        error?: {
            code: string;
            diagnostic?: string;
        };
    }>;
}
export declare function cleanUninstall(profile: UninstallProfile, manager: UninstallManager, database: string, sources: string[], clearMetadata?: () => Promise<void>): Promise<{
    uninstalled: boolean;
}>;
//# sourceMappingURL=clean-uninstall.d.ts.map