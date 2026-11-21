import { z } from 'zod';
export declare const readerPath = "/knowledge/reader";
export declare const fileDigest: RegExp;
export declare const component: (part: string) => boolean;
export declare function httpsOrigin(input: string): string;
declare const mapping: z.ZodObject<{
    baseId: z.ZodString;
    localRoot: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    server: z.ZodString;
    share: z.ZodString;
    subfolder: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
declare const settings: z.ZodObject<{
    domainController: z.ZodString;
    groupPolicyFile: z.ZodString;
    policyAdmins: z.ZodArray<z.ZodString>;
    realm: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    publicOrigin: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
    listenHost: z.ZodString;
    port: z.ZodNumber;
    certificate: z.ZodString;
    privateKey: z.ZodString;
    mappings: z.ZodArray<z.ZodObject<{
        baseId: z.ZodString;
        localRoot: z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;
        server: z.ZodString;
        share: z.ZodString;
        subfolder: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    sessionMinutes: z.ZodDefault<z.ZodNumber>;
    maxSessions: z.ZodDefault<z.ZodNumber>;
}, z.core.$strict>;
export type AdConfig = z.infer<typeof settings>;
export type Mapping = z.infer<typeof mapping>;
export declare function loadAdConfig(path: string): AdConfig;
export declare class ReaderError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
export declare const unavailable: () => ReaderError;
export declare function loopback(host?: string): boolean;
export {};
//# sourceMappingURL=config.d.ts.map