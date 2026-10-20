import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'
import type { retrievalDefinition as Definition, retrievalRecord as Record } from '../src/ui/client/KnowledgeRetrieval.js'

const module = { exports: {} as { retrievalDefinition: typeof Definition; retrievalRecord: typeof Record; KnowledgeRetrieval: (props: unknown) => unknown } }
const code = (await transform(await readFile(new URL('../src/ui/client/KnowledgeRetrieval.tsx', import.meta.url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' })).code
const jsx = (type: unknown, props: unknown) => ({ type, props })
runInNewContext(code, { module, exports: module.exports, require: () => ({ jsx, jsxs: jsx }) })
const { retrievalDefinition, retrievalRecord, KnowledgeRetrieval } = module.exports
const render = (data: ReturnType<typeof Record>) => JSON.stringify(KnowledgeRetrieval({ node: { data } }))

describe('durable knowledge retrieval disclosure', () => {
  const event = { type: 'user/message', seq: 42, surfaceOp: 'append', data: {
    id: 'injection-1', source: { kind: 'dsh-knowledge', passageCount: 1 },
    content: [{ type: 'text', text: '[source: Library; docId=doc1; chunkId=chunk1; title=Test] Actual evidence <script>bad()</script>' }],
  } }
  it('claims only original knowledge injections and replays the exact supplied text', () => {
    expect(retrievalDefinition.match['user/message'](event)).toMatchObject({ id: 'injection-1', exclusive: true })
    expect(retrievalDefinition.match['user/message']({ ...event, surfaceOp: 'replace' })).toBeNull()
    expect(retrievalDefinition.match['user/message']({ ...event, data: { ...event.data, source: { kind: 'user' } } })).toBeNull()
    const location = { kind: 'step', step: 1 }
    const match = { event, location }
    const state = retrievalDefinition.start({}, match)
    expect(retrievalDefinition.buildViewNode({ key: 'k', id: 'i', start: match, state })).toMatchObject({ anchorSeq: 42, location, data: { count: 1, text: event.data.content[0].text } })
    const markup = render(state)
    expect(markup).toContain('Knowledge retrieved — ')
    expect(markup).toContain('/knowledge/documents/doc1/raw?inline=1')
    expect(markup).toContain('Actual evidence <script>bad()</script>')
    expect(markup).not.toContain('source: Library')
    expect(markup).not.toContain('docId=')
    expect(markup).not.toContain('Untrusted reference material')
    expect(markup).not.toContain('dangerouslySetInnerHTML')
    expect(markup).not.toContain('\"open\":true')
  })
  it('shows zero results and supports saved messages from before passage counts existed', () => {
    expect(render({ count: 0, text: 'No new passages supplied.' })).toContain('No new passages were supplied for this question.')
    expect(retrievalRecord({ ...event, data: { ...event.data, source: { kind: 'dsh-knowledge' } } }).count).toBe(1)
  })
})
