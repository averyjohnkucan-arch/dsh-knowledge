import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtifactRepository } from '../src/knowledge/artifacts.js'
import { processDocumentFile } from '../src/knowledge/document-processing.js'
import { retryDocument } from '../src/knowledge/document-retry.js'
import type { KnowledgeConfig } from '../src/knowledge/types.js'

const parse = vi.hoisted(() => vi.fn())
vi.mock('../src/knowledge/parse.js', () => ({
  extensionOf: (name: string) => name.split('.').at(-1), parseDocumentBuffer: parse,
}))
beforeEach(() => { parse.mockReset() })
const config = { documentProcessorProvider: 'builtin', imageCaptionProvider: 'off' } as KnowledgeConfig
const input = () => ({ artifacts: new ArtifactRepository(), baseId: 'base', documentId: 'document',
  fileName: 'article.md', bytes: new TextEncoder().encode('source'), config })

describe('three attempts before a document fails', () => {
  it('keeps failures pending until the third attempt and recovers on that attempt', async () => {
    const file = input(), states: string[] = []
    parse.mockImplementation(async () => {
      const job = await file.artifacts.getJob('base', 'document')
      states.push(`${job?.state}:${job?.attempt}`)
      if (states.length < 3) throw new Error('temporary parser failure')
      return 'complete text'
    })
    expect((await processDocumentFile(file)).text).toBe('complete text')
    expect(states).toEqual(['running:1', 'running:2', 'running:3'])
    expect(await file.artifacts.getJob('base', 'document')).toMatchObject({ state: 'completed', attempt: 3 })
  })

  it('retains the final error after exactly three attempts, including nested import retries', { timeout: 15_000 }, async () => {
    const file = input()
    parse.mockRejectedValue(Object.assign(new Error('bad source'), { code: 'parse_failed' }))
    await expect(retryDocument(() => processDocumentFile(file))).rejects.toMatchObject({ code: 'parse_failed' })
    expect(parse).toHaveBeenCalledTimes(3)
    expect(await file.artifacts.getJob('base', 'document')).toMatchObject({ state: 'failed', attempt: 3, errorCode: 'parse_failed' })
    // A cached runtime may throw the same Error instance on a new manual run.
    await expect(processDocumentFile(file)).rejects.toMatchObject({ code: 'parse_failed' })
    expect(parse).toHaveBeenCalledTimes(6)
    // A manual retry is a fresh run, rather than a permanently rejected source.
    parse.mockResolvedValue('repaired source')
    await processDocumentFile(file)
    expect(await file.artifacts.getJob('base', 'document')).toMatchObject({ state: 'completed', attempt: 1 })
  })

  it('cancels backoff without another parser call or a failed row', async () => {
    const file = input(), controller = new AbortController()
    parse.mockRejectedValue(new Error('temporary failure'))
    const operation = processDocumentFile({ ...file, signal: controller.signal })
    const settled = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    while ((await file.artifacts.getJob('base', 'document'))?.progress.stage !== 'queued') await new Promise(resolve => setTimeout(resolve, 5))
    controller.abort()
    await settled
    expect(parse).toHaveBeenCalledTimes(1)
    expect(await file.artifacts.getJob('base', 'document')).toMatchObject({ state: 'canceled', attempt: 1 })
  })

  it('does not duplicate an uncertain external submission or label it failed', async () => {
    const file = input()
    parse.mockRejectedValue(Object.assign(new Error('unknown remote outcome'), { code: 'submission_unknown' }))
    await expect(processDocumentFile(file)).rejects.toMatchObject({ code: 'submission_unknown' })
    expect(parse).toHaveBeenCalledTimes(1)
    expect(await file.artifacts.getJob('base', 'document')).toMatchObject({ state: 'running', errorCode: 'submission_unknown' })
  })
})
