import type { KnowledgeApi } from './api.js';
export declare const RECOMMENDED_LOCAL: {
    embeddingProvider: "local";
    embeddingModel: string;
    embeddingDimensions: number;
    rerankModel: string;
    keepInternalMarkdown: boolean;
};
export declare function RecommendedLocalStack({ api }: {
    api: KnowledgeApi;
}): import("react").JSX.Element;
//# sourceMappingURL=RecommendedLocalStack.d.ts.map