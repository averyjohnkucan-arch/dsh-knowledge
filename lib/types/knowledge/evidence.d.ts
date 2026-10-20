import type { KnowledgeDocument } from './types.js';
import type { DocumentEvidence, ParsedDocument } from './processing-types.js';
/** A caller-supplied evidence cursor must not surface as a server failure. */
export declare class EvidenceRequestError extends Error {
    readonly code: 'invalid_request' | 'not_found';
    constructor(code: 'invalid_request' | 'not_found', message: string);
}
/** Token-bounded evidence continuation. Offsets remain canonical UTF-16
 * positions; a cropped block never invents a page or a physical rectangle. */
export declare function composeDocumentEvidence(doc: KnowledgeDocument, parsed: ParsedDocument, options?: {
    pageIndex?: number;
    blockId?: string;
    blockOffset?: number;
    maxTokens?: number;
}): DocumentEvidence;
//# sourceMappingURL=evidence.d.ts.map