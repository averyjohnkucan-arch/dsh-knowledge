/**
 * Shared HTTP helpers. Node's built-in fetch (undici) ignores HTTP_PROXY /
 * HTTPS_PROXY / NO_PROXY — the reason a browser can reach a site while a
 * plugin request dies with a bare "fetch failed". `applyGlobalProxy` routes
 * EVERY global fetch in the process (including transformers.js model
 * downloads, which call the bare global fetch) through undici's
 * EnvHttpProxyAgent when a proxy is configured, and `httpFetch` adds a
 * timeout, one retry, and the real error cause chain.
 * @module dsh-knowledge/knowledge/net
 */
/**
 * Make every `fetch()` in the process honor HTTP_PROXY / HTTPS_PROXY /
 * NO_PROXY. Safe when no proxy is configured (direct connections, unchanged
 * behavior); idempotent. Must be called before any download starts.
 */
export declare function applyGlobalProxy(): void;
export interface HttpFetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    /** Per-attempt timeout in milliseconds. */
    timeoutMs?: number;
    /**
     * Absolute wall-clock deadline shared by every attempt. When present, an
     * individual attempt receives the smaller of `timeoutMs` and the remaining
     * deadline budget, so retries can never multiply a caller's total budget.
     */
    deadlineAt?: number;
    /** Extra retries after the first failed attempt (default 1). */
    retries?: number;
    /** Redirect policy (default: follow, like fetch). SSRF guards pass 'manual'. */
    redirect?: 'follow' | 'manual';
    /** External abort (e.g. a delete cancelling an in-flight paid request). */
    signal?: AbortSignal;
}
/** fetch through the global (proxy-aware) dispatcher with timeout + one retry. */
export declare function httpFetch(url: string, options?: HttpFetchOptions): Promise<Response>;
/** A human-readable cause chain for a fetch/undici error. */
export declare function describeNetworkError(error: unknown): string;
/** Guidance appended to network failures surfaced in the panel. */
export declare const NETWORK_HINT = "If huggingface.co is unreachable, configure a trusted mirror in Local Models, or set HTTP(S)_PROXY and restart the service.";
//# sourceMappingURL=net.d.ts.map