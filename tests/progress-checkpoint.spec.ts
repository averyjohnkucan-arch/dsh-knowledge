import { describe, expect, it, vi } from 'vitest'
import { ArtifactRepository } from '../src/knowledge/artifacts.js'
import { processDocumentFile } from '../src/knowledge/document-processing.js'
import { parsedTextDocument } from '../src/knowledge/parsed-document.js'
import type { KnowledgeConfig } from '../src/knowledge/types.js'
const extract = vi.hoisted(() => vi.fn())
vi.mock('../src/knowledge/mineru-local.js', () => ({ extractWithMineruLocal: extract }))

describe('processing progress checkpoints', () => {
  it('coalesces bursts but preserves remote recovery IDs, final state and every live UI update', async () => {
    const artifacts = new ArtifactRepository()
    const save = vi.spyOn(artifacts, 'saveJob')
    const progress = vi.fn()
    const bytes = new TextEncoder().encode('source')
    extract.mockImplementation(async (_bytes, _name, _config, options) => {
      options.onProgress({ stage: 'parsing', jobId: 'remote-1' })
      for (let i = 0; i < 1000; i++) options.onProgress({ stage: 'parsing', progress: i / 1000 })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(await artifacts.getJob('base', 'doc')).toMatchObject({ state: 'running', progress: { jobId: 'remote-1' } })
      return parsedTextDocument('full document', bytes, 'mineru-local', 'options')
    })
    const result = await processDocumentFile({ baseId: 'base', documentId: 'doc', fileName: 'scan.pdf', bytes, artifacts,
      config: { documentProcessorProvider: 'mineru-local', imageCaptionProvider: 'off' } as KnowledgeConfig, onProgress: progress })
    expect(result.text).toBe('full document')
    expect(progress.mock.calls.length).toBeGreaterThanOrEqual(1001)
    expect(save.mock.calls.length).toBeLessThanOrEqual(4)
    expect(await artifacts.getJob('base', 'doc')).toMatchObject({ state: 'completed' })
    expect(save.mock.calls.at(-2)?.[0].progress.jobId).toBe('remote-1')
  })
})
