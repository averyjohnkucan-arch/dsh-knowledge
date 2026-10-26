import ocrIdentities from './ocr-model-identities.json'
import fp16Manifest from './qwen-fp16-manifest.json'
import openvinoManifest from './openvino-embedding-manifest.json'
import React, { useEffect, useState } from 'react'
import type { KnowledgeApi } from './api.js'
import { style } from './theme.js'
import { NumberSlider } from './NumberSlider.js'
import { SettingHelp } from './SettingHelp.js'
export function EmbeddingPerformance({ api }: { api: KnowledgeApi }) {
  const [threads, setThreads] = useState(0), [instances, setInstances] = useState(0), [batch, setBatch] = useState(1)
  const [igpu, setIgpu] = useState(true), [gpu, setGpu] = useState(true)
  const fp16Model = 'dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated'
  const [fp16, setFp16] = useState<Awaited<ReturnType<KnowledgeApi['getEmbeddingAcceleration']>>>()
  const [acceleration, setAcceleration] = useState<Awaited<ReturnType<KnowledgeApi['getEmbeddingAcceleration']>>>()
  useEffect(() => { const poll=()=>{void api.getEmbeddingAcceleration().then(setAcceleration).catch(()=>{});void api.getEmbeddingAcceleration(fp16Model).then(setFp16).catch(()=>{})};poll();const timer=setInterval(poll,3000);return()=>clearInterval(timer) },[api])
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { void api.getConfig().then(c => { setIgpu(c.localEmbeddingIgpuIdle !== false); setGpu(c.localEmbeddingMainGpuIdle !== false); setThreads(c.localEmbeddingThreads ?? 0); setInstances(c.localEmbeddingInstances ?? 0); setBatch(c.localEmbeddingMicroBatchSize ?? 1) }).catch(e => setMessage(String(e))) }, [api])
  const save = async () => { setBusy(true); try { await api.setConfig({ localEmbeddingIgpuIdle: igpu, localEmbeddingMainGpuIdle: gpu, localEmbeddingThreads: threads, localEmbeddingInstances: instances, localEmbeddingMicroBatchSize: batch }); setMessage('Saved. The next embedding request applies these settings between batches.') } catch(e) { setMessage(String(e)) } finally { setBusy(false) } }
  return <section style={{ ...style.card, marginBottom: 16 }} aria-label="Embedding performance">
    <h3 style={{ marginTop: 0 }}>Embedding performance · CPU</h3>
    <p style={style.hint}>Automatic uses two independent eight-thread models on a machine with at least 16 logical CPUs and enough RAM. Smaller machines use fewer resources. Qwen3 ONNX always uses one text per inference to preserve vector consistency; the micro-batch setting applies to other models. Models run in the plugin’s isolated process.</p>
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}><div>Threads per instance (0 = automatic)<SettingHelp label="Threads per instance (0 = automatic)" text={"CPU threads control how much processor parallelism each embedding worker can request. Zero uses automatic tuning. More threads may speed up large inputs, but also compete with foreground inference and can be slower once memory bandwidth is saturated.\n\nThe runtime bounds the total against available CPUs. This changes future requests without rebuilding existing vectors."} /></div><NumberSlider label="Threads per instance (0 = automatic)" min={0} max={64} step={1} value={threads} onChange={setThreads} /></div>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}><div>Instances (0 = automatic)<SettingHelp label="Instances (0 = automatic)" text={"Each instance loads an independent embedding worker. More instances can process independent chunks concurrently, but each adds model and runtime memory; zero lets automatic tuning choose based on CPU and memory availability.\n\nMore is not always faster. Keep this conservative if memory use or foreground responsiveness matters. Changes apply between embedding requests."} /></div><NumberSlider label="Instances (0 = automatic)" min={0} max={4} step={1} value={instances} onChange={setInstances} /></div>
      <div style={{ flex: '1 1 220px', minWidth: 0 }}><div>Texts per micro-batch<SettingHelp label="Texts per micro-batch" text={"A micro-batch is the group of texts processed inside one CPU worker invocation. It is separate from the larger indexing-request batch setting in base settings. Larger groups can improve throughput but need more memory.\n\nQwen3 ONNX uses one text per inference to keep its vector format consistent; this control applies to other compatible CPU models. Device-specific batching may impose a smaller limit."} /></div><NumberSlider label="Texts per micro-batch" min={1} max={8} step={1} value={batch} onChange={setBatch} /></div>
    </div>
    <p style={style.hint}>Total threads are bounded by the detected CPU count; automatic instance count also considers available RAM. Four instances can use around 5 GB for this model without outperforming two.</p>
    <button style={style.button} disabled={busy} onClick={() => void save()}>Save embedding performance</button>
    <h4>Recommended · Unified Qwen FP16 acceleration</h4>
    <details><summary>Exact model revisions and SHA-256 hashes</summary>{[fp16Manifest, openvinoManifest].map(manifest => <div key={manifest.repository} style={{overflowWrap:'anywhere'}}><p>{manifest.repository} @ <code>{manifest.revision}</code></p>{manifest.files.map(file => <p key={file.name}>{file.name}<br/><code>{file.sha256}</code></p>)}</div>)}</details>
    <p style={style.hint}>The same pinned FP16 export across CPU, Intel NPU/iGPU and optional NVIDIA CUDA. This is a separate vector format from Q8. Select this model in base settings after setup; existing vectors must be regenerated. Linux monitors device activity and reserves GPUs for foreground inference; other systems require verified desktop idle.</p>
    <button style={style.button} disabled={busy || fp16?.status === 'installing'} onClick={() => { void api.prepareEmbeddingAcceleration(fp16Model).then(setFp16).catch(e=>setMessage(String(e))) }}>Download / validate unified FP16 embedding</button>
    {fp16 && <p role="status" style={style.hint}>{fp16.status} · {fp16.message}</p>}
    {fp16?.devices.map(d=><p key={d.device} style={style.hint}>{d.name ?? d.device}: {d.qualified ? `Validated · ${Math.round(d.medianMs ?? 0)} ms` : d.error ?? 'Unavailable'}{d.maxTokens ? ` · NPU candidates up to ${d.maxTokens} tokens; longer inputs use CPU/GPU without truncation` : ''}{d.blockedReason ? ` · ${d.blockedReason}` : ''}</p>)}
    <details><summary>OCR, layout, table and chart model hashes from this setup</summary><p style={style.hint}>Exact installed artifact identities. Download and validate these through the OCR and PP-StructureV3 setup controls. These hashes identify the current setup and do not replace readiness checks.</p>{ocrIdentities.artifacts.map(file => <p key={file.name} style={{overflowWrap:'anywhere'}}>{file.name} · {(file.size/1048576).toFixed(1)} MiB<br/><code>{file.sha256}</code></p>)}</details>
    <h4>Optional OpenVINO embedding · NPU</h4>
    <p style={style.hint}>Installs a separate Qwen3 model export with matching CPU fallback. Select “Qwen3 Embedding 0.6B · OpenVINO CPU/NPU” in base settings after validation. Existing ONNX vectors cannot be mixed with this export; use a new or rebuilt base.</p>
    <button style={style.button} disabled={busy || acceleration?.status === 'installing'} onClick={() => { void api.prepareEmbeddingAcceleration().then(setAcceleration).catch(e=>setMessage(String(e))) }}>Download / validate CPU and NPU embedding</button>
    {acceleration && <p role="status" style={style.hint}>{acceleration.status} · {acceleration.message}</p>}
    {acceleration?.devices.map(d=><p key={d.device} style={style.hint}>{d.name ?? d.device}: {d.qualified ? `Validated · ${Math.round(d.medianMs ?? 0)} ms` : d.error ?? 'Unavailable'}</p>)}
    <label style={{display:'block'}}><input type="checkbox" checked={igpu} onChange={e=>setIgpu(e.target.checked)}/> Allow qualified Intel iGPU when available</label>
    <label style={{display:'block'}}><input type="checkbox" checked={gpu} onChange={e=>setGpu(e.target.checked)}/> Allow qualified NVIDIA GPU after inference models unload</label>
    <p style={style.hint}>CPU and NPU workers continue alongside available GPU workers. All GPU workers require a passing CPU comparison. Unified FP16 waits until other NVIDIA inference processes have unloaded and at least 4 GB of VRAM is free. It detects the unload rather than forcing a five-minute timer. Linux device activity monitoring protects foreground work; the older OpenVINO export and unsupported monitoring systems require five minutes of verified desktop idle. Foreground model calls or renewed desktop activity stop new GPU jobs; the current job may finish for at most ten seconds before the worker is terminated. Interrupted work falls back to CPU.</p>
    {message && <p role="status" style={style.hint}>{message}</p>}
  </section>
}
