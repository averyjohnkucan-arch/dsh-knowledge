import { z } from 'zod';
export declare const actions: readonly ["read", "settings", "sync", "models", "policy"];
export type AdAction = typeof actions[number];
export declare const groups: z.ZodArray<z.ZodString>;
export declare const roleGroups: z.ZodObject<{
    read: z.ZodArray<z.ZodString>;
    settings: z.ZodArray<z.ZodString>;
    sync: z.ZodArray<z.ZodString>;
    models: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const safeSettings: z.ZodObject<{
    topK: z.ZodNumber;
    searchMode: z.ZodEnum<{
        auto: "auto";
        hybrid: "hybrid";
        vector: "vector";
        lexical: "lexical";
    }>;
    similarityThreshold: z.ZodNumber;
    siblingChunks: z.ZodNumber;
    chunkSize: z.ZodNumber;
    chunkOverlap: z.ZodNumber;
    keepInternalMarkdown: z.ZodBoolean;
    ocrEnabled: z.ZodBoolean;
}, z.core.$strict>;
export declare function projectSettings(config: object): {
    [k: string]: any;
};
//# sourceMappingURL=roles.d.ts.map