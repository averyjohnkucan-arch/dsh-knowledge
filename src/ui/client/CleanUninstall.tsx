import { useState } from 'react'
import type { KnowledgeApi } from './api.js'
import type { Translate } from './locales.js'
import { C, style } from './theme.js'

export function CleanUninstall({ api, t }: {api: KnowledgeApi; t: Translate}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function uninstall() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api.cleanUninstall()
      try { window.localStorage.removeItem('dsh-knowledge:mineru-deployment-draft:v1') } catch { /* Browser storage is optional. */ }
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setBusy(false)
    }
  }
  return <section style={{marginTop:24, paddingTop:16, borderTop:`1px solid ${C.border}`}}>
    {!confirm && <button type="button" style={style.button} onClick={() => setConfirm(true)}>{t('cleanUninstall')}</button>}
    {confirm && <div role="group" aria-label={t('cleanUninstall')}>
      <p>{t('cleanUninstallScope')}</p>
      <button type="button" disabled={busy} style={style.button} onClick={() => { setConfirm(false); setError('') }}>{t('cancel')}</button>{' '}
      <button type="button" disabled={busy} style={style.button} onClick={() => void uninstall()}>{t(busy ? 'cleanUninstallBusy' : 'cleanUninstallConfirm')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>
}
