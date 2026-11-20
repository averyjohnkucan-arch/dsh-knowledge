/**
 * Browser half of the knowledge base: a Cherry Studio-style sidebar entry at
 * the sidebar foot (beside Settings) plus a frame-wide floating panel. The
 * panel lives OUTSIDE settings — it opens over the workspace, exactly like
 * Cherry Studio's top-level knowledge-base page.
 * @module dsh-knowledge/client
 */
import type { Context } from '@deepseek-ai/cordis';
/** Required services; each target slot is awaited through `slots.inject`. */
export declare const inject: string[];
/** Register the knowledge sidebar action and its overlay panel. */
export declare function apply(ctx: Context): void;
//# sourceMappingURL=index.d.ts.map