import { describe, expect, it } from 'vitest'
import { citationLinks, parseKnowledgeCitation } from '../src/shared/citations.js'
import { passageUrl } from '../src/knowledge/citation-source.js'
const chunk = { id: 'chunk', docId: 'doc', baseId: 'base', index: 0, text: 'verified evidence' }
describe('knowledge citation addresses', () => {
  it('accepts producer links but rejects external origins, traversal, and forged parameters', () => {
    for (const revision of [undefined, 'rev']) {
      const path = passageUrl('doc', chunk, revision)
      expect(parseKnowledgeCitation(path, 'http://localhost')).toBe(path)
      expect(parseKnowledgeCitation('http://localhost' + path, 'http://localhost')).toBe(path)
      expect(parseKnowledgeCitation('https://external.example' + path, 'http://localhost')).toBeUndefined()
      expect(parseKnowledgeCitation(path.replace('/doc/', '/../../doc/'), 'http://localhost')).toBeUndefined()
      expect(parseKnowledgeCitation(path.replace('&view=1', '&redirect=https://external.example'), 'http://localhost')).toBeUndefined()
    }
  })
  it('copies exact URLs and neutralizes Markdown in source labels', () => {
    const url = passageUrl('doc', chunk)
    const result = citationLinks({docId:'doc', documentTitle:'bad\n[title](javascript:alert)', indexedMarkdownUrl:url})
    expect(result).toContain(`](${url}) ([original](/knowledge/documents/doc/raw?inline=1))`)
    expect(result).not.toContain('\n')
    expect(citationLinks({docId:'doc',documentTitle:'Safe',indexedMarkdownUrl:'https://external.example'})).toBe('[Safe](/knowledge/documents/doc/raw?inline=1)')
  })
})
