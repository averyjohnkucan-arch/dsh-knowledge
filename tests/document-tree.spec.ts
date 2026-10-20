import { describe, expect, it } from 'vitest'
import { documentSubtreeIds } from '../src/ui/client/document-tree.js'
describe('large-library subtree selection', () => {
  it('handles 50,000 leaves and preserves their order without recursively rescanning them', () => {
    const docs = Array.from({ length: 50_000 }, (_, i) => ({ id: String(i), parentDirectoryId: 'root' }))
    const ids = documentSubtreeIds(docs, 'root')
    expect(ids).toHaveLength(50_001)
    expect(ids.slice(0, 3)).toEqual(['root', '0', '1'])
    expect(ids.at(-1)).toBe('49999')
  })
  it('handles deep and cyclic saved trees without stack overflow or duplicates', () => {
    const docs = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i), parentDirectoryId: String(i - 1) }))
    docs.push({ id: '0', parentDirectoryId: '9999' })
    expect(documentSubtreeIds(docs, '0')).toHaveLength(10_000)
  })
})
