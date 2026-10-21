import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { describe, expect, it } from 'vitest'
const source = await readFile(new URL('../src/ui/client/KnowledgeSection.tsx', import.meta.url), 'utf8')
const panel = source.slice(source.indexOf('function RecallPanel('), source.indexOf('\nfunction RecallResultCard('))
const code = (await transform(panel + '\nmodule.exports = RecallPanel', { loader: 'tsx', jsx: 'automatic', format: 'cjs' })).code
const module = { exports: undefined as unknown as (props: object) => unknown }
const jsx = (type: unknown, props: unknown) => ({ type, props })
runInNewContext(code, { module, require: () => ({ jsx, jsxs: jsx }), useState: (value: unknown) => [value, () => {}], C: {}, style: {}, IconSearch: 'search-icon', RecallResultCard: 'result-card' })
const props = { t: (value: string) => value, busy: false, searchError: null, searchQuery: 'Pickle', hits: [{ chunkId: 'one', score: 0.9 }], searchMeta: { elapsedMs: 100, reranked: false }, history: [], onSearch() {}, onQueryChange() {}, onReplay() {}, onRemoveHistory() {}, onClearHistory() {} }
describe('Recall panel rendering', () => {
  it('renders returned results rather than the searching state', () => {
    const output = JSON.stringify(module.exports(props))
    expect(output).toContain('result-card'); expect(output).not.toContain('recallSearching')
  })
  it('shows searching only for an active Recall request', () => {
    const output = JSON.stringify(module.exports({ ...props, busy: true }))
    expect(output).toContain('recallSearching'); expect(output).not.toContain('result-card')
  })
  it('shows a failed request inside the panel after searching finishes', () => {
    const output = JSON.stringify(module.exports({ ...props, searchError: 'Search timed out' }))
    expect(output).toContain('Search timed out'); expect(output).toContain('alert'); expect(output).not.toContain('recallSearching')
  })
})
