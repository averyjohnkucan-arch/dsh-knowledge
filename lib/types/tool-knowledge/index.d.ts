/**
 * Model-facing knowledge tools. The tools consume the host `knowledge`
 * service and publish nothing themselves, so this row sits as an ordinary
 * tool plugin beside the service it reaches (the same split the goal and
 * interconnect tools use against their host services).
 * @module dsh-knowledge/tool-knowledge
 */
import { Context } from '@deepseek-ai/cordis';
import type { KnowledgeService } from '../knowledge/index.js';
import type { ContextWindow, SearchResult } from '../knowledge/types.js';
import type { DocumentEvidence, DocumentProcessingInfo, DocumentSourceSpan } from '../knowledge/processing-types.js';
/** Hard ceiling for the complete model-visible native search rendering. */
export declare const SEARCH_RENDER_MAX_TOKENS = 8192;
export declare function knowledgeDestructiveApprovalReason(name: string): string | undefined;
export declare function renderKnowledgeDocumentPage(value: {
    readMode?: 'page' | 'context';
    title: string;
    chunkCount: number;
    chunks: Array<{
        index: number;
        heading?: string;
        text: string;
        sourceSpans?: readonly DocumentSourceSpan[];
    }>;
    processing?: DocumentProcessingInfo;
    truncated: boolean;
    nextChunkOffset?: number;
    contextWindow?: ContextWindow;
}): string;
export declare function renderKnowledgeEvidence(value: DocumentEvidence): string;
export declare function renderKnowledgeReadResult(value: {
    documentId?: string;
    title: string;
    totalChars?: number;
    charStart?: number;
    charEnd?: number;
    content?: string;
    truncated?: boolean;
    totalMatches?: number;
    matches?: Array<{
        line: number;
        charStart?: number;
        charEnd?: number;
        snippet: string;
    }>;
}): string;
/** Canonical model-visible rendering for explicit search. Keeping this as a
 * named helper lets the benchmark and contract tests measure the exact same
 * output that the tool runtime sends to the model. */
export declare function renderKnowledgeSearchResult(value: SearchResult, baseNameOf?: (baseId: string) => string | undefined): string;
/** Services required before the tools can register. */
export declare const inject: string[];
/** Register the knowledge tool surface. */
export declare function apply(ctx: Context): void;
/** The loop's pre-step decision: enter a step with messages, or reject it.
 *  The handler return type is inferred from the DSH event declaration. */
/** Extract the claimed USER input (source kind 'user') from a pre-step batch —
 *  plugin context (our own background, agent-instructions, approvals…) never
 *  triggers a retrieval, so a folded background cannot re-trigger itself.
 *  Exported for tests. */
export declare function userTextOf(messages: readonly AutoRetrieveMessage[]): string;
/** Insert the background message right after the claimed batch (agent-instructions
 *  fold posture): the direct prompt precedes it, driver context follows it.
 *  Exported for tests. */
export declare function foldBackground<T>(decisionMessages: T[], claimedMessages: readonly AutoRetrieveMessage[], background: T): T[];
/** Minimal structural view of an agent the auto-retriever folds into. */
interface AutoRetrieveAgent {
    readonly id: string;
    inject(message: unknown): void;
}
/** Minimal structural view of a claimed user message. */
interface AutoRetrieveMessage {
    readonly content: ReadonlyArray<{
        readonly type?: string;
        readonly text?: string;
    }>;
    readonly source?: {
        readonly kind?: string;
        readonly plugin?: string;
    };
}
/** A folded auto-retrieve background message with a producer-owned source. */
export interface AutoRetrieveBackground {
    readonly message: {
        role: 'user';
        content: ReadonlyArray<{
            type: 'text';
            text: string;
        }>;
        source: {
            kind: 'dsh-knowledge';
            form: 'notice';
            summary: string;
            passageCount: number;
        };
        id: string;
    };
    /** Commit throttle/dedup state only after the message was actually folded or injected. */
    commit(): void;
}
/** A completed search with no delivered evidence is still a durable, inspectable result. */
export declare function emptyRetrievalBackground(): AutoRetrieveBackground;
/** Search the bases for `text` and build the background message to fold into
 *  the triggering pre-step batch. Returns undefined when nothing clears the
 *  gates (best-effort; never throws). State is committed separately, after a
 *  caller has successfully folded or injected the returned message. */
export declare function buildAutoRetrieveMessage(knowledge: KnowledgeService, agent: AutoRetrieveAgent, text: string, signal?: AbortSignal, contextText?: string | readonly string[], onSearched?: () => void): Promise<AutoRetrieveBackground | undefined>;
/** Back-compat entry: build the background and inject it via the agent handle
 *  (used by tests; production folds via agent/pre-step instead). */
export declare function autoRetrieveBackground(knowledge: KnowledgeService, agent: AutoRetrieveAgent, text: string): Promise<void>;
/** Query-centred, deterministic token clipping shared by native search and
 * auto-preview. When no query component is present, clipping starts at the
 * beginning. The returned text never exceeds `maxTokens` under the project's
 * deterministic estimator. */
export declare function clipAroundQuery(text: string, query: string, maxTokens: number): string;
export {};
//# sourceMappingURL=index.d.ts.map