import { availableParallelism, freemem } from 'node:os'
import type { OcrAcceleration } from './ocr-acceleration.js'
import { OcrProcessClient } from './ocr-process-client.js'
let foreground = 0
let cpuRunning = 0
const waiters = new Set<() => void>()
const idleCpuWorkers = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4), Math.floor(freemem() / (1024 ** 3))))
const pools = new Set<OcrPool>()
export async function enterOcrPoolForeground(): Promise<() => void> {
  foreground++
  // Existing native calls finish before the foreground reservation is granted.
  const deadline = Date.now() + 10_000
  while (cpuRunning > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
  if (cpuRunning > 0) await Promise.all([...pools].map(pool => pool.stopFallbackWorkers()))
  let released = false
  return () => { if (!released) { released = true; foreground--; for (const wake of waiters) wake() } }
}
let acceleration: OcrAcceleration | undefined
export function useOcrAcceleration(value: OcrAcceleration | undefined): void { acceleration = value }

/** Four threads per CPU session; a shared gate caps foreground OCR to one session. */
export class OcrPool {
  constructor() { pools.add(this) }
  private clients: OcrProcessClient[] = []
  private readonly cpuConcurrency = idleCpuWorkers
  get concurrency(): number { return Math.max(this.cpuConcurrency, acceleration?.concurrency ?? 1) }
  async recognize(png: Buffer, modelDir: string): Promise<string> {
    const text = await acceleration?.recognize(png)
    if (text !== undefined) return text
    while (cpuRunning >= (foreground ? 1 : idleCpuWorkers)) {
      await new Promise<void>(resolve => { const wake = () => { waiters.delete(wake); resolve() }; waiters.add(wake) })
    }
    cpuRunning++
    try {
    let client = this.clients.reduce<OcrProcessClient | undefined>((best, next) => !best || next.pendingCount < best.pendingCount ? next : best, undefined)
    if (!client || client.pendingCount > 0 && this.clients.length < this.cpuConcurrency) {
      client = new OcrProcessClient(); this.clients.push(client)
    }
    return await client.recognize(png, modelDir)
    } finally { cpuRunning--; for (const wake of waiters) wake() }
  }
  async stopFallbackWorkers(): Promise<void> {
    const clients = this.clients; this.clients = []; await Promise.all(clients.map(client => client.dispose()))
  }
  async dispose(): Promise<void> {
    pools.delete(this)
    acceleration?.releaseWorkers()
    const clients = this.clients; this.clients = []
    await Promise.all(clients.map(client => client.dispose()))
  }
}
