export class EmbeddingQueueTimeout extends Error {
  constructor() { super('Embedding query exceeded its queue wait budget'); this.name = 'EmbeddingQueueTimeout' }
}
/** Coalesce concurrent vector requests into bounded batches, preserving order. */
export class EmbeddingBatcher {
  private queue: Array<{ text: string; priority: 'query'|'index'; timer?: ReturnType<typeof setTimeout>; resolve: (value: { vector: number[]; elapsedMs: number }) => void; reject: (error: Error) => void }> = []
  private timer?: ReturnType<typeof setTimeout>
  private running = false
  private enabled = true
  constructor(private execute: (texts: string[]) => Promise<{ vectors: number[][]; elapsedMs: number }>, private maxBatch = 16) {}
  request(text: string, priority: 'query'|'index' = 'index', maxQueueWaitMs?: number): Promise<{ vector: number[]; elapsedMs: number }> {
    if (!this.enabled) return Promise.reject(new Error('Embedding device yielded'))
    return new Promise((resolve, reject) => {
      const job: (typeof this.queue)[number] = { text, priority, resolve, reject }
      if (maxQueueWaitMs !== undefined) job.timer = setTimeout(() => {
        const index = this.queue.indexOf(job)
        if (index < 0) return
        this.queue.splice(index, 1)
        reject(new EmbeddingQueueTimeout())
      }, maxQueueWaitMs)
      const firstBulk = priority === 'query' ? this.queue.findIndex(item => item.priority === 'index') : -1
      if (firstBulk < 0) this.queue.push(job); else this.queue.splice(firstBulk, 0, job)
      this.arm()
    })
  }
  resume(): void { this.enabled = true }
  pause(): void {
    this.enabled = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    for (const job of this.queue.splice(0)) { clearTimeout(job.timer); job.reject(new Error('Embedding device yielded')) }
  }
  private arm(): void {
    if (this.timer || this.running || !this.enabled || !this.queue.length) return
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush() }, 3)
  }
  private async flush(): Promise<void> {
    if (!this.enabled || this.running) return
    this.running = true
    // Bound both rows and approximate characters. Exact tokenizer validation
    // stays in the worker; very long passages run alone.
    const batch: typeof this.queue = []
    const firstLength = this.queue[0]?.text.length ?? 0
    const bucket = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, firstLength))))
    let longest = 0
    // Always service the oldest job, then collect similar lengths. Bound the
    // padded rectangle (longest × rows), not just the sum of input lengths.
    // Result promises retain caller order even when execution is regrouped.
    for (let i = 0; i < this.queue.length && batch.length < this.maxBatch;) {
      const job = this.queue[i], length = job.text.length
      const compatible = !batch.length || (length <= bucket && (bucket === 256 || length > bucket / 2))
      if (compatible && (!batch.length || Math.max(longest, length) * (batch.length + 1) <= 32768)) {
        this.queue.splice(i, 1); clearTimeout(job.timer); batch.push(job); longest = Math.max(longest, length)
      } else i++
    }
    try {
      const result = await this.execute(batch.map(job => job.text))
      if (result.vectors.length !== batch.length) throw new Error('GPU embedding count mismatch')
      batch.forEach((job, i) => job.resolve({ vector: result.vectors[i], elapsedMs: result.elapsedMs / batch.length }))
    } catch (error) { batch.forEach(job => job.reject(error instanceof Error ? error : new Error(String(error)))) }
    finally { this.running = false; this.arm() }
  }
}
