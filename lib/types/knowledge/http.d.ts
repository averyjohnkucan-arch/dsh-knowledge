/**
 * JSON HTTP surface for the knowledge service, served on the same origin as
 * the browser panel at `/knowledge/*`. Responses use a uniform envelope:
 * `{ ok: true, value }` on success, `{ ok: false, error: { code, message } }`
 * on failure.
 * @module dsh-knowledge/knowledge/http
 */
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { type KnowledgeService } from './index.js';
export declare function knowledgeRoute(service: KnowledgeService): WebRoute;
/** A client mistake: a malformed body, a bad content type, an id-less batch. It
 *  is mapped to 400 so a caller's error is not reported as a server fault (and
 *  does not count as a 5xx in monitoring). */
export declare class InvalidRequestError extends Error {
    readonly code = "invalid_request";
    constructor(message: string);
}
//# sourceMappingURL=http.d.ts.map