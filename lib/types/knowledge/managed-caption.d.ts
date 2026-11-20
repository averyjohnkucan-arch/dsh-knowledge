/** Distinguish our own managed inference from a foreground chat reservation. */
export declare const isManagedCaptionCall: () => boolean;
export type ManagedCaption = (png: Uint8Array, model: string, prompt: string, signal?: AbortSignal) => Promise<string>;
/** Optional host services: the host adapter owns model startup and scheduler leases. */
interface CaptionHost {
    get(name: string): unknown;
}
/** One short request at a time; don't queue a corpus of image requests in the model server. */
export declare function createManagedCaption(host: CaptionHost): ManagedCaption;
export {};
//# sourceMappingURL=managed-caption.d.ts.map