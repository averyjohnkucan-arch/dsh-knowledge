import type { IncomingMessage } from 'node:http';
/** Host has no authentication middleware. Fail closed on all-interface bind,
 * reverse proxies, Electron requests without a real socket, or browser CSRF.
 * A local OS process is already inside the desktop user's trust boundary. */
export declare function requireLocalManagement(req: IncomingMessage, bindHost: string): void;
//# sourceMappingURL=mineru-management-security.d.ts.map