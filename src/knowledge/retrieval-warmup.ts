import { DEFAULT_LOCAL_MODEL, isLocalModelDownloaded, loadLocalModel, rerankLocal } from './embed.js'
import { listLocalModels, selfTestLocalModel } from './localModels.js'
import type { KnowledgeConfig } from './types.js'

/** Preload only selected, installed models. A warmup never downloads weights or
 * leases a GPU. Calls are coalesced while starting, and stop at plugin disposal. */
export class RetrievalWarmup {
  private readonly pending = new Map<string, Promise<void>>()
  private disposed = false

  constructor(private readonly warn: (message: string) => void) {}

  warm(configs: readonly Pick<KnowledgeConfig, 'embeddingProvider' | 'embeddingModel' | 'rerankModel'>[]): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const jobs: Promise<void>[] = []
    for (const model of new Set(configs.filter(config => config.embeddingProvider === 'local')
      .map(config => config.embeddingModel.trim() || DEFAULT_LOCAL_MODEL))) {
      jobs.push(this.start(`embedding:${model}`, async () => {
        if (await isLocalModelDownloaded(model) && !this.disposed) await loadLocalModel(model)
      }))
    }
    // The rerank process hosts one model. Prefer the global/first selected base
    // rather than repeatedly replacing it by preloading every catalog entry.
    const reranker = configs.find(config => config.rerankModel.startsWith('local:'))?.rerankModel.slice(6).trim()
    if (reranker) jobs.push(this.start(`rerank:${reranker}`, async () => {
      const model = (await listLocalModels()).find(entry => entry.id === reranker)
      if (this.disposed) return
      if (model?.status === 'ready') {
        // Exercise inference too, so the first real lookup does not pay for
        // native session initialization. This also marks the child warm.
        await rerankLocal(reranker, 'Where do stars appear?', ['Stars appear in the night sky.', 'A recipe for bread.'])
      } else if (model?.status === 'unhealthy' && model.health === 'unchecked') {
        await selfTestLocalModel(reranker)
      }
    }))
    return Promise.all(jobs).then(() => {})
  }

  private start(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key)
    if (existing) return existing
    const job = work().catch(error => {
      if (!this.disposed) this.warn(`${key} warmup failed: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { this.pending.delete(key) })
    this.pending.set(key, job)
    return job
  }

  dispose(): void { this.disposed = true }
}
