/** Optional enrichment never competes with imports, vectorization or foreground inference. */
export class IdleEnrichment {
  private controller?: AbortController
  private idleSince = Date.now()
  private nextScan = 0
  private stopped = false
  constructor(private readonly busy: () => boolean, private readonly next: (signal: AbortSignal) => Promise<boolean>, private readonly idleMs = 30_000) {}
  interrupt(): void { this.idleSince = Date.now(); this.controller?.abort() }
  stop(): void { this.stopped = true; this.interrupt() }
  async tick(): Promise<void> {
    if (this.stopped) return
    if (this.busy()) { this.interrupt(); return }
    if (this.controller || Date.now() - this.idleSince < this.idleMs || Date.now() < this.nextScan) return
    const controller = new AbortController()
    this.controller = controller
    try { if (!await this.next(controller.signal)) this.nextScan = Date.now() + 30_000 }
    catch { this.nextScan = Date.now() + 30_000 }
    finally { if (this.controller === controller) this.controller = undefined }
  }
}
