import { describe, expect, it } from 'vitest'
import { embeddingWindows, mergeWindowVectors } from '../src/knowledge/embedding-context.js'
describe('embedding context coverage', () => {
  it('keeps every character in order and bounds every window', async () => {
    const text = 'First paragraph.\n\n' + 'x '.repeat(400) + '😀 final evidence at the end.'
    const windows = await embeddingWindows(text, 64, async part => Array.from(part).length + 2)
    expect(windows.map(w => w.text).join('')).toBe(text)
    expect(windows.every(w => w.tokens <= 64)).toBe(true)
    expect(windows.at(-1)?.text).toContain('evidence')
  })
  it('normalizes a weighted representation of all windows', () => {
    expect(mergeWindowVectors([[1,0],[0,1]],[3,4])).toEqual([0.6,0.8])
  })
})
