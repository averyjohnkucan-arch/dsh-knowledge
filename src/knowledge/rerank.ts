/**
 * Rerank step (Cherry Studio's 重排模型): re-score the merged candidates
 * against the query through a Jina / SiliconFlow / Cohere-v2 style rerank
 * API (`POST {baseUrl}/rerank`), or through a local cross-encoder
 * (bge-reranker via transformers.js in the model worker) when the model id
 * carries the `local:` prefix. Disabled when no rerank model is set.
 * @module dsh-knowledge/knowledge/rerank
 */

import { httpFetch } from './net.js'
import { rerankInLocalProcess, LocalRerankError } from './local-rerank.js'
import { assertLocalRerankerReady, localRerankActionFor } from './localModels.js'
import { getHfEndpoint, localModelCacheDir } from './embed.js'
import { ensureWellFormed } from './text-safety.js'
import type { RerankErrorDetail } from './types.js'

export interface RerankCandidate {
  id: string
  text: string
}

/** Per-call controls for both remote and local rerank execution. */
export interface RerankExecutionOptions {
  /** Maximum number of candidates retained; defaults to every candidate. */
  topN?: number
  /** Maximum duration of one attempt/local operation (default 60 seconds). */
  timeoutMs?: number
  /** Absolute wall-clock deadline shared across remote retry attempts. */
  deadlineAt?: number
  /** Extra remote attempts after the first failure (default 1). */
  retries?: number
  /** Owner cancellation. An external abort is never retried. */
  signal?: AbortSignal
}

export class RerankExecutionError extends Error {
  constructor(readonly detail: RerankErrorDetail, readonly status?: number, technicalMessage = detail.message) {
    super(technicalMessage)
    this.name = 'RerankExecutionError'
  }
}

export function rerankErrorDetail(error: unknown): RerankErrorDetail {
  if (error instanceof RerankExecutionError) return error.detail
  if (error instanceof LocalRerankError) {
    const messages: Record<LocalRerankError['code'], string> = {
      model_not_downloaded: 'Local reranker is not downloaded. Download it in Settings → Local Models.',
      model_checking: 'Local reranker is downloading or being validated. Original retrieval order was preserved.',
      model_unhealthy: 'Local reranker failed its health check. Run validation again in Settings.',
      unsupported_model: 'Local reranker is not registered or its architecture is unsupported. Check the configuration.',
      timeout: 'Local reranking exceeded its time budget. Original retrieval order was preserved.',
      invalid_response: 'Local reranker returned invalid scores. Run model validation again.',
      runtime_error: 'Local reranking failed. Original retrieval order was preserved.',
      process_crash: 'Local reranker process exited unexpectedly. Original retrieval order was preserved.',
      circuit_open: 'Local reranking was temporarily paused after repeated failures. Try again shortly.',
      busy: 'Local reranking queue is busy. Original retrieval order was preserved.',
    }
    return { code: error.code, message: messages[error.code], retryable: error.retryable, action: localRerankActionFor(error.code) }
  }
  return { code: 'provider_error', message: 'Reranking service is temporarily unavailable. Original retrieval order was preserved.', retryable: true, action: 'retry_later' }
}

export function rerankTechnicalMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000)
}

/**
 * Rerank candidates, choosing the local worker when the model is `local:...`.
 * @param baseUrl - API root (ignored for local rerankers).
 * @param model - rerank model id (e.g. `jina-reranker-v2-base-multilingual`
 *   or `local:Xenova/bge-reranker-base`).
 * @param options - result count, timeout/shared deadline, retries, and owner
 *   cancellation. The old positional `topN, timeoutMs` form remains accepted
 *   during the 0.3.x compatibility window.
 * @returns id → validated relevance score in [0, 1], containing exactly the
 *   requested number of top-scoring candidates.
 */
export function rerankCandidates(
  baseUrl: string,
  model: string,
  apiKey: string,
  query: string,
  candidates: readonly RerankCandidate[],
  options?: RerankExecutionOptions,
): Promise<Map<string, number>>
/** @deprecated Use the RerankExecutionOptions object overload. */
export function rerankCandidates(
  baseUrl: string,
  model: string,
  apiKey: string,
  query: string,
  candidates: readonly RerankCandidate[],
  topN?: number,
  timeoutMs?: number,
): Promise<Map<string, number>>
export async function rerankCandidates(
  baseUrl: string,
  model: string,
  apiKey: string,
  query: string,
  candidates: readonly RerankCandidate[],
  optionsOrTopN?: RerankExecutionOptions | number,
  legacyTimeoutMs?: number,
): Promise<Map<string, number>> {
  const options = normalizeExecutionOptions(optionsOrTopN, legacyTimeoutMs)
  throwIfAborted(options.signal)
  if (candidates.length === 0) return new Map()
  const safeQuery = ensureWellFormed(query)
  const safeTexts = candidates.map(candidate => ensureWellFormed(candidate.text))
  const keep = options.topN !== undefined
    ? Math.max(1, Math.min(Math.trunc(options.topN), candidates.length))
    : candidates.length
  if (model.startsWith('local:')) {
    const modelId = model.slice('local:'.length).trim()
    if (modelId === '') throw new RerankExecutionError({ code: 'unsupported_model', message: 'local rerank model id is empty', retryable: false, action: 'check_config' })
    await withAbortSignal(assertLocalRerankerReady(modelId), options.signal)
    throwIfAborted(options.signal)
    const timeoutMs = remainingTimeoutMs(options)
    if (timeoutMs <= 0) throw new LocalRerankError('timeout', 'local rerank deadline expired before inference', true)
    const scores = await withAbortSignal(rerankInLocalProcess(
      modelId,
      localModelCacheDir(),
      getHfEndpoint(),
      safeQuery,
      safeTexts,
      timeoutMs,
      options.signal,
    ), options.signal)
    if (scores.length !== candidates.length
      || scores.some(score => !Number.isFinite(score) || score < 0 || score > 1)) {
      throw new RerankExecutionError({ code: 'invalid_response', message: 'local rerank did not return one score in [0, 1] per candidate', retryable: false, action: 'run_self_test' })
    }
    const out = new Map<string, number>()
    // Cherry's mergeRerankResults: only the top-N scored candidates survive.
    const ranked = candidates
      .map((candidate, i) => ({ id: candidate.id, score: scores[i]!, index: i }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, keep)
    for (const entry of ranked) out.set(entry.id, entry.score)
    return out
  }
  if (baseUrl.trim() === '') throw new RerankExecutionError({ code: 'provider_error', message: 'rerank base URL is empty', retryable: false, action: 'check_config' })
  const url = `${baseUrl.replace(/\/+$/, '')}/rerank`
  let response: Response
  try {
    response = await httpFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        query: safeQuery,
        documents: safeTexts,
        top_n: keep,
      }),
      timeoutMs: options.timeoutMs,
      ...(options.deadlineAt !== undefined ? { deadlineAt: options.deadlineAt } : {}),
      retries: options.retries,
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
  } catch (error) {
    // Preserve owner cancellation as cancellation (the auto path must neither
    // log nor commit state), while exposing an exhausted network budget as the
    // public `timeout` degradation code rather than an opaque provider error.
    throwIfAborted(options.signal)
    const message = error instanceof Error ? error.message : String(error)
    if (Date.now() >= options.deadlineAt || /\b(?:timeout|timed out)\b/i.test(message)) {
      throw new RerankExecutionError({
        code: 'timeout',
        message: 'Reranking service exceeded its time budget. Original retrieval order was preserved.',
        retryable: true,
        action: 'retry_later',
      }, undefined, message)
    }
    throw error
  }
  if (!response.ok) {
    // Carry the HTTP status so callers can distinguish a persistent
    // misconfiguration (401/403/404) from a transient blip.
    void response.body?.cancel().catch(() => {})
    throw new RerankExecutionError({
      code: 'provider_error',
      message: `Reranking request failed (HTTP ${response.status}). Original retrieval order was preserved.`,
      retryable: ![400, 401, 403, 404].includes(response.status),
      action: [400, 401, 403, 404].includes(response.status) ? 'check_config' : 'retry_later',
    }, response.status, `rerank request failed: HTTP ${response.status}`)
  }
  let json: unknown
  const bodyBudgetMs = remainingTimeoutMs(options)
  if (bodyBudgetMs <= 0) {
    throw remoteTimeoutError('rerank response body deadline expired before reading')
  }
  const bodyBudgetSignal = AbortSignal.timeout(bodyBudgetMs)
  const bodySignal = options.signal !== undefined
    ? AbortSignal.any([options.signal, bodyBudgetSignal])
    : bodyBudgetSignal
  try {
    json = await withAbortSignal(response.json(), bodySignal)
  } catch (error) {
    // Rejecting the caller-side race does not stop the underlying stream.
    // Cancel it explicitly so a stalled provider cannot retain a socket/body
    // after the shared deadline has already expired.
    void response.body?.cancel().catch(() => {})
    throwIfAborted(options.signal)
    if (bodyBudgetSignal.aborted || Date.now() >= options.deadlineAt) {
      throw remoteTimeoutError(error instanceof Error ? error.message : String(error))
    }
    throw new RerankExecutionError(
      { code: 'invalid_response', message: 'rerank provider returned invalid JSON', retryable: false, action: 'check_config' },
      response.status,
      error instanceof Error ? error.message : String(error),
    )
  }
  if (!isRecord(json) || !Array.isArray(json.results)) {
    throw new RerankExecutionError({ code: 'invalid_response', message: 'rerank provider response must contain a results array', retryable: false, action: 'check_config' })
  }
  if (json.results.length !== keep) {
    throw new RerankExecutionError({
      code: 'invalid_response',
      message: `rerank provider returned ${json.results.length} results, expected ${keep}`,
      retryable: false,
      action: 'check_config',
    })
  }
  const scores = new Map<string, number>()
  for (const result of json.results) {
    if (!isRecord(result)) {
      throw new RerankExecutionError({ code: 'invalid_response', message: 'rerank provider returned a malformed result entry', retryable: false, action: 'check_config' })
    }
    const index = result.index
    const score = result.relevance_score
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= candidates.length
      || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
      throw new RerankExecutionError({ code: 'invalid_response', message: 'rerank provider returned an invalid index or score', retryable: false, action: 'check_config' })
    }
    const candidate = candidates[index]!
    if (scores.has(candidate.id)) throw new RerankExecutionError({ code: 'invalid_response', message: 'rerank provider returned duplicate candidate indexes', retryable: false, action: 'check_config' })
    scores.set(candidate.id, score)
  }
  return scores
}

function remoteTimeoutError(technicalMessage: string): RerankExecutionError {
  return new RerankExecutionError({
    code: 'timeout',
    message: 'Reranking service exceeded its time budget. Original retrieval order was preserved.',
    retryable: true,
    action: 'retry_later',
  }, undefined, technicalMessage)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeExecutionOptions(
  optionsOrTopN: RerankExecutionOptions | number | undefined,
  legacyTimeoutMs: number | undefined,
): Required<Pick<RerankExecutionOptions, 'timeoutMs' | 'deadlineAt' | 'retries'>> & RerankExecutionOptions {
  const raw = typeof optionsOrTopN === 'number'
    ? { topN: optionsOrTopN, ...(legacyTimeoutMs !== undefined ? { timeoutMs: legacyTimeoutMs } : {}) }
    : optionsOrTopN ?? (legacyTimeoutMs !== undefined ? { timeoutMs: legacyTimeoutMs } : {})
  const timeoutMs = finitePositiveInt(raw.timeoutMs, 60_000)
  const deadlineAt = raw.deadlineAt !== undefined && Number.isFinite(raw.deadlineAt)
    ? raw.deadlineAt
    : Date.now() + timeoutMs
  return {
    ...raw,
    ...(raw.topN !== undefined && Number.isFinite(raw.topN) ? { topN: Math.max(1, Math.trunc(raw.topN)) } : { topN: undefined }),
    timeoutMs,
    deadlineAt,
    retries: finiteNonNegativeInt(raw.retries, 1),
  }
}

function remainingTimeoutMs(options: RerankExecutionOptions & { timeoutMs: number }): number {
  if (options.deadlineAt === undefined) return options.timeoutMs
  return Math.min(options.timeoutMs, Math.ceil(options.deadlineAt - Date.now()))
}

function finitePositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.trunc(value))
}

function finiteNonNegativeInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return Math.trunc(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException('The operation was aborted', 'AbortError')
}

async function withAbortSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  throwIfAborted(signal)
  return await new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      if (signal.reason instanceof Error) reject(signal.reason)
      else reject(new DOMException('The operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
