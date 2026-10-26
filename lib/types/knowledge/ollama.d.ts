/**
 * Ollama model management — pull models through the Ollama API with live
 * progress (NDJSON stream over POST /api/pull), list installed models
 * (GET /api/tags). Pulled models are selectable as the embedding provider
 * (provider `ollama`) and as local captioning VLMs, fully offline.
 * @module dsh-knowledge/knowledge/ollama
 */
export interface OllamaPullStatus {
    status: 'idle' | 'pulling' | 'ready' | 'error';
    /** 0–100 download progress while `pulling`. */
    progress: number;
    message: string;
}
export declare function getOllamaPullStatus(model: string): OllamaPullStatus;
/** An installed Ollama model (name + on-disk size in bytes when reported). */
export interface OllamaModelInfo {
    name: string;
    size?: number;
}
/** List models already installed in the Ollama server (with sizes when reported). */
export declare function listOllamaModels(baseUrl: string): Promise<OllamaModelInfo[]>;
/** Delete an installed model (Ollama refuses models that are currently running). */
export declare function deleteOllamaModel(model: string, baseUrl: string): Promise<void>;
/**
 * Pull a model from Ollama's registry with streamed progress. Idempotent per
 * model while a pull is in flight; progress is observed through
 * {@link getOllamaPullStatus}. Failures land in the status map (never
 * swallowed) and rethrow. {@link cancelOllamaPull} aborts the stream; the
 * partial download stays in Ollama's store (it resumes on the next pull).
 */
export declare function pullOllamaModel(model: string, baseUrl: string): Promise<void>;
/** Abort an in-flight pull: the stream closes, the status resets to idle. */
export declare function cancelOllamaPull(model: string): void;
/**
 * Every pull currently in flight, for the settings panel to restore its
 * progress cards after a close/reopen (the UI state is per-component; the
 * pull itself lives here in the service and survives panel close).
 */
export declare function activeOllamaPulls(): Array<{
    model: string;
    status: OllamaPullStatus['status'];
    progress: number;
    message: string;
}>;
//# sourceMappingURL=ollama.d.ts.map