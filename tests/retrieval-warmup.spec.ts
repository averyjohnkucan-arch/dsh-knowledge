import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../src/knowledge/embed.js', () => ({
  DEFAULT_LOCAL_MODEL: 'default-embedder',
  isLocalModelDownloaded: vi.fn(async () => true),
  loadLocalModel: vi.fn(async () => {}),
  rerankLocal: vi.fn(async () => [0.9, 0.1]),
}))
vi.mock('../src/knowledge/localModels.js', () => ({
  listLocalModels: vi.fn(async () => [{ id: 'test/reranker', status: 'ready', health: 'healthy' }]),
  selfTestLocalModel: vi.fn(async () => ({})),
}))
import { isLocalModelDownloaded, loadLocalModel, rerankLocal } from '../src/knowledge/embed.js'
import { listLocalModels, selfTestLocalModel } from '../src/knowledge/localModels.js'
import { RetrievalWarmup } from '../src/knowledge/retrieval-warmup.js'

const config = { embeddingProvider: 'local' as const, embeddingModel: 'test/embedder', rerankModel: 'local:test/reranker' }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(isLocalModelDownloaded).mockResolvedValue(true) })

it('deduplicates concurrent startup/settings warmups and probes the configured reranker', async () => {
  const warmup = new RetrievalWarmup(vi.fn())
  await Promise.all([warmup.warm([config, config]), warmup.warm([config])])
  expect(loadLocalModel).toHaveBeenCalledExactlyOnceWith('test/embedder')
  expect(rerankLocal).toHaveBeenCalledOnce()
  expect(selfTestLocalModel).not.toHaveBeenCalled()
})

it('never starts remote or uninstalled models, or disabled rerankers', async () => {
  vi.mocked(isLocalModelDownloaded).mockResolvedValue(false)
  const warmup = new RetrievalWarmup(vi.fn())
  await warmup.warm([{ ...config, rerankModel: '' }, { ...config, embeddingProvider: 'none', rerankModel: 'remote/reranker' }])
  expect(loadLocalModel).not.toHaveBeenCalled()
  expect(rerankLocal).not.toHaveBeenCalled()
  expect(listLocalModels).not.toHaveBeenCalled()
})

it('does not resurrect workers when disposal happens during readiness checks', async () => {
  let ready!: (value: boolean) => void
  vi.mocked(isLocalModelDownloaded).mockReturnValueOnce(new Promise(resolve => { ready = resolve }))
  const warmup = new RetrievalWarmup(vi.fn())
  const pending = warmup.warm([config])
  warmup.dispose()
  ready(true)
  await pending
  expect(loadLocalModel).not.toHaveBeenCalled()
  expect(rerankLocal).not.toHaveBeenCalled()
})

it('degrades safely after a failed warmup and permits a later retry', async () => {
  const warn = vi.fn(), warmup = new RetrievalWarmup(warn)
  vi.mocked(loadLocalModel).mockRejectedValueOnce(new Error('worker failed'))
  await warmup.warm([config])
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('worker failed'))
  await warmup.warm([config])
  expect(loadLocalModel).toHaveBeenCalledTimes(2)
})

it('preloads one reranker rather than thrashing the single-model child', async () => {
  const warmup = new RetrievalWarmup(vi.fn())
  await warmup.warm([config, { ...config, rerankModel: 'local:another/reranker' }])
  expect(rerankLocal).toHaveBeenCalledOnce()
  expect(vi.mocked(rerankLocal).mock.calls[0][0]).toBe('test/reranker')
})
