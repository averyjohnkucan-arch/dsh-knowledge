import { isMetadataWriteFailure } from './metadata-write.js'
import { setTimeout as delay } from 'node:timers/promises'
import { AsyncLocalStorage } from 'node:async_hooks'

export const DOCUMENT_MAX_ATTEMPTS = 3
const runs = new AsyncLocalStorage<object>()
const exhausted = new WeakMap<object, object>()

export function markAttemptsExhausted<T extends object>(error: T): T {
  const run = runs.getStore()
  if (run) exhausted.set(error, run)
  return error
}

/** Nested processing stages must not multiply three attempts into nine. */
export function attemptsExhausted(error: unknown): boolean {
  const run = runs.getStore()
  return !!run && typeof error === 'object' && error !== null && exhausted.get(error) === run
}

export async function retryDocument<T>(operation: (attempt: number) => Promise<T>, options: {
  signal?: AbortSignal
  onRetry?: (attempt: number, error: unknown) => void | Promise<void>
} = {}): Promise<T> {
  if (!runs.getStore()) return runs.run({}, () => retryDocument(operation, options))
  for (let attempt = 1; ; attempt++) {
    options.signal?.throwIfAborted()
    try { return await operation(attempt) }
    catch (error) {
      options.signal?.throwIfAborted()
      const code = (error as { code?: string } | null)?.code
      // An uncertain remote submission must be reconciled, not submitted twice.
      if (isMetadataWriteFailure(error) || (error as { name?: string } | null)?.name === 'AbortError' || (error as { published?: boolean } | null)?.published ||
        ['submission_unknown', 'job_lost', 'recovery_limit_reached'].includes(code ?? '') || attemptsExhausted(error)) throw error
      if (attempt === DOCUMENT_MAX_ATTEMPTS) {
        if (typeof error === 'object' && error !== null) markAttemptsExhausted(error)
        throw error
      }
      await options.onRetry?.(attempt, error)
      await delay(1000 * 2 ** (attempt - 1), undefined, { signal: options.signal })
    }
  }
}
