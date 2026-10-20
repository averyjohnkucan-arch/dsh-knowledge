/**
 * The single durable domain for the knowledge store: `bases`, `documents`,
 * and `chunks` tables plus a global slot holding runtime config overrides.
 * Record schemas are zod (validated at the durable boundary by
 * `@deepseek-ai/dsh-storage-domain`); plugin Config stays schemastery.
 * @module dsh-knowledge/knowledge/domain
 */
import { z } from 'zod';
import type { MineruTier } from './processing-types.js';
import type { KnowledgeBase, KnowledgeConfig, KnowledgeDocument } from './types.js';
/** Per-base config overrides, validated at the durable boundary. */
export declare const baseConfigSchema: z.ZodObject<{
    embeddingProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        local: "local";
        none: "none";
    }>>;
    embeddingBaseUrl: z.ZodOptional<z.ZodString>;
    embeddingModel: z.ZodOptional<z.ZodString>;
    embeddingApiKey: z.ZodOptional<z.ZodString>;
    rerankModel: z.ZodOptional<z.ZodString>;
    rerankBaseUrl: z.ZodOptional<z.ZodString>;
    rerankApiKey: z.ZodOptional<z.ZodString>;
    localRerankTimeoutMs: z.ZodOptional<z.ZodNumber>;
    smartChunk: z.ZodOptional<z.ZodBoolean>;
    chunkSeparator: z.ZodOptional<z.ZodString>;
    chunkSize: z.ZodOptional<z.ZodNumber>;
    chunkOverlap: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    searchMode: z.ZodOptional<z.ZodEnum<{
        vector: "vector";
        auto: "auto";
        hybrid: "hybrid";
        lexical: "lexical";
    }>>;
    similarityThreshold: z.ZodOptional<z.ZodNumber>;
    mmrDiversity: z.ZodOptional<z.ZodNumber>;
    rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
    embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
    siblingChunks: z.ZodOptional<z.ZodNumber>;
    ocrEnabled: z.ZodOptional<z.ZodBoolean>;
    structureV3Charts: z.ZodOptional<z.ZodBoolean>;
    documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
        builtin: "builtin";
        mineru: "mineru";
        "mineru-local": "mineru-local";
    }>>;
    mineruApiKey: z.ZodOptional<z.ZodString>;
    mineruApiHost: z.ZodOptional<z.ZodString>;
    mineruLocalUrl: z.ZodOptional<z.ZodString>;
    mineruLocalApiKey: z.ZodOptional<z.ZodString>;
    mineruTier: z.ZodOptional<z.ZodEnum<{
        flash: "flash";
        basic: "basic";
        standard: "standard";
        advanced: "advanced";
    }>>;
    documentProcessingTimeoutMs: z.ZodOptional<z.ZodNumber>;
    structuredChunking: z.ZodOptional<z.ZodBoolean>;
    semanticChunk: z.ZodOptional<z.ZodBoolean>;
    semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
    semanticChunkCandidateTokens: z.ZodOptional<z.ZodNumber>;
    chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
    conflictStrategy: z.ZodOptional<z.ZodEnum<{
        replace: "replace";
        keep: "keep";
        rename: "rename";
    }>>;
    urlRefreshHours: z.ZodOptional<z.ZodNumber>;
    imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
        paddle: "paddle";
        openai: "openai";
        ollama: "ollama";
        off: "off";
    }>>;
    imageCaptionModel: z.ZodOptional<z.ZodString>;
    imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
    imageCaptionApiKey: z.ZodOptional<z.ZodString>;
    autoRetrieveWeight: z.ZodOptional<z.ZodNumber>;
    resumeInterruptedOnStartup: z.ZodOptional<z.ZodBoolean>;
    autoRetrieve: z.ZodOptional<z.ZodBoolean>;
    injectUsagePrompt: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const documentProcessingInfoSchema: z.ZodObject<{
    revision: z.ZodString;
    artifactId: z.ZodString;
    sourceHash: z.ZodString;
    provider: z.ZodEnum<{
        builtin: "builtin";
        paddle: "paddle";
        mineru: "mineru";
        "mineru-local": "mineru-local";
    }>;
    processorVersion: z.ZodOptional<z.ZodString>;
    optionsFingerprint: z.ZodString;
    parsedAt: z.ZodNumber;
    completeness: z.ZodEnum<{
        unknown: "unknown";
        complete: "complete";
        partial: "partial";
    }>;
    pageCount: z.ZodOptional<z.ZodNumber>;
    processedPages: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
    warnings: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, z.core.$strip>>;
    reused: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const documentSchema: z.ZodObject<{
    id: z.ZodString;
    baseId: z.ZodString;
    title: z.ZodString;
    sourceType: z.ZodEnum<{
        text: "text";
        file: "file";
        url: "url";
        directory: "directory";
    }>;
    fileName: z.ZodOptional<z.ZodString>;
    mimeType: z.ZodOptional<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    parentDirectoryId: z.ZodOptional<z.ZodString>;
    sourcePath: z.ZodOptional<z.ZodString>;
    sourceSignature: z.ZodOptional<z.ZodString>;
    contentHash: z.ZodOptional<z.ZodString>;
    rawFilePath: z.ZodOptional<z.ZodString>;
    rawText: z.ZodOptional<z.ZodString>;
    processing: z.ZodOptional<z.ZodObject<{
        revision: z.ZodString;
        artifactId: z.ZodString;
        sourceHash: z.ZodString;
        provider: z.ZodEnum<{
            builtin: "builtin";
            paddle: "paddle";
            mineru: "mineru";
            "mineru-local": "mineru-local";
        }>;
        processorVersion: z.ZodOptional<z.ZodString>;
        optionsFingerprint: z.ZodString;
        parsedAt: z.ZodNumber;
        completeness: z.ZodEnum<{
            unknown: "unknown";
            complete: "complete";
            partial: "partial";
        }>;
        pageCount: z.ZodOptional<z.ZodNumber>;
        processedPages: z.ZodOptional<z.ZodArray<z.ZodNumber>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strip>>;
        reused: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    charCount: z.ZodNumber;
    tokenCount: z.ZodOptional<z.ZodNumber>;
    chunkCount: z.ZodNumber;
    incomplete: z.ZodOptional<z.ZodBoolean>;
    vectorizationRevision: z.ZodOptional<z.ZodString>;
    embeddingError: z.ZodOptional<z.ZodString>;
    errorCode: z.ZodOptional<z.ZodEnum<{
        interrupted: "interrupted";
        dimension_mismatch: "dimension_mismatch";
        parse_failed: "parse_failed";
        embedding_provider: "embedding_provider";
    }>>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Runtime overrides merged over the plugin Config defaults (user-editable). */
export declare const configOverridesSchema: z.ZodObject<{
    embeddingProvider: z.ZodOptional<z.ZodEnum<{
        openai: "openai";
        ollama: "ollama";
        local: "local";
        none: "none";
    }>>;
    embeddingBaseUrl: z.ZodOptional<z.ZodString>;
    embeddingModel: z.ZodOptional<z.ZodString>;
    embeddingApiKey: z.ZodOptional<z.ZodString>;
    rerankModel: z.ZodOptional<z.ZodString>;
    rerankBaseUrl: z.ZodOptional<z.ZodString>;
    rerankApiKey: z.ZodOptional<z.ZodString>;
    localRerankTimeoutMs: z.ZodOptional<z.ZodNumber>;
    smartChunk: z.ZodOptional<z.ZodBoolean>;
    chunkSeparator: z.ZodOptional<z.ZodString>;
    chunkSize: z.ZodOptional<z.ZodNumber>;
    chunkOverlap: z.ZodOptional<z.ZodNumber>;
    topK: z.ZodOptional<z.ZodNumber>;
    searchMode: z.ZodOptional<z.ZodEnum<{
        vector: "vector";
        auto: "auto";
        hybrid: "hybrid";
        lexical: "lexical";
    }>>;
    similarityThreshold: z.ZodOptional<z.ZodNumber>;
    mmrDiversity: z.ZodOptional<z.ZodNumber>;
    rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
    embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
    siblingChunks: z.ZodOptional<z.ZodNumber>;
    hfEndpoint: z.ZodOptional<z.ZodString>;
    mineruPythonIndexUrl: z.ZodOptional<z.ZodString>;
    ocrEnabled: z.ZodOptional<z.ZodBoolean>;
    structureV3Charts: z.ZodOptional<z.ZodBoolean>;
    documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
        builtin: "builtin";
        mineru: "mineru";
        "mineru-local": "mineru-local";
    }>>;
    mineruApiKey: z.ZodOptional<z.ZodString>;
    mineruApiHost: z.ZodOptional<z.ZodString>;
    mineruLocalUrl: z.ZodOptional<z.ZodString>;
    mineruLocalApiKey: z.ZodOptional<z.ZodString>;
    mineruTier: z.ZodOptional<z.ZodEnum<{
        flash: "flash";
        basic: "basic";
        standard: "standard";
        advanced: "advanced";
    }>>;
    documentProcessingTimeoutMs: z.ZodOptional<z.ZodNumber>;
    structuredChunking: z.ZodOptional<z.ZodBoolean>;
    semanticChunk: z.ZodOptional<z.ZodBoolean>;
    semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
    semanticChunkCandidateTokens: z.ZodOptional<z.ZodNumber>;
    chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
    conflictStrategy: z.ZodOptional<z.ZodEnum<{
        replace: "replace";
        keep: "keep";
        rename: "rename";
    }>>;
    urlRefreshHours: z.ZodOptional<z.ZodNumber>;
    imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
        paddle: "paddle";
        openai: "openai";
        ollama: "ollama";
        off: "off";
    }>>;
    imageCaptionModel: z.ZodOptional<z.ZodString>;
    imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
    imageCaptionApiKey: z.ZodOptional<z.ZodString>;
    resumeInterruptedOnStartup: z.ZodOptional<z.ZodBoolean>;
    autoRetrieve: z.ZodOptional<z.ZodBoolean>;
    injectUsagePrompt: z.ZodOptional<z.ZodBoolean>;
    autoRetrieveWeight: z.ZodOptional<z.ZodNumber>;
    localModelCacheDir: z.ZodOptional<z.ZodString>;
    localEmbeddingIgpuIdle: z.ZodOptional<z.ZodBoolean>;
    localEmbeddingMainGpuIdle: z.ZodOptional<z.ZodBoolean>;
    localEmbeddingThreads: z.ZodOptional<z.ZodNumber>;
    localEmbeddingInstances: z.ZodOptional<z.ZodNumber>;
    localEmbeddingMicroBatchSize: z.ZodOptional<z.ZodNumber>;
    localWorkerIdleTimeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Partial runtime config stored in the domain global slot. */
export interface ConfigOverrides {
    embeddingProvider?: KnowledgeConfig['embeddingProvider'];
    embeddingBaseUrl?: string;
    embeddingModel?: string;
    embeddingApiKey?: string;
    rerankModel?: string;
    rerankBaseUrl?: string;
    rerankApiKey?: string;
    localRerankTimeoutMs?: number;
    smartChunk?: boolean;
    chunkSeparator?: string;
    chunkSize?: number;
    chunkOverlap?: number;
    topK?: number;
    searchMode?: KnowledgeConfig['searchMode'];
    similarityThreshold?: number;
    mmrDiversity?: number;
    rrfVectorWeight?: number;
    embeddingBatchSize?: number;
    siblingChunks?: number;
    hfEndpoint?: string;
    mineruPythonIndexUrl?: string;
    documentProcessorProvider?: KnowledgeConfig['documentProcessorProvider'];
    mineruApiKey?: string;
    mineruApiHost?: string;
    mineruLocalUrl?: string;
    mineruLocalApiKey?: string;
    mineruTier?: MineruTier;
    documentProcessingTimeoutMs?: number;
    structuredChunking?: boolean;
    semanticChunk?: boolean;
    semanticChunkThreshold?: number;
    semanticChunkCandidateTokens?: number;
    chunkTokenLimit?: number;
    conflictStrategy?: 'keep' | 'replace' | 'rename';
    urlRefreshHours?: number;
    ocrEnabled?: boolean;
    structureV3Charts?: boolean;
    imageCaptionProvider?: 'off' | 'paddle' | 'openai' | 'ollama';
    imageCaptionModel?: string;
    imageCaptionBaseUrl?: string;
    imageCaptionApiKey?: string;
    resumeInterruptedOnStartup?: boolean;
    autoRetrieve?: boolean;
    injectUsagePrompt?: boolean;
    autoRetrieveWeight?: number;
    localModelCacheDir?: string;
    localEmbeddingIgpuIdle?: boolean;
    localEmbeddingMainGpuIdle?: boolean;
    localEmbeddingThreads?: number;
    localEmbeddingInstances?: number;
    localEmbeddingMicroBatchSize?: number;
    localWorkerIdleTimeoutMs?: number;
}
export declare const knowledgeDomainSpec: {
    name: string;
    version: number;
    global: {
        schema: z.ZodObject<{
            overrides: z.ZodObject<{
                embeddingProvider: z.ZodOptional<z.ZodEnum<{
                    openai: "openai";
                    ollama: "ollama";
                    local: "local";
                    none: "none";
                }>>;
                embeddingBaseUrl: z.ZodOptional<z.ZodString>;
                embeddingModel: z.ZodOptional<z.ZodString>;
                embeddingApiKey: z.ZodOptional<z.ZodString>;
                rerankModel: z.ZodOptional<z.ZodString>;
                rerankBaseUrl: z.ZodOptional<z.ZodString>;
                rerankApiKey: z.ZodOptional<z.ZodString>;
                localRerankTimeoutMs: z.ZodOptional<z.ZodNumber>;
                smartChunk: z.ZodOptional<z.ZodBoolean>;
                chunkSeparator: z.ZodOptional<z.ZodString>;
                chunkSize: z.ZodOptional<z.ZodNumber>;
                chunkOverlap: z.ZodOptional<z.ZodNumber>;
                topK: z.ZodOptional<z.ZodNumber>;
                searchMode: z.ZodOptional<z.ZodEnum<{
                    vector: "vector";
                    auto: "auto";
                    hybrid: "hybrid";
                    lexical: "lexical";
                }>>;
                similarityThreshold: z.ZodOptional<z.ZodNumber>;
                mmrDiversity: z.ZodOptional<z.ZodNumber>;
                rrfVectorWeight: z.ZodOptional<z.ZodNumber>;
                embeddingBatchSize: z.ZodOptional<z.ZodNumber>;
                siblingChunks: z.ZodOptional<z.ZodNumber>;
                hfEndpoint: z.ZodOptional<z.ZodString>;
                mineruPythonIndexUrl: z.ZodOptional<z.ZodString>;
                ocrEnabled: z.ZodOptional<z.ZodBoolean>;
                structureV3Charts: z.ZodOptional<z.ZodBoolean>;
                documentProcessorProvider: z.ZodOptional<z.ZodEnum<{
                    builtin: "builtin";
                    mineru: "mineru";
                    "mineru-local": "mineru-local";
                }>>;
                mineruApiKey: z.ZodOptional<z.ZodString>;
                mineruApiHost: z.ZodOptional<z.ZodString>;
                mineruLocalUrl: z.ZodOptional<z.ZodString>;
                mineruLocalApiKey: z.ZodOptional<z.ZodString>;
                mineruTier: z.ZodOptional<z.ZodEnum<{
                    flash: "flash";
                    basic: "basic";
                    standard: "standard";
                    advanced: "advanced";
                }>>;
                documentProcessingTimeoutMs: z.ZodOptional<z.ZodNumber>;
                structuredChunking: z.ZodOptional<z.ZodBoolean>;
                semanticChunk: z.ZodOptional<z.ZodBoolean>;
                semanticChunkThreshold: z.ZodOptional<z.ZodNumber>;
                semanticChunkCandidateTokens: z.ZodOptional<z.ZodNumber>;
                chunkTokenLimit: z.ZodOptional<z.ZodNumber>;
                conflictStrategy: z.ZodOptional<z.ZodEnum<{
                    replace: "replace";
                    keep: "keep";
                    rename: "rename";
                }>>;
                urlRefreshHours: z.ZodOptional<z.ZodNumber>;
                imageCaptionProvider: z.ZodOptional<z.ZodEnum<{
                    paddle: "paddle";
                    openai: "openai";
                    ollama: "ollama";
                    off: "off";
                }>>;
                imageCaptionModel: z.ZodOptional<z.ZodString>;
                imageCaptionBaseUrl: z.ZodOptional<z.ZodString>;
                imageCaptionApiKey: z.ZodOptional<z.ZodString>;
                resumeInterruptedOnStartup: z.ZodOptional<z.ZodBoolean>;
                autoRetrieve: z.ZodOptional<z.ZodBoolean>;
                injectUsagePrompt: z.ZodOptional<z.ZodBoolean>;
                autoRetrieveWeight: z.ZodOptional<z.ZodNumber>;
                localModelCacheDir: z.ZodOptional<z.ZodString>;
                localEmbeddingIgpuIdle: z.ZodOptional<z.ZodBoolean>;
                localEmbeddingMainGpuIdle: z.ZodOptional<z.ZodBoolean>;
                localEmbeddingThreads: z.ZodOptional<z.ZodNumber>;
                localEmbeddingInstances: z.ZodOptional<z.ZodNumber>;
                localEmbeddingMicroBatchSize: z.ZodOptional<z.ZodNumber>;
                localWorkerIdleTimeoutMs: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>;
            groups: z.ZodOptional<z.ZodArray<z.ZodString>>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            enabledBaseIds: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strip>;
        initial: {
            overrides: ConfigOverrides;
            enabled: boolean;
            enabledBaseIds: string[];
        };
    };
    tables: {
        bases: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, KnowledgeBase>;
        documents: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, KnowledgeDocument>;
    };
};
/** Table names, for the store layer. */
export declare const TABLES: {
    readonly bases: "bases";
    readonly documents: "documents";
    readonly chunks: "chunks";
};
//# sourceMappingURL=domain.d.ts.map