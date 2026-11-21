import type { IncomingMessage, ServerResponse } from 'node:http';
import { type AdConfig } from './config.js';
import type { KnowledgeService } from '../index.js';
export declare function privateHost(req: IncomingMessage, bind: string): boolean;
export declare function startAdServer(service: KnowledgeService, config: AdConfig): Promise<() => Promise<void>>;
/** One personal, loopback-only Harness process per OS user. Its credential is never sent to a model. */
export declare class AdClient {
    readonly origin: string;
    private cookie;
    private epoch;
    constructor(origin: string);
    private fetch;
    tool(path: string, data?: unknown): Promise<string>;
    handle(req: IncomingMessage, res: ServerResponse, bind: string): Promise<void>;
}
//# sourceMappingURL=http.d.ts.map