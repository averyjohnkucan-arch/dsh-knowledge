import { setMaxListeners } from 'node:events'
import { AsyncLocalStorage } from 'node:async_hooks'

/** A FIFO shared by file-processing entry points in one service.
 * A queued cancellation removes only itself; an active task owns its signal. */
export class ProcessingQueue {
  private running = 0
  private readonly waiting: Array<() => void> = []
  constructor(private readonly concurrency = 2, private readonly limit = Infinity) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || limit < 0) throw new Error('Invalid processing queue capacity')
  }
  async run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    if (this.running >= this.concurrency) {
      if (this.waiting.length >= this.limit) throw Object.assign(new Error('document processor queue is full'), { code: 'busy' })
      await new Promise<void>((resolve, reject) => {
        const cancel = () => {
          const index = this.waiting.indexOf(start)
          if (index >= 0) this.waiting.splice(index, 1)
          signal.removeEventListener('abort', cancel)
          reject(signal.reason)
        }
        const start = () => { signal.removeEventListener('abort', cancel); this.running++; resolve() }
        this.waiting.push(start)
        signal.addEventListener('abort', cancel, { once: true })
      })
    } else this.running++
    try { signal.throwIfAborted(); return await task() }
    finally { this.running--; this.waiting.shift()?.() }
  }
}

/** Admit work BEFORE reading source bytes. Waiters retain paths/IDs, not PDFs.
 * Heavy files have their own gate so OCR cannot fill every lightweight slot.
 * Nested sync/reindex/import calls share their admission instead of deadlocking.
 * The parser itself waits for capacity; internal congestion is not a failure. */
export class DocumentAdmission {
  private readonly context = new AsyncLocalStorage<{ active: boolean; parsed?: () => void }>()
  private readonly files: ProcessingQueue
  private readonly heavy: ProcessingQueue
  private readonly buffered: ProcessingQueue
  private readonly stop = new AbortController()
  constructor(concurrency = 128, heavyConcurrency = 4) {
    // Many lightweight waiters share this owned lifecycle signal.
    setMaxListeners(0, this.stop.signal)
    this.files = new ProcessingQueue(concurrency)
    this.heavy = new ProcessingQueue(heavyConcurrency)
    this.buffered = new ProcessingQueue(Math.min(concurrency, heavyConcurrency * 4))
  }
  /** Release only the parsing admission. The bounded buffer retains ownership
   * until enrichment/publication finish, so slow downstream stages cannot OOM. */
  parsed(): void { this.context.getStore()?.parsed?.() }
  /** Saved text needs the global memory bound, but no PDF/OCR admission. */
  runReady<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.run('saved-text.txt', task, signal)
  }
  run<T>(fileName: string, task: () => Promise<T>, signal?: AbortSignal, heavy = false): Promise<T> {
    const combined = signal ? AbortSignal.any([signal, this.stop.signal]) : this.stop.signal
    combined.throwIfAborted()
    if (this.context.getStore()?.active) return task()
    const admitted = (parsed?: () => void) => this.files.run(async () => {
      const lease = { active: true, parsed }
      try { return await this.context.run(lease, task) }
      finally { lease.active = false }
    }, combined)
    if (!heavy && /\.(?:md|markdown|txt|csv|json|html?|xml)$/i.test(fileName)) return admitted()
    return this.buffered.run(async () => {
      let result!: Promise<T>
      await this.heavy.run(async () => {
        let parsed!: () => void
        const ready = new Promise<void>(resolve => { parsed = resolve })
        result = admitted(parsed)
        await Promise.race([ready, result.then(() => {}, () => {})])
      }, combined)
      return result
    }, combined)
  }
  close(): void { this.stop.abort() }
}
