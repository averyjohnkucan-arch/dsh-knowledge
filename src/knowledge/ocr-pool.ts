import { availableParallelism, freemem } from 'node:os'
import type { OcrAcceleration } from './ocr-acceleration.js'
import { OcrProcessClient } from './ocr-process-client.js'
let acceleration: OcrAcceleration | undefined
export function useOcrAcceleration(value: OcrAcceleration | undefined): void { acceleration = value }

/** Each process owns its native sessions. Two 8-thread workers leave room for rendering and charts. */
export class OcrPool {
  private clients: OcrProcessClient[] = []
  private readonly cpuConcurrency = Math.max(1, Math.min(2, Math.floor(availableParallelism() / 8), Math.floor(freemem() / (1024 ** 3))))
  get concurrency(): number { return Math.max(this.cpuConcurrency, acceleration?.concurrency ?? 1) }
  async recognize(png: Buffer, modelDir: string): Promise<string> {
    const text = await acceleration?.recognize(png)
    if (text !== undefined) return text
    let client = this.clients.reduce<OcrProcessClient | undefined>((best, next) => !best || next.pendingCount < best.pendingCount ? next : best, undefined)
    if (!client || client.pendingCount > 0 && this.clients.length < this.cpuConcurrency) {
      client = new OcrProcessClient(); this.clients.push(client)
    }
    return client.recognize(png, modelDir)
  }
  async dispose(): Promise<void> {
    acceleration?.releaseWorkers()
    const clients = this.clients; this.clients = []
    await Promise.all(clients.map(client => client.dispose()))
  }
}
