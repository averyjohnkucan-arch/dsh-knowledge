import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { embeddingDimensionSupport, embeddingDimensionTag, embeddingOutputDimensions, resizeEmbeddingVectors } from '../src/knowledge/embedding-dimensions.js'
import { Config, resolveConfigFor } from '../src/knowledge/config.js'
import { baseConfigSchema, configOverridesSchema } from '../src/knowledge/domain.js'
import { indexingSettingsFingerprint } from '../src/knowledge/indexing-settings.js'
import { embedTexts } from '../src/knowledge/embed.js'
import { KnowledgeService } from '../src/knowledge/index.js'
import { httpFetch } from '../src/knowledge/net.js'

vi.mock('../src/knowledge/net.js', async original => ({
  ...await original<object>(),
  httpFetch: vi.fn(async (_url: string, options: { body: string }) => {
    const { input } = JSON.parse(options.body) as { input: string[] }
    return new Response(JSON.stringify({ data: input.map(() => ({ embedding: Array.from({ length: 1024 }, (_, i) => (i % 13) + 1) })) }), { status: 200 })
  }),
}))
const model = 'onnx-community/Qwen3-Embedding-0.6B-ONNX'
const config = { embeddingProvider: 'openai', embeddingModel: model }
const contexts: Context[] = [], directories: string[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.clearAllMocks() })
async function mount() {
  const home = await mkdtemp(join(tmpdir(), 'knowledge-dimensions-')); directories.push(home); vi.stubEnv('DSH_HOME', home)
  const ctx = new Context(); contexts.push(ctx)
  ctx.provide('webServer', { register() { return () => {} } })
  await ctx.plugin(KnowledgeService, { ...Config({} as Config), ocrEnabled: false, structureV3Charts: false, imageCaptionProvider: 'off', resumeInterruptedOnStartup: false })
  return ctx.get('knowledge') as KnowledgeService
}

describe('embedding output dimensions', () => {
  it('supports Qwen variants, and preserves native identity and native vectors', () => {
    for (const id of [model, 'OpenVINO/Qwen3-Embedding-0.6B-int8-ov', 'dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated', 'qwen3-embedding:0.6b']) expect(embeddingDimensionSupport(id)).toEqual({ native: 1024, min: 32 })
    expect(embeddingDimensionTag(config)).toBe('')
    expect(embeddingDimensionTag({ ...config, embeddingDimensions: 1024 })).toBe('')
    expect(embeddingDimensionTag({ ...config, embeddingDimensions: 512 })).toBe(':dimensions-512')
    const vectors = [[1, 2, 3]]; expect(resizeEmbeddingVectors(vectors, 0)).toBe(vectors)
  })
  it('rejects unsupported widths/models and invalid projections', () => {
    for (const n of [-1, 31, 1025, 512.5, NaN]) expect(() => embeddingOutputDimensions({ ...config, embeddingDimensions: n })).toThrow()
    expect(() => embeddingOutputDimensions({ ...config, embeddingModel: 'Xenova/gte-small', embeddingDimensions: 128 })).toThrow(/native/)
    expect(() => resizeEmbeddingVectors([[0, 0]], 2)).toThrow(/zero/)
    expect(() => resizeEmbeddingVectors([[1]], 2)).toThrow(/requested/)
    const result = resizeEmbeddingVectors([[3, 4, 12]], 2)
    expect(result).toEqual([[0.6, 0.8]])
  })
  it('retains dimensions through durable schemas and per-base overrides', () => {
    for (const schema of [baseConfigSchema, configOverridesSchema]) {
      expect(schema.parse({ embeddingDimensions: 512 })).toEqual({ embeddingDimensions: 512 })
      expect(schema.safeParse({ embeddingDimensions: 512.5 }).success).toBe(false)
    }
    const defaults = Config({} as Config)
    const resolved = resolveConfigFor(defaults, { ...config, embeddingProvider: 'openai', embeddingDimensions: 512 }, { embeddingDimensions: 256 })
    expect(resolved.embeddingDimensions).toBe(256)
    expect(indexingSettingsFingerprint({ ...resolved, embeddingDimensions: 0 })).toBe(indexingSettingsFingerprint({ ...resolved, embeddingDimensions: 1024 }))
    expect(indexingSettingsFingerprint(resolved)).not.toBe(indexingSettingsFingerprint({ ...resolved, embeddingDimensions: 512 }))
  })
  it('projects document and query outputs identically through the real provider adapter', async () => {
    const doc = await embedTexts('openai', 'https://embedding.invalid', model, '', ['evidence'], undefined, 'index', 512)
    const query = await embedTexts('openai', 'https://embedding.invalid', model, '', ['question'], undefined, 'query', 512)
    expect(doc[0]).toHaveLength(512); expect(query).toEqual(doc)
    expect(doc[0].reduce((sum, n) => sum + n * n, 0)).toBeCloseTo(1, 10)
  })
  it('re-vectorizes from saved chunks, keeps boundaries, searches new width, and does not rebuild for tuning', async () => {
    const service = await mount()
    const base = await service.createBase({ name: 'dimension acceptance', config: { ...config, embeddingProvider: 'openai', embeddingBaseUrl: 'https://embedding.invalid', chunkSize: 64, chunkOverlap: 0 } })
    const doc = await service.addTextDocument({ baseId: base.id, title: 'Evidence', content: 'The chicken walks across the prairie. '.repeat(100) })
    await service.waitForIdle()
    const before = service.listChunks(doc.id)
    expect(before.length).toBeGreaterThan(3); expect(before[0].embedding).toHaveLength(1024)
    await service.renameBase(base.id, { config: { embeddingDimensions: 512 } })
    await service.waitForIdle()
    const after = service.listChunks(doc.id)
    expect(after.map(c => [c.id, c.text])).toEqual(before.map(c => [c.id, c.text]))
    expect(after.every(c => c.embedding?.length === 512 && c.embeddingModel?.endsWith(':dimensions-512'))).toBe(true)
    const result = await service.search({ baseId: base.id, query: 'chicken prairie', mode: 'vector', topK: 3 })
    expect(result.hits).toHaveLength(3)
    vi.mocked(httpFetch).mockClear()
    await service.renameBase(base.id, { config: { embeddingBatchSize: 64, topK: 4 } })
    await service.waitForIdle()
    expect(httpFetch).not.toHaveBeenCalled()
    await expect(service.renameBase(base.id, { config: { embeddingDimensions: 31 } })).rejects.toThrow(/32/)
    expect(service.getConfigFor(base.id).embeddingDimensions).toBe(512)
    await service.renameBase(base.id, { config: { embeddingDimensions: 0 } }); await service.waitForIdle()
    expect(service.listChunks(doc.id).every(c => c.embedding?.length === 1024 && !c.embeddingModel?.includes(':dimensions-'))).toBe(true)
  })
  it('searches several bases using each base width and honors an explicit scope', async () => {
    const service = await mount()
    const bases = []
    for (const width of [256, 512]) {
      const base = await service.createBase({ name: `width ${width}`, config: { ...config, embeddingProvider: 'openai', embeddingBaseUrl: 'https://embedding.invalid', embeddingDimensions: width } })
      bases.push(base)
      await service.addTextDocument({ baseId: base.id, title: `Evidence ${width}`, content: 'The chicken walks across the prairie.' })
    }
    const result = await service.search({ query: 'chicken prairie', mode: 'vector' })
    expect(new Set(result.hits.map(hit => hit.baseId))).toEqual(new Set(bases.map(base => base.id)))
    const scoped = await service.search({ query: 'chicken prairie', mode: 'vector', baseIds: [bases[1].id] })
    expect(scoped.hits.map(hit => hit.baseId)).toEqual([bases[1].id])
    expect((await service.search({ query: 'chicken prairie', mode: 'vector', baseIds: [] })).hits).toEqual([])
  })

  it('validates probes and global width changes before saving', async () => {
    const service = await mount()
    expect(await service.probeEmbeddingDimensions({ provider: 'local', model, dimensions: 256 })).toBe(256)
    await expect(service.probeEmbeddingDimensions({ provider: 'local', model, dimensions: 31 })).rejects.toThrow(/32/)
    await service.setConfig({ embeddingProvider: 'openai', embeddingBaseUrl: 'https://embedding.invalid', embeddingModel: model })
    const base = await service.createBase({ name: 'inherits dimensions' })
    const doc = await service.addTextDocument({ baseId: base.id, title: 'Global', content: 'Saved evidence for the global configuration.' })
    await service.setConfig({ embeddingDimensions: 256 }); await service.waitForIdle()
    expect(service.listChunks(doc.id)[0].embedding).toHaveLength(256)
    await expect(service.setConfig({ embeddingDimensions: 9999 })).rejects.toThrow()
    expect(service.getConfig().embeddingDimensions).toBe(256)
  })
})
