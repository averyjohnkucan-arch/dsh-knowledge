import { useEffect, useRef, useState } from 'react'
import type { DocumentSetup } from '../../shared/local-setup.js'
import type { KnowledgeApi } from './api.js'
import type { Translate } from './locales.js'
import { C, style } from './theme.js'

export function DocumentSetupSection({ api, id, t, configured, onReady }: {
  api: KnowledgeApi; id: string; t: Translate; configured: boolean; onReady: () => void
}): JSX.Element {
  const [state, setState] = useState<DocumentSetup>()
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const changed = useRef(!configured)
  const callback = useRef(onReady)
  callback.current = onReady
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    let live = true
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const next = await api.documentSetup(id)
        if (!live) return
        setState(next); setError('')
        if (next.status === 'running') changed.current = true
        if (next.status === 'ready' && changed.current) { changed.current = false; callback.current() }
        if (next.status === 'running') timer = setTimeout(() => void poll(), 1200)
      } catch (e) {
        if (live) { setError(e instanceof Error ? e.message : String(e)); timer = setTimeout(() => void poll(), 4000) }
      }
    }
    void poll()
    return () => { live = false; mounted.current = false; clearTimeout(timer) }
  }, [api, id, refresh])
  async function start() {
    changed.current = true; setSubmitting(true); setError('')
    try { const next = await api.startDocumentSetup(id); if (mounted.current) setState(next) }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (mounted.current) { setSubmitting(false); setRefresh(value => value + 1) } }
  }
  return <section style={{ marginBottom: 20 }} aria-label={t('documentSetupTitle')}>
    <h3 style={{ margin: '0 0 6px' }}>{t('documentSetupTitle')}</h3>
    <p style={style.hint}>{t('documentSetupHint')}</p>
    {state?.supported === false ? <p role="status">{t('documentSetupPlatform')}</p>
      : state?.status === 'ready' ? <p role="status">{t('documentSetupReady')} · OvisOCR2 {state.backend === 'ovis-bf16' ? 'BF16 (CUDA)' : 'GGUF'}</p>
      : <button type="button" style={style.button} disabled={!state || submitting || state.status === 'running'} onClick={() => void start()}>
        {state?.status === 'running' ? t('documentSetupRunning') : state?.status === 'error' ? t('documentSetupRetry') : t('documentSetupStart')}
      </button>}
    {state?.status === 'running' && <div role="status" style={style.hint}>{state.stage}
      {state.progress && <progress aria-label={t('documentSetupRunning')} style={{display:'block'}} value={state.progress.received} max={state.progress.total} />}
    </div>}
    {(error || state?.error) && <p role="alert" style={{color:C.danger}}>{error || state?.error}</p>}
  </section>
}
