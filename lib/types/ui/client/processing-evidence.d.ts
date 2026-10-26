import type { DocumentProcessingInfo, DocumentSourceSpan, KnowledgeApi, ProcessingProgress } from './api.js';
import type { Translate } from './locales.js';
export declare function processingStageLabel(progress: ProcessingProgress, t: Translate): string;
export declare function sourcePageUrl(documentId: string, pageIndex: number): string | undefined;
export declare function artifactUrl(documentId: string, revision: string, assetId: string): string;
export declare function ProcessingSummary({ processing, t }: {
    processing?: DocumentProcessingInfo;
    t: Translate;
}): JSX.Element | null;
/** Geometry describes a source block; a native PDF iframe cannot align an overlay reliably. */
export declare function SourceReferences(props: {
    documentId: string;
    spans?: readonly DocumentSourceSpan[];
    t: Translate;
    onPage?: (pageIndex: number) => void;
    revision?: string;
}): JSX.Element | null;
export declare function EvidenceInspector(props: {
    api: KnowledgeApi;
    documentId: string;
    revision?: string;
    t: Translate;
    onPage: (pageIndex: number) => void;
}): JSX.Element;
//# sourceMappingURL=processing-evidence.d.ts.map