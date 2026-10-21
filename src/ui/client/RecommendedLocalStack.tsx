import { EmbeddingPerformance } from './EmbeddingPerformance.js'
import { useEffect, useState } from 'react'
import type { KnowledgeApi } from './api.js'
import { C, style } from './theme.js'
export const RECOMMENDED_LOCAL = {
  embeddingProvider: 'local' as const, embeddingModel: 'onnx-community/Qwen3-Embedding-0.6B-ONNX',
  rerankModel: 'local:Xenova/bge-reranker-base', rerankBaseUrl: '', rerankApiKey: '',
  documentProcessorProvider: 'builtin' as const, ocrEnabled: true, structureV3Charts: true,
  imageCaptionProvider: 'paddle' as const, imageCaptionModel: 'PP-Chart2Table', localWorkerIdleTimeoutMs: 0, searchMode: 'hybrid' as const,
}
export function RecommendedLocalStack({ api }: { api: KnowledgeApi }) {
  const [status, setStatus] = useState({ status: 'checking', progress: 0, message: '', device: 'cpu' })
  const [ocrAcceleration, setOcrAcceleration] = useState<Awaited<ReturnType<KnowledgeApi['getOcrAcceleration']>> | null>(null)
  const [ocrWorkers, setOcrWorkers] = useState(2)
  useEffect(() => { void api.getConfig().then(config => setOcrWorkers(config.localOcrGpuWorkers ?? 2)).catch(() => {}) }, [api])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  useEffect(() => {
    let live = true
    const poll = () => { void api.getOcrAcceleration().then(s => { if (live) setOcrAcceleration(s) }).catch(() => {}); void api.getStructureStatus().then(s => { if (live) setStatus(s) }).catch(e => { if (live) setError(String(e)) }) }
    poll(); const timer = setInterval(poll, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [api])
  const install = async (all: boolean) => {
    setBusy(true); setError(''); setMessage('')
    try {
      if (all) await Promise.all([api.downloadLocalModel(RECOMMENDED_LOCAL.embeddingModel), api.downloadLocalModel('Xenova/bge-reranker-base'), api.downloadOcr()])
      if (all) setOcrAcceleration(await api.prepareOcrAcceleration())
      setStatus(await api.prepareStructure())
      setMessage(all ? 'Downloads started. Models become selectable after validation. Apply the recommended defaults when all are ready.' : 'Preparing PP-StructureV3 in an isolated CPU environment. You can leave this page open or return later.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const apply = async () => {
    setBusy(true); setError('')
    try {
      const models = await api.listLocalModels()
      if (status.status !== 'ready' || ![RECOMMENDED_LOCAL.embeddingModel, 'Xenova/bge-reranker-base'].every(id => models.some(m => m.id === id && m.status === 'ready'))) throw new Error('Finish downloading and validating the recommended models first.')
      await api.setConfig(RECOMMENDED_LOCAL)
      setMessage('Recommended defaults saved. Bases with their own overrides keep them. Existing documents may need rebuilding after a parser change.')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return <section style={{ ...style.card, marginBottom: 16 }} aria-label="Recommended local pipeline">
    <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Recommended local pipeline · CPU</h3>
    <p style={style.hint}>Qwen3 Embedding 0.6B · BGE Reranker Base · PaddleOCR v5 · PP-StructureV3 layout, tables and charts alongside the built-in PDF parser. Runs locally without NVIDIA GPU memory. Model weights download separately.</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
      <button style={style.button} disabled={busy || status.status === 'installing'} onClick={() => void install(true)}>Download recommended models</button>
      <button style={style.button} disabled={busy} onClick={() => void apply()}>Use recommended defaults</button>
    </div>
    <EmbeddingPerformance api={api}/>
    <h4 style={{ margin: '14px 0 6px' }}>OCR acceleration · CPU, NPU, Intel iGPU and NVIDIA</h4>
    <p style={style.hint}>Installs private inference libraries and calibrates available devices against known text. Uses measured queue times to distribute pages. Up to two NVIDIA workers help when the GPU is free. Foreground inference releases both GPUs and limits OCR to one eight-thread CPU worker; NPU work continues. Bulk parsing/OCR across all knowledge bases takes priority over vectorization. The standard CPU engine remains available as fallback.</p>
    <label style={{display:'block',marginBottom:8}}>Idle NVIDIA OCR workers <select value={ocrWorkers} onChange={event => { const count=Number(event.target.value);setOcrWorkers(count);void api.setConfig({localOcrGpuWorkers:count}).catch(error=>setError(String(error))) }} style={style.input}><option value={1}>1 worker</option><option value={2}>2 workers (recommended)</option></select></label>
    <button style={style.button} disabled={busy || ocrAcceleration?.status === 'installing'} onClick={() => { void api.prepareOcrAcceleration().then(setOcrAcceleration).catch(e => setError(String(e))) }}>Download / calibrate OCR acceleration</button>
    {ocrAcceleration?.devices.map(device => <div key={device.device} style={{ ...style.hint, marginTop: 6 }}>{device.name} · {device.qualified ? `Validated · ${Math.round(device.medianMs ?? 0)} ms per calibration page` : device.error ?? 'Unavailable'}</div>)}
    {ocrAcceleration?.status === 'installing' && <p role="status" style={style.hint}>Installing and calibrating OCR devices…</p>}
    {ocrAcceleration?.status === 'error' && <p role="alert" style={{ ...style.hint, color: C.danger }}>{ocrAcceleration.message}</p>}
    <h4 style={{ margin: '14px 0 6px' }}>PP-StructureV3 · layout, tables and charts</h4>
    <p style={style.hint}>Adds structured reading order and table/chart extraction to PDF parsing. Separate from the small OCR-only download. Setup includes isolated Python and CPU dependencies.</p>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
      <button style={style.button} disabled={busy || status.status === 'installing'} onClick={() => void install(false)}>{status.status === 'ready' ? 'Verify / repair PP-StructureV3' : 'Download PP-StructureV3'}</button>
      <span role="status" style={{ color: status.status === 'ready' ? C.success : C.muted }}>{status.status === 'installing' ? `Installing · ${status.progress}%` : status.status === 'ready' ? 'Ready · CPU' : status.status === 'error' ? 'Setup failed' : 'Not installed'}</span>
    </div>
    {status.status === 'installing' && <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto', fontSize: 11 }}>{status.message}</pre>}
    {(error || status.status === 'error') && <p role="alert" style={{ ...style.hint, color: C.danger }}>{error || status.message}</p>}
    {message && <p style={style.hint}>{message}</p>}
  </section>
}
