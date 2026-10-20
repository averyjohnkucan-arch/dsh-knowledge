import React, { useEffect, useState } from 'react'
import type { KnowledgeApi } from './api.js'
import { style } from './theme.js'
export function EmbeddingPerformance({ api }: { api: KnowledgeApi }) {
  const [threads, setThreads] = useState(0), [instances, setInstances] = useState(0), [batch, setBatch] = useState(1)
  const [igpu, setIgpu] = useState(true), [gpu, setGpu] = useState(true)
  const [acceleration, setAcceleration] = useState<Awaited<ReturnType<KnowledgeApi['getEmbeddingAcceleration']>>>()
  useEffect(() => { const poll=()=>{void api.getEmbeddingAcceleration().then(setAcceleration).catch(()=>{})};poll();const timer=setInterval(poll,3000);return()=>clearInterval(timer) },[api])
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { void api.getConfig().then(c => { setIgpu(c.localEmbeddingIgpuIdle !== false); setGpu(c.localEmbeddingMainGpuIdle !== false); setThreads(c.localEmbeddingThreads ?? 0); setInstances(c.localEmbeddingInstances ?? 0); setBatch(c.localEmbeddingMicroBatchSize ?? 1) }).catch(e => setMessage(String(e))) }, [api])
  const save = async () => { setBusy(true); try { await api.setConfig({ localEmbeddingIgpuIdle: igpu, localEmbeddingMainGpuIdle: gpu, localEmbeddingThreads: threads, localEmbeddingInstances: instances, localEmbeddingMicroBatchSize: batch }); setMessage('Saved. The next embedding request applies these settings between batches.') } catch(e) { setMessage(String(e)) } finally { setBusy(false) } }
  return <section style={{ ...style.card, marginBottom: 16 }} aria-label="Embedding performance">
    <h3 style={{ marginTop: 0 }}>Embedding performance · CPU</h3>
    <p style={style.hint}>Automatic uses two independent eight-thread models on a machine with at least 16 logical CPUs and enough RAM. Smaller machines use fewer resources. Measured micro-batches of one avoid padding overhead. Models run in the plugin’s isolated process.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <label>Threads per instance (0 = automatic)<input type="number" min={0} max={64} value={threads} onChange={e => setThreads(Number(e.target.value))} style={style.input}/></label>
      <label>Instances (0 = automatic)<input type="number" min={0} max={4} value={instances} onChange={e => setInstances(Number(e.target.value))} style={style.input}/></label>
      <label>Texts per micro-batch<input type="number" min={1} max={8} value={batch} onChange={e => setBatch(Number(e.target.value))} style={style.input}/></label>
    </div>
    <p style={style.hint}>Total threads are bounded by the detected CPU count; automatic instance count also considers available RAM. Four instances can use around 5 GB for this model without outperforming two.</p>
    <button style={style.button} disabled={busy} onClick={() => void save()}>Save embedding performance</button>
    <h4>Optional OpenVINO embedding · NPU</h4>
    <p style={style.hint}>Installs a separate Qwen3 model export with matching CPU fallback. Select “Qwen3 Embedding 0.6B · OpenVINO CPU/NPU” in base settings after validation. Existing ONNX vectors cannot be mixed with this export; use a new or rebuilt base.</p>
    <button style={style.button} disabled={busy || acceleration?.status === 'installing'} onClick={() => { void api.prepareEmbeddingAcceleration().then(setAcceleration).catch(e=>setMessage(String(e))) }}>Download / validate CPU and NPU embedding</button>
    {acceleration && <p role="status" style={style.hint}>{acceleration.status} · {acceleration.message}</p>}
    {acceleration?.devices.map(d=><p key={d.device} style={style.hint}>{d.name ?? d.device}: {d.qualified ? `Validated · ${Math.round(d.medianMs ?? 0)} ms` : d.error ?? 'Unavailable'}</p>)}
    <label style={{display:'block'}}><input type="checkbox" checked={igpu} onChange={e=>setIgpu(e.target.checked)}/> Allow qualified Intel iGPU when desktop idle</label>
    <label style={{display:'block'}}><input type="checkbox" checked={gpu} onChange={e=>setGpu(e.target.checked)}/> Allow qualified main GPU when desktop idle and available</label>
    <p style={style.hint}>GPU workers require five minutes of verified desktop idle and a passing CPU comparison. Foreground model calls or renewed desktop activity stop new GPU jobs; the current job may finish for at most ten seconds before the worker is terminated. Interrupted work falls back to CPU.</p>
    {message && <p role="status" style={style.hint}>{message}</p>}
  </section>
}
