import { describe, expect, it } from 'vitest'
import { chunkText, mergeSemanticSegments, normalizeText, refineChunksByTokenLimit, splitSemanticSegments } from '../src/knowledge/chunk.js'

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('', 800, 100)).toEqual([])
  })

  it('keeps short text as a single chunk', () => {
    expect(chunkText('hello world', 800, 100)).toEqual([{ text: 'hello world' }])
  })

  it('splits long text into bounded chunks', () => {
    const text = 'word '.repeat(1000) // 5000 chars
    const chunks = chunkText(text, 500, 50)
    expect(chunks.length).toBeGreaterThan(1)
    // chunkSize is a TOKEN budget (Cherry semantics): latin text ≈ 4 chars/token,
    // so each chunk carries at most ~500 tokens, i.e. ~2000 chars + slack.
    for (const chunk of chunks) {
      const tokens = Math.ceil(chunk.text.length / 4)
      expect(tokens).toBeLessThanOrEqual(550)
    }
  })

  it('never emits an empty chunk when the overlap lands in whitespace', () => {
    // Regression: windowBlock advances by `cut - overlap`; with a large overlap
    // the next window can start inside a run of whitespace, trim to '', and
    // previously entered the chunk list as an empty chunk.
    const text = 'a'.repeat(300) + ' '.repeat(300) + '\n' + ' '.repeat(300) + 'b'.repeat(300)
    const chunks = chunkText(text, 64, 63)
    expect(chunks.length).toBeGreaterThan(0)
    for (const chunk of chunks) expect(chunk.text.trim().length).toBeGreaterThan(0)
    expect(chunks.some(chunk => chunk.text.includes('a'))).toBe(true)
    expect(chunks.some(chunk => chunk.text.includes('b'))).toBe(true)
  })

  it('packs small paragraphs without removing their boundaries', () => {
    const text = 'first paragraph\n\nsecond paragraph\n\nthird paragraph'
    expect(chunkText(text, 800, 100).map(c => c.text)).toEqual([text])
  })

  it('tracks markdown heading paths', () => {
    const text = '# Intro\n\nhello world\n\n## Methods\n\nbody text here'
    const chunks = chunkText(text, 800, 100)
    const intro = chunks.find(c => c.text === 'hello world')
    const methods = chunks.find(c => c.text === 'body text here')
    expect(intro?.heading).toBe('Intro')
    expect(methods?.heading).toBe('Intro > Methods')
  })

  it('skips never-seen heading levels instead of emitting empty segments', () => {
    const text = '# Intro\n\n### Deep\n\nbody text here'
    const chunks = chunkText(text, 800, 100)
    const deep = chunks.find(c => c.text === 'body text here')
    expect(deep?.heading).toBe('Intro > Deep')
  })

  it('normalizes line endings', () => {
    expect(normalizeText('a\r\nb\r\n\r\nc')).toBe('a\nb\n\nc')
  })
})

describe('splitSemanticSegments', () => {
  it('splits into heading-aware paragraph segments without windowing', () => {
    const text = '# Intro\nfirst paragraph\n\nsecond paragraph\n\n## Deep\nbody text'
    const segments = splitSemanticSegments(text)
    expect(segments.length).toBe(3)
    expect(segments[0].text).toBe('first paragraph')
    expect(segments[0].heading).toBe('Intro')
    expect(segments[1].text).toBe('second paragraph')
    expect(segments[2].text).toBe('body text')
    expect(segments[2].heading).toBe('Intro > Deep')
  })
})

describe('semantic candidate packing', () => {
  it('groups short neighboring paragraphs without crossing headings or fences', () => {
    const text = '# First\nShort first paragraph.\n\nRelated second paragraph.\n\n```js\nrun()\n```\n\n# Second\nA different section.'
    const candidates = splitSemanticSegments(text, { candidateTokens: 128 })
    expect(candidates).toHaveLength(3)
    expect(candidates[0].text).toContain('Short first paragraph.\n\nRelated second paragraph.')
    expect(candidates[0].heading).toBe('First')
    expect(candidates[1].text).toContain('```js')
    expect(candidates[2].heading).toBe('Second')
    expect(splitSemanticSegments(text, { candidateTokens: 0 })).toHaveLength(4)
  })
})

describe('mergeSemanticSegments', () => {
  it('merges similar adjacent segments up to the size bound', () => {
    const segments = [
      { text: 'a'.repeat(100) },
      { text: 'b'.repeat(100) },
      { text: 'c'.repeat(100) },
      { text: 'd'.repeat(200) },
    ]
    // All vectors identical → all merge until size; then the size bound cuts.
    // `size` is a TOKEN budget: 502 latin chars ≈ 126 tokens, so a budget of
    // 60 tokens ≈ 239 chars → 'a\nb' (201) fits, +'c' (302) does not.
    const vectors = segments.map(() => [1, 0, 0])
    const merged = mergeSemanticSegments(segments, vectors, 60)
    expect(merged.length).toBe(3)
    expect(merged[0].text.length).toBe(202)
    // Merged vector is the length-weighted mean, still normalized.
    expect(merged[0].embedding?.[0]).toBeCloseTo(1, 5)
  })

  it('cuts where adjacent segments are dissimilar', () => {
    const segments = [
      { text: 'alpha' },
      { text: 'beta' },
      { text: 'gamma' },
    ]
    const vectors = [
      [1, 0, 0],
      [0, 1, 0], // orthogonal to alpha → below threshold → cut
      [0.1, 0.9, 0], // close to beta → merges with it
    ]
    const merged = mergeSemanticSegments(segments, vectors, 1000, 0.5)
    expect(merged.length).toBe(2)
    expect(merged[0].text).toBe('alpha')
    expect(merged[1].text).toBe('beta\n\ngamma')
  })

  it('keeps the first segment\'s heading on a merged chunk', () => {
    const segments = [
      { text: 'one', heading: 'Top' },
      { text: 'two', heading: 'Top' },
    ]
    const merged = mergeSemanticSegments(segments, [[1, 0], [1, 0]], 1000)
    expect(merged.length).toBe(1)
    expect(merged[0].text).toBe('one\n\ntwo')
    expect(merged[0].heading).toBe('Top')
  })

  it('never merges across headings or fenced code, even when vectors are identical', () => {
    const segments = [{ text: 'one', heading: 'First' }, { text: 'two', heading: 'Second' },
      { text: '```js\nrun()\n```', heading: 'Second' }, { text: 'three', heading: 'Second' }]
    expect(mergeSemanticSegments(segments, segments.map(() => [1, 0]), 1000)).toHaveLength(4)
  })

  it('pools three or more segments using the exact length-weighted sum', () => {
    const segments = [{ text: 'aa' }, { text: 'bbbb' }, { text: 'cccccc' }]
    const vectors = [[1, 0], [0, 1], [1, 0]]
    const merged = mergeSemanticSegments(segments, vectors, 1000, 0)
    const norm = Math.hypot(8, 4)
    expect(merged).toHaveLength(1)
    expect(merged[0].embedding![0]).toBeCloseTo(8 / norm, 10)
    expect(merged[0].embedding![1]).toBeCloseTo(4 / norm, 10)
  })

  it('does not publish an incomplete pooled vector when one segment has no vector', () => {
    const merged = mergeSemanticSegments([{ text: 'one' }, { text: 'two' }], [[1, 0], undefined], 1000)
    expect(merged).toHaveLength(1)
    expect(merged[0].embedding).toBeUndefined()
  })

  it('handles missing vectors by merging on size only', () => {
    const segments = [{ text: 'x'.repeat(200) }, { text: 'y'.repeat(200) }]
    // 401 latin chars ≈ 100 tokens; the 64-token floor → ~252 chars budget,
    // so 200 fits but 200+200 does not.
    const merged = mergeSemanticSegments(segments, [undefined, undefined], 20)
    expect(merged.length).toBe(2)
    expect(merged[0].embedding).toBeUndefined()
  })
})

describe('code-fence protection', () => {
  it('keeps a fenced code block intact across blank lines and headings', () => {
    const text = '# Intro\nparagraph one\n\n```python\n# not a heading\n\ndef f():\n    pass\n\n```\nparagraph two'
    const chunks = chunkText(text, 800, 100)
    const code = chunks.find(chunk => chunk.text.includes('def f()'))
    expect(code).toBeDefined()
    expect(code!.text).toContain('# not a heading')
    expect(code!.text).toContain('pass')
    // The fence body stays in ONE block (blank lines inside did not split it).
    const fenceChunks = chunks.filter(chunk => chunk.text.includes('```'))
    expect(fenceChunks).toHaveLength(1)
  })

  it('treats code blocks as one segment for semantic chunking', () => {
    const text = 'before\n\n```\nline1\n\nline2\n```\n\nafter'
    const segments = splitSemanticSegments(text)
    expect(segments.length).toBe(3)
    expect(segments[1].text).toContain('line1')
    expect(segments[1].text).toContain('line2')
  })
})

describe('refineChunksByTokenLimit', () => {
  const estimate = (text: string): number => Math.ceil(text.length / 2)

  it('splits oversized chunks at preferred boundaries recursively', () => {
    const chunk = { text: 'a'.repeat(40) + '。' + 'b'.repeat(40) + '。' + 'c'.repeat(40) }
    const refined = refineChunksByTokenLimit([chunk], 30, estimate)
    expect(refined.length).toBeGreaterThan(1)
    for (const piece of refined) expect(estimate(piece.text)).toBeLessThanOrEqual(30)
    // Joined back, the content is preserved.
    expect(refined.map(piece => piece.text).join('')).toBe(chunk.text)
  })

  it('keeps pieces without a boundary whole instead of mid-word cutting', () => {
    const chunk = { text: 'x'.repeat(200) }
    const refined = refineChunksByTokenLimit([chunk], 50, estimate)
    expect(refined).toEqual([chunk])
  })

  it('is a no-op when the limit is 0', () => {
    const chunk = { text: 'y'.repeat(1000) }
    expect(refineChunksByTokenLimit([chunk], 0, estimate)).toEqual([chunk])
  })

  it('propagates the heading to every refined piece', () => {
    const chunk = { text: 'a'.repeat(40) + '。' + 'b'.repeat(40), heading: 'Top > Deep' }
    const refined = refineChunksByTokenLimit([chunk], 30, estimate)
    expect(refined.length).toBe(2)
    for (const piece of refined) expect(piece.heading).toBe('Top > Deep')
  })
})


describe('compact smart chunking', () => {
  it('packs list items but never crosses a heading', () => {
    const section = Array.from({ length: 40 }, (_, i) => `Character ${i}: a brief description.`).join('\n\n')
    const chunks = chunkText(`# Cast\n${section}\n\n# Plot\nA separate section.`, 400, 40)
    expect(chunks.length).toBeLessThan(6)
    expect(chunks.at(-1)?.heading).toBe('Plot')
    expect(chunks.filter(c => c.heading === 'Cast').map(c => c.text).join('\n\n')).toBe(section)
    expect(chunks.every(c => c.text.length <= 1600)).toBe(true)
  })
})
