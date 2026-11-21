import { type AdConfig } from './config.js';
import { type AdAction } from './roles.js';
import type { AdLibrary } from './retrieval.js';
import type { Access } from './session.js';
import type { KnowledgeService } from '../index.js';
export declare function administration(service: KnowledgeService, library: AdLibrary, config: AdConfig, access: Access, permitted: readonly AdAction[], path: string, method: string, body: unknown, baseId?: string): Promise<{
    [k: string]: any;
} | {
    groups: {
        read: string[];
        settings: string[];
        sync: string[];
        models: string[];
    };
    version: string;
} | {
    id: string;
    name: string;
    kind: string;
}[]>;
//# sourceMappingURL=administration.d.ts.map