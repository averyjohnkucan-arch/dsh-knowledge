/**
 * Surrogate-aware UTF-16 slicing and model text normalization. Code-unit
 * cuts must preserve valid pairs; isolated surrogates can be rejected by
 * providers and persist in session history. Keep this module pure because
 * both host bundles import it.
 * @module dsh-knowledge/knowledge/text-safety
 */
/** Move a slice start off an orphaned low surrogate. Shrink-only, so a slice
 *  that already respects a token budget keeps respecting it. */
export declare function snapSliceStart(text: string, index: number): number;
/** Move a slice end off an orphaned high surrogate. Shrink-only, so a slice
 *  that already respects a token budget keeps respecting it. */
export declare function snapSliceEnd(text: string, index: number): number;
/** Exit guard for model-visible text: replace any lone surrogate with U+FFFD.
 *  Length-preserving, so budget arithmetic stays valid. */
export declare function ensureWellFormed(text: string): string;
//# sourceMappingURL=text-safety.d.ts.map