import type { DocumentSourceSpan } from './processing-types.js';
/** Clip exact UTF-16 mappings to a displayed substring; never infer positions. */
export declare function sliceSourceSpans(spans: readonly DocumentSourceSpan[] | undefined, start: number, end: number): DocumentSourceSpan[];
export declare function validSourceSpan(value: unknown): value is DocumentSourceSpan;
/** Bounded citation labels. Full IDs and geometry remain in structured output. */
export declare function sourceSpanLabel(spans: readonly DocumentSourceSpan[] | undefined): string;
//# sourceMappingURL=source-spans.d.ts.map