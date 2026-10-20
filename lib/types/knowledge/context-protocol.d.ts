/**
 * The pure, state-free half of the context protocol: the deterministic token
 * estimate and the canonical evidence serializer. Both host bundles need these
 * values — the knowledge engine (`context.ts` composes windows) and the
 * model-facing tools (`tool-knowledge`) — so they live in their own module.
 *
 * ONE RULE: nothing stateful may be added here. Each host entry is bundled
 * separately (see build.mjs), so a stateful helper placed here would be
 * silently duplicated into both bundles as two independent module instances.
 * Anything that keeps state belongs in the engine module (`context.ts`).
 * @module dsh-knowledge/knowledge/context-protocol
 */
import type { ContextChunkExcerpt, ContextWindow } from './types.js';
/** CJK-heavy text costs about 1.5 chars/token and other text about 4.
 * This intentionally mirrors the service/chunker estimate and is deterministic
 * across platforms; it does not download or initialise a model tokenizer. */
export declare function estimateContextTokens(text: string): number;
/** Serialize the exact evidence seen by rerank, tools, auto-preview and evals.
 * The output is always in document order; `>>>` marks (but never moves) the
 * canonical hit. */
export declare function serializeContextWindow(window: ContextWindow): string;
/** Serialize one excerpt exactly as it appears in the canonical window; the
 *  composer uses the same form for its budget arithmetic, so the two must not
 *  drift apart. */
export declare function serializeExcerpt(excerpt: ContextChunkExcerpt, anchor: boolean): string;
//# sourceMappingURL=context-protocol.d.ts.map