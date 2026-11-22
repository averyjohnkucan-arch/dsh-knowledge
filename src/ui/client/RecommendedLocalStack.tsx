import { useEffect, useState } from 'react'
import type { LocalSetup, SearchPreferences } from '../../shared/local-setup.js'
import type { KnowledgeApi } from './api.js'
import { HarnessModelSelect, useHarnessModels } from './HarnessModelSelect.js'
import { C, style } from './theme.js'

export const RECOMMENDED_LOCAL = {
  embeddingProvider: 'local' as const, embeddingModel: 'dsh-local/Qwen3-Embedding-0.6B-Portable-FP16',
  embeddingDimensions: 0, rerankModel: 'local:Qwen/Qwen3-Reranker-0.6B', keepInternalMarkdown: true,
}

export function RecommendedLocalStack({ api }: { api: KnowledgeApi }) {
  const [state, setState] = useState<LocalSetup>()
  const catalog = useHarnessModels(api)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const fail = (e: Error) => { if (live) setError(e.message) }
    void api.localSetup().then(value => { if (live) setState(value) }).catch(fail)
    void api.getConfig().then(config => { if (live) setActive(config.embeddingModel === RECOMMENDED_LOCAL.embeddingModel) }).catch(fail)
    return () => { live = false }
  }, [api])
  useEffect(() => {
    if (state?.setup.status !== 'running') return
    let live = true
    const timer = setInterval(() => {
      void api.localSetup().then(value => {
        if (!live) return
        setState(value)
        if (value.setup.status === 'ready') setActive(true)
      }).catch(e => { if (live) setError(String(e)) })
    }, 900)
    return () => { live = false; clearInterval(timer) }
  }, [api, state?.setup.status])

  async function update(patch?: Partial<SearchPreferences>) {
    setBusy(true); setError('')
    try {
      const next = patch ? await api.configureLocalSetup(patch) : await api.startLocalSetup()
      setState(next)
      if (!patch && next.setup.status === 'ready') setActive(true)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const settings = state?.settings
  const ready = state?.setup.status === 'ready' && active
  const running = state?.setup.status === 'running'
  return <section style={{ ...style.card, marginBottom: 16 }} aria-label="Knowledge setup">
    <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Local search</h3>
    <p style={style.hint}>Qwen3 Embedding 0.6B and Qwen3 Reranker 0.6B</p>
    {ready ? <p role="status">Ready · {state?.setup.device}</p>
      : <button style={style.button} disabled={busy || running || !state} onClick={() => void update()}>
        {running ? 'Setting up…' : state?.setup.status === 'error' ? 'Retry setup' : 'Set up local search'}
      </button>}
    {state && !ready && <ol aria-label="Setup steps" style={{ ...style.hint, paddingLeft: 22 }}>
      {state.steps.map((step, i) => <li key={step} style={{color: running && i === state.setup.step ? C.text : C.muted}}>
        {step}{running && i < state.setup.step ? ' ✓' : ''}{running && i === state.setup.step ? ' …' : ''}
      </li>)}
    </ol>}
    {running && state?.setup.progress && <progress aria-label="Download progress" value={state.setup.progress.received} max={state.setup.progress.total} />}
    {(error || state?.setup.error) && <p role="alert" style={{color:C.danger}}>{error || state?.setup.error}</p>}
    {settings && <>
      {(['ocrModel', 'descriptionModel'] as const).map(key => <label key={key} style={style.field}>
        <span style={style.label}>{key === 'ocrModel' ? 'OCR model' : 'Image and chart descriptions'}</span>
        <HarnessModelSelect catalog={catalog} label={key === 'ocrModel' ? 'OCR model' : 'Image and chart descriptions'}
          empty={key === 'ocrModel' ? 'Built-in text extraction' : 'Off'} value={settings[key]} disabled={busy}
          onChange={id => void update({ [key]: id })} />
      </label>)}
      <details><summary style={{cursor:'pointer'}}>Hardware and scheduling</summary>
        <fieldset disabled={busy} style={{border:0, padding:'10px 0'}}>
          <label style={style.field}><span style={style.label}>Embedding device</span>
            <select style={style.input} value={settings.device} onChange={e => void update({ device:e.target.value as SearchPreferences['device'] })}>
              {Object.entries({auto:'Automatic',cpu:'CPU',npu:'NPU',igpu:'Integrated GPU',gpu:'GPU'}).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label style={style.field}><span style={style.label}>Index documents</span>
            <select style={style.input} value={settings.schedule} onChange={e => void update({ schedule:e.target.value as SearchPreferences['schedule'] })}>
              {Object.entries({background:'When chat is idle',always:'Any time',window:'During a time window',paused:'Paused'}).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {settings.schedule === 'window' && (['windowStart','windowEnd'] as const).map(key => <label key={key} style={style.field}>
            <span style={style.label}>{key === 'windowStart' ? 'Start time' : 'End time'}</span>
            <input type="time" style={style.input} defaultValue={settings[key]} onBlur={e => { if (e.target.value !== settings[key]) void update({[key]:e.target.value}) }} />
          </label>)}
          {([['threads','CPU threads (0 = automatic)',64],['quietSeconds','Wait after chat (seconds)',3600],['unloadSeconds','Unload idle models after (seconds, 0 = keep loaded)',86400]] as const).map(([key,label,max]) =>
            <label key={key} style={style.field}><span style={style.label}>{label}</span>
              <input type="number" min={0} max={max} style={style.input} defaultValue={settings[key]} onBlur={e => {
                if (e.target.value === '' || !e.target.validity.valid) { e.target.value = String(settings[key]); return }
                if (e.target.valueAsNumber !== settings[key]) void update({ [key]:e.target.valueAsNumber })
              }} />
            </label>)}
        </fieldset>
      </details>
    </>}
  </section>
}
