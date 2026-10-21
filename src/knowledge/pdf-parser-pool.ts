import { Worker } from 'node:worker_threads'
import { availableParallelism, freemem } from 'node:os'
import { fileURLToPath } from 'node:url'
export interface NativePdfResult { text: string; pages?: string[]; scanned?: number[] }
interface Pending { resolve(value: NativePdfResult): void; reject(error: Error): void }
interface Lane { worker: Worker; pending: Map<number, Pending> }
/** Persistent independent pdf.js heaps; a crash/timeout affects only its own lane. */
export class PdfParserPool {
  private lanes: Lane[] = []
  private sequence = 0
  private stopped = false
  constructor(private readonly capacity = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4), Math.floor(freemem() / 1024 ** 3))),
    private readonly modulePath = fileURLToPath(new URL('./pdf-parse-worker.mjs', import.meta.url)), private readonly timeoutMs = 120_000) {}
  private fail(lane: Lane, error: Error): void {
    this.lanes = this.lanes.filter(other => other !== lane)
    for (const pending of lane.pending.values()) pending.reject(error)
    lane.pending.clear()
    void lane.worker.terminate()
  }
  private createLane(): Lane {
    const worker = new Worker(this.modulePath)
    const lane: Lane = { worker, pending: new Map() }
    worker.on('message', (message: NativePdfResult & { id?: number; ok?: boolean; error?: string }) => {
      const pending = message.id === undefined ? undefined : lane.pending.get(message.id)
      if (!pending) return
      lane.pending.delete(message.id!)
      if (message.ok) pending.resolve({text:message.text ?? '', pages:message.pages, scanned:message.scanned})
      else pending.reject(Error(message.error ?? 'pdf-parse worker failed'))
      if (!lane.pending.size) worker.unref()
    })
    worker.on('error', error => this.fail(lane, error))
    worker.on('exit', () => this.fail(lane, Error('pdf-parse worker exited')))
    worker.unref(); this.lanes.push(lane)
    return lane
  }
  parse(bytes: Uint8Array): Promise<NativePdfResult> {
    if (this.stopped) return Promise.reject(Object.assign(Error('PDF parser stopped'), {code:'plugin_stopped'}))
    let lane = this.lanes.reduce<Lane | undefined>((best, next) => !best || next.pending.size < best.pending.size ? next : best, undefined)
    if (!lane || lane.pending.size > 0 && this.lanes.length < this.capacity) lane = this.createLane()
    const selected = lane
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => this.fail(selected, Error('PDF parsing failed: pdf-parse timed out')), this.timeoutMs)
      timer.unref?.()
      selected.pending.set(id, {resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}})
      try {
        const data = Uint8Array.from(bytes)
        selected.worker.ref(); selected.worker.postMessage({id,data}, [data.buffer])
      } catch (error) {
        selected.pending.delete(id); clearTimeout(timer)
        if (!selected.pending.size) selected.worker.unref()
        reject(error instanceof Error ? error : Error(String(error)))
      }
    })
  }
  async dispose(): Promise<void> {
    this.stopped = true
    const lanes = this.lanes; this.lanes = []
    for (const lane of lanes) {
      for (const pending of lane.pending.values()) pending.reject(Object.assign(Error('PDF parser stopped'), {code:'plugin_stopped'}))
      lane.pending.clear()
    }
    await Promise.all(lanes.map(lane => lane.worker.terminate()))
  }
}
