/** Cooperative admission for all Knowledge CUDA workers. CPU/NPU work continues
 * while a chat owns the GPU; the shared scheduler owns model unloading. */
export interface BackgroundLease { signal: AbortSignal; release(): void }
export interface BackgroundDriver {
  key: string; name: string; gpu: number; priority: 'background'; fingerprint: string
  load(signal: AbortSignal): Promise<void>; unload(): Promise<void>
}
export interface BackgroundScheduler {
  acquire(driver: BackgroundDriver, signal?: AbortSignal): Promise<BackgroundLease>
  unload(key: string): Promise<unknown>
}
export class BackgroundGpuAdmission {
  private scheduler?: BackgroundScheduler
  private driver?: BackgroundDriver
  private demand = new Set<object>()
  private lease?: BackgroundLease
  private acquiring?: AbortController
  private timer?: ReturnType<typeof setInterval>
  private admitted = false
  private generation = 0
  private retryAt = 0
  get allowed(): boolean { return !this.scheduler || this.admitted }
  attach(scheduler: BackgroundScheduler, stop: () => Promise<void>): () => Promise<void> {
    this.scheduler = scheduler
    this.driver = {key:'knowledge:background',name:'Knowledge OCR and embeddings',gpu:0,priority:'background',fingerprint:'knowledge-background-v1',load:async()=>{this.admitted=true},unload:async()=>{this.admitted=false;await stop()}}
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref?.()
    this.tick()
    return async () => {
      this.admitted=false; this.generation++; clearInterval(this.timer); this.timer = undefined
      this.acquiring?.abort(); this.acquiring = undefined
      this.lease?.release(); this.lease = undefined
      try { await scheduler.unload('knowledge:background') } finally { this.scheduler = undefined; this.driver = undefined }
    }
  }
  hasOtherDemand(owner: object): boolean { return [...this.demand].some(value => value !== owner) }
  request(owner: object, active: boolean): void {
    if (active) this.demand.add(owner); else this.demand.delete(owner)
    // Do not block CPU work waiting for an interactive model to finish.
    if (!this.lease) this.tick()
  }
  private tick(): void {
    if (!this.scheduler || !this.driver) return
    // A short lease boundary lets a queued chat run without waiting for a large PDF.
    this.lease?.release(); this.lease = undefined
    if (!this.demand.size) { this.acquiring?.abort(); return }
    if (this.acquiring || Date.now() < this.retryAt) return
    const controller = new AbortController(), generation = this.generation
    this.acquiring = controller
    void this.scheduler.acquire(this.driver, controller.signal).then(lease => {
      if (generation !== this.generation || controller.signal.aborted || !this.demand.size) lease.release()
      else { this.lease = lease; lease.signal.addEventListener('abort', () => { this.admitted=false }, {once:true}) }
    }).catch(() => { this.retryAt = Date.now() + 2000 }).finally(() => {
      if (this.acquiring === controller) this.acquiring = undefined
    })
  }
}
export const knowledgeGpuAdmission = new BackgroundGpuAdmission()
