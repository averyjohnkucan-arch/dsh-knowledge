/** Versioned IPC contract for the isolated local embedding process. */
export declare const LOCAL_EMBED_PROTOCOL_VERSION: 1;
export type LocalEmbedOperation = 'download' | 'load' | 'embed' | 'release' | 'shutdown';
export type LocalEmbedPooling = 'last_token' | 'cls' | 'mean';
interface LocalEmbedEnvelope {
    readonly protocolVersion: typeof LOCAL_EMBED_PROTOCOL_VERSION;
    readonly id: number;
    readonly operation: LocalEmbedOperation;
}
export interface LocalEmbedRequest extends LocalEmbedEnvelope {
    readonly modelId: string;
    readonly cacheDir: string;
    readonly hfEndpoint?: string;
    readonly texts?: string[];
    readonly cpuTuning?: {
        threads?: number;
        instances?: number;
        microBatch?: number;
    };
    readonly pooling?: LocalEmbedPooling;
}
export interface LocalEmbedSuccess extends LocalEmbedEnvelope {
    readonly ok: true;
    readonly vectors?: number[][];
}
export interface LocalEmbedFailure extends LocalEmbedEnvelope {
    readonly ok: false;
    readonly error: {
        readonly code: 'runtime_error' | 'invalid_response';
        readonly message: string;
        readonly retryable: boolean;
    };
}
export interface LocalEmbedProgress {
    readonly type: 'progress';
    readonly modelId: string;
    readonly status: 'idle' | 'downloading' | 'ready' | 'error';
    readonly progress: number;
    readonly message: string;
}
export type LocalEmbedResponse = LocalEmbedSuccess | LocalEmbedFailure;
export declare function isLocalEmbedRequest(value: unknown): value is LocalEmbedRequest;
export declare function isLocalEmbedResponse(value: unknown): value is LocalEmbedResponse;
export declare function isLocalEmbedProgress(value: unknown): value is LocalEmbedProgress;
export {};
//# sourceMappingURL=embed-protocol.d.ts.map