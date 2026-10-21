/** Administrative progress and bounded failure summaries; never retain document content. */
export interface ProcessingFailure { documentId?: string; title: string; code?: string; message: string }
export interface ProcessingSnapshot {
  failures?: ProcessingFailure[]
  id: string
  baseId: string
  total: number
  completed: number
  processed: number
  skipped: number
  failed: number
  running: number
  queued: number
  discovering: boolean
  active: boolean
  etaSeconds: number | null
  perMinute: number | null
}
interface Run {
  failures: ProcessingFailure[]
  baseId: string; total: number; processed: number; skipped: number; failed: number
  running: number; discovering: boolean; active: boolean; startedAt: number; samples: number[]
}
export class ProcessingMeter {
  private runs = new Map<string, Run>()
  constructor(private clock: () => number = Date.now) {}
  start(id: string, baseId: string, discovering = false): void {
    // Keep only the latest settled run per base; active roots stay independent.
    for (const [key, run] of this.runs) if (run.baseId === baseId && !run.active) this.runs.delete(key)
    this.runs.set(id, { baseId, failures: [], total: 0, processed: 0, skipped: 0, failed: 0, running: 0, discovering, active: true, startedAt: this.clock(), samples: [] })
  }
  add(id: string, count = 1): void { const r = this.runs.get(id); if (r) r.total += count }
  discovered(id: string): void { const r = this.runs.get(id); if (r) r.discovering = false }
  begin(id: string): void { const r = this.runs.get(id); if (r) r.running++ }
  settle(id: string, outcome: 'processed' | 'skipped' | 'failed', failure?: ProcessingFailure): void {
    const r = this.runs.get(id); if (!r) return
    r.running = Math.max(0, r.running - 1); r[outcome]++
    if (outcome === 'failed' && failure && r.failures.length < 1000) r.failures.push({ ...failure, title: failure.title.slice(0, 1024), message: failure.message.slice(0, 4000) })
    const now = this.clock(); if (outcome !== 'skipped') r.samples.push(now); r.samples = r.samples.filter(t => t > now - 120_000)
  }
  finish(id: string): void { const r = this.runs.get(id); if (r) { r.active = false; r.discovering = false; r.running = 0 } }
  active(id: string): boolean { return this.runs.get(id)?.active === true }
  snapshots(): ProcessingSnapshot[] {
    const now = this.clock()
    return [...this.runs].map(([id, r]) => {
      r.samples = r.samples.filter(t => t > now - 120_000)
      const completed = r.processed + r.skipped + r.failed
      const total = Math.max(r.total, completed + r.running)
      const elapsed = Math.min(120_000, Math.max(0, now - r.startedAt))
      // Require at least ten seconds and two completions; a stalled window has no ETA.
      const perMinute = elapsed >= 10_000 && r.samples.length >= 2 ? r.samples.length * 60_000 / elapsed : null
      const remaining = Math.max(0, total - completed)
      return { id, baseId: r.baseId, failures: r.failures.map(failure => ({ ...failure })), total, completed, processed: r.processed, skipped: r.skipped, failed: r.failed,
        running: r.running, queued: r.active ? Math.max(0, remaining - r.running) : 0,
        discovering: r.discovering, active: r.active, perMinute,
        etaSeconds: r.active && !r.discovering && perMinute !== null ? Math.ceil(remaining * 60 / perMinute) : null }
    })
  }
}
