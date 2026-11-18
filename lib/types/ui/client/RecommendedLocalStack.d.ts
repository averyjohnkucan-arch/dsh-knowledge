import type { KnowledgeApi } from './api.js';
export declare const RECOMMENDED_LOCAL: {
    embeddingProvider: "local";
    embeddingModel: string;
    rerankModel: string;
    rerankBaseUrl: string;
    rerankApiKey: string;
    documentProcessorProvider: "builtin";
    ocrEnabled: boolean;
    structureV3Charts: boolean;
    imageCaptionProvider: "paddle";
    imageCaptionModel: string;
    localWorkerIdleTimeoutMs: number;
    searchMode: "hybrid";
};
export declare function RecommendedLocalStack({ api }: {
    api: KnowledgeApi;
}): import("react").JSX.Element;
//# sourceMappingURL=RecommendedLocalStack.d.ts.map