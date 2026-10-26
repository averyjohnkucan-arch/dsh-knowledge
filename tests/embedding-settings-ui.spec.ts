import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { transform } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { Config, resolveConfig } from '../src/knowledge/config.js'
import * as dimensions from '../src/knowledge/embedding-dimensions.js'
import * as variants from '../src/knowledge/qwen-embedding-variants.js'
import { SETTINGS_HELP } from '../src/ui/client/settings-help.js'

type Element = { type: any; props: any }
const jsx = (type: any, props: any): Element => ({ type, props })
function children(node: any): Element[] {
  if (Array.isArray(node)) return node.flatMap(children)
  if (!node || typeof node !== 'object') return []
  return [node, ...children(node.props?.children)]
}
async function harness(file: string, dependencies: Record<string, unknown> = {}) {
  const state: any[] = []; let index = 0
  const react = {
    useState(initial: any) { const i = index++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], (next: any) => { state[i] = typeof next === 'function' ? next(state[i]) : next }] },
    useRef(initial: any) { const i = index++; state[i] ??= { current: initial }; return state[i] },
    useId() { return 'setting-help' }, useMemo(fn: () => any) { return fn() }, useEffect() {},
  }
  const module = { exports: {} as any }
  const code = (await transform(await readFile(new URL(`../src/ui/client/${file}`, import.meta.url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'cjs' })).code
  runInNewContext(code, { module, exports: module.exports, setTimeout, clearTimeout,
    window: { innerWidth: 500, innerHeight: 800 }, document: { body: {} },
    require(name: string) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (name === 'react-dom') return { createPortal: (node: any) => node }
      if (name === './theme.js') return { C: {}, style: {} }
      return dependencies[name] ?? {}
    },
  })
  return { exports: module.exports, render(name: string, props: any) { index = 0; return module.exports[name](props) } }
}

describe('embedding settings controls', () => {
  it('lets numeric drafts be cleared and typed, clamps on commit, and synchronizes slider edits', async () => {
    const h = await harness('NumberSlider.tsx'), onChange = vi.fn()
    const props = { label: 'Batch size', value: 32, min: 1, max: 512, step: 1, onChange }
    let tree = h.render('NumberSlider', props)
    const input = () => children(tree).find(n => n.props?.type === 'number')!
    input().props.onChange({ target: { value: '' } }); tree = h.render('NumberSlider', props)
    expect(input().props.value).toBe(''); input().props.onBlur(); expect(onChange).not.toHaveBeenCalled()
    input().props.onChange({ target: { value: '999' } }); tree = h.render('NumberSlider', props); input().props.onBlur()
    expect(onChange).toHaveBeenLastCalledWith(512)
    const range = children(tree).find(n => n.props?.type === 'range')!
    range.props.onChange({ target: { value: '64' } }); tree = h.render('NumberSlider', props)
    expect(input().props.value).toBe('64'); expect(onChange).toHaveBeenLastCalledWith(64)
    expect(h.exports.normalizeSliderValue('NaN', 0, 1, 0.01)).toBeUndefined()
    expect(h.exports.normalizeSliderValue('0.333', 0, 1, 0.01)).toBe(0.33)
  })
  it('opens paragraph help on focus/hover and dismisses with Escape', async () => {
    const h = await harness('SettingHelp.tsx')
    const props = { label: 'Vector dimensions', text: SETTINGS_HELP.dimensions }
    let tree = h.render('SettingHelp', props)
    let button = children(tree).find(n => n.type === 'button')!
    button.props.ref.current = { getBoundingClientRect: () => ({ left: 490, top: 700, bottom: 718 }) }
    button.props.onFocus(); tree = h.render('SettingHelp', props)
    const tooltip = children(tree).find(n => n.props?.role === 'tooltip')!
    expect(tooltip.props.id).toBe('setting-help')
    expect(tooltip.props.style.left).toBeLessThan(200)
    expect(children(tooltip).filter(n => n.type === 'p')).toHaveLength(2)
    button = children(tree).find(n => n.type === 'button')!
    expect(button.props['aria-describedby']).toBe('setting-help')
    button.props.onKeyDown({ key: 'Escape' }); tree = h.render('SettingHelp', props)
    expect(children(tree).some(n => n.props?.role === 'tooltip')).toBe(false)
    tree.props.onMouseEnter(); tree = h.render('SettingHelp', props)
    expect(children(tree).some(n => n.props?.role === 'tooltip')).toBe(true)
  })
  it('saves dimensions, batch size and result count, and resets width on a model switch', async () => {
    const h = await harness('rag-config.tsx', {
      '../../knowledge/embedding-dimensions.js': dimensions,
      '../../knowledge/qwen-embedding-variants.js': variants,
      './settings-help.js': { SETTINGS_HELP }, './NumberSlider.js': { NumberSlider: 'NumberSlider' },
      './SettingHelp.js': { SettingHelp: 'SettingHelp' },
    })
    const config = { ...resolveConfig(Config({} as Config), {}), embeddingProvider: 'local', embeddingModel: 'onnx-community/Qwen3-Embedding-0.6B-ONNX' }
    const api = { updateBase: vi.fn(async () => {}), probeEmbeddingDimensions: vi.fn(async () => 512) }
    const props = { base: { id: 'base', documentCount: 10, config: {} }, globalConfig: config, api, t: (key: string) => key, busy: false, onSaved: vi.fn() }
    let tree = h.render('RagConfigPanel', props)
    const slider = (label: string) => children(tree).find(n => n.type === 'NumberSlider' && n.props.label === label)!
    slider('Vector dimensions').props.onChange(512)
    tree = h.render('RagConfigPanel', props); slider('batchSize').props.onChange(64)
    tree = h.render('RagConfigPanel', props); slider('topK').props.onChange(12)
    tree = h.render('RagConfigPanel', props)
    children(tree).find(n => n.type === 'button' && n.props.children === 'save')!.props.onClick()
    await vi.waitFor(() => expect(api.updateBase).toHaveBeenCalledWith('base', { config: expect.objectContaining({ embeddingDimensions: 512, embeddingBatchSize: 64, topK: 12 }) }))
    expect(api.probeEmbeddingDimensions).toHaveBeenCalledWith(expect.objectContaining({ dimensions: 512 }))
    expect(children(tree).filter(n => n.props?.help).length).toBeGreaterThan(7)
    const provider = children(tree).find(n => n.type === 'select' && n.props.value === 'local')!
    provider.props.onChange({ target: { value: 'openai' } }); tree = h.render('RagConfigPanel', props)
    expect(slider('Vector dimensions').props.value).toBe(1024)
  })
})
