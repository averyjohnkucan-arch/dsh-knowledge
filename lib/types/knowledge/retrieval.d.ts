/**
 * Retrieval ranking. Three signals share one interface: BM25 lexical scoring,
 * cosine similarity over normalized vectors, and their Reciprocal Rank Fusion
 * hybrid, with optional Maximal Marginal Relevance for diverse results.
 * @module dsh-knowledge/knowledge/retrieval
 */
import type { SearchMode } from './types.js';
/** Cosine similarity between two (assumed L2-normalized) vectors. */
export declare function cosineSimilarity(a: readonly number[], b: readonly number[]): number;
/**
 * Tokenize text: latin words (lowercased) plus CJK character bigrams, with
 * single CJK chars as a fallback so short queries still match. Deterministic.
 */
export declare function tokenize(text: string): string[];
/** A corpus-built BM25 scorer: `score(id, queryTokens)` → raw BM25 score. */
export interface Bm25Scorer {
    score(id: string, queryTokens: readonly string[]): number;
}
/** Build a BM25 scorer over a corpus of `{ id, text }` documents. */
export declare function buildBm25(documents: ReadonlyArray<{
    id: string;
    text: string;
}>): Bm25Scorer;
/** Map an unbounded BM25 score into [0, 1). */
export declare function normalizeBm25(raw: number): number;
export declare const RRF_K = 60;
/**
 * Reciprocal Rank Fusion over id-ranked lists; returns id → fused score.
 * `weights` (parallel to `rankedLists`, defaults to 1 for each) scales each
 * list's contribution — e.g. [2, 1] doubles the first lane's pull.
 */
export declare function reciprocalRankFusion(rankedLists: ReadonlyArray<readonly string[]>, weights?: readonly number[]): Map<string, number>;
/** Re-rank hits for diversity using Maximal Marginal Relevance. */
export declare function maximalMarginalRelevance(hits: readonly RankedHit[], byId: ReadonlyMap<string, {
    embedding?: number[];
}>, queryVector: readonly number[], lambda: number, topK: number): RankedHit[];
export interface RankableChunk {
    id: string;
    text: string;
    embedding?: number[];
}
export interface RankOptions {
    mode: SearchMode;
    topK: number;
    threshold: number;
    mmr: boolean;
    mmrLambda: number;
    queryVector?: number[];
}
export interface RankedHit {
    id: string;
    score: number;
    vectorScore?: number;
    lexicalScore?: number;
}
/** Rank candidates with the selected strategy, then threshold + top-k. */
export declare function rank(query: string, candidates: readonly RankableChunk[], options: RankOptions): RankedHit[];
//# sourceMappingURL=retrieval.d.ts.map