/** A failed durable write: callers must retain the previous metadata. */
export declare class MetadataWriteError extends Error {
    constructor(cause: unknown);
}
/** Also recognizes a failed metadata acknowledgement after SQLite publication. */
export declare function isMetadataWriteFailure(error: unknown): boolean;
/** A single queue prevents a retrying put from overtaking a later delete. */
export declare class MetadataWriter {
    private chain;
    run<T>(operation: () => Promise<T>): Promise<T>;
    drain(): Promise<void>;
}
//# sourceMappingURL=metadata-write.d.ts.map