import { knowledgeGpuAdmission } from './background-gpu.js'
import { MIN_OCR_AGREEMENT, ocrTextAgreement } from './ocr-quality.js'
import { stopOwnedProcess } from './owned-process.js'
import { ensurePrivatePython } from './private-python.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism, freemem } from 'node:os'
import { desktopIdle } from './resource-policy.js'
import { registerBackgroundDevices, backgroundDevicePids, IntelEmbeddingAvailability, nvidiaEmbeddingAvailability } from './embedding-device-availability.js'
import { createHash } from 'node:crypto'
import { localModelCacheDir } from './embed.js'
import { StructureProcess } from './structure-process.js'

interface Device { device: string; name: string; qualified: boolean; medianMs?: number; error?: string; enabled?: boolean; pending?: number; completed?: number }
export interface OcrAccelerationStatus { status: 'not_installed' | 'installing' | 'ready' | 'error'; message: string; devices: Device[] }
interface Lane { device: Device; process: StructureProcess; pending: number; tail: Promise<unknown>; samples: number[]; runs: number; failed: boolean; enabled: boolean; current?: Promise<unknown>; retryAt?: number; completed?: number; lastAssigned?: number }
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
export function ocrDeviceWorkActive(foreground: number, usedAt: number, pending: number, now = Date.now()): boolean {
  return foreground === 0 && (now - usedAt < 300_000 || pending > 0)
}
export function acceleratorEnvironment(root: string): NodeJS.ProcessEnv {
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
  if (process.platform === 'linux') {
    const libraries = join(root, 'intel/usr/lib/x86_64-linux-gnu')
    return { ...env, LD_LIBRARY_PATH: [libraries, join(libraries, 'intel-opencl'), join(root, 'intel/usr/local/lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
      OCL_ICD_VENDORS: join(root, 'icd'), ZE_ENABLE_ALT_DRIVERS: join(libraries, 'libze_intel_npu.so.1') }
  }
  return env
}
/** Measured shortest-work queue across explicit devices; a failed device falls back to the existing CPU engine. */
export class OcrAcceleration {
  private lanes: Lane[] = []
  private excludedDevices: Device[] = []
  private loadedRoot?: string
  private modelHash?: string
  private cudaQualifiedHash?: string
  private cudaQualification?: Promise<void>
  private state?: OcrAccelerationStatus
  private preparation?: Promise<void>
  private setupChild?: ChildProcess
  private stopped = false
  private igpuReservations = 0; private foreground = 0
  private usedAt = 0
  private polling = false
  private timer?: ReturnType<typeof setInterval>
  private readonly intelAvailability = new IntelEmbeddingAvailability()
  private unregisterDevices = registerBackgroundDevices(() => this.lanes.map(lane => lane.process.pid))
  private gpuRetryAt = 0
  private gpuWorkers = 8
  configure(options: { localOcrGpuWorkers?: number } = {}): void { this.gpuWorkers = Math.max(1, Math.min(8, options.localOcrGpuWorkers ?? 8)) }
  private gpuPython(): string { return join(localModelCacheDir(), 'embedding-gpu-runtime', 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }
  private makeLane(device: Device): Lane {
    const cuda = device.device.startsWith('CUDA')
    const env = acceleratorEnvironment(this.root())
    if (cuda) { delete env.CUDA_VISIBLE_DEVICES; delete env.OCL_ICD_VENDORS }
    env.OMP_NUM_THREADS = '8'; env.OPENBLAS_NUM_THREADS = '1'
    return { device: { ...device }, process: new StructureProcess(cuda ? this.gpuPython() : this.python(),
      cuda ? [script('ocr-cuda-worker.py'), '--models', join(localModelCacheDir(), 'ocr'), '--cache', join(this.root(), 'compiled')]
      : [script('ocr-accelerator-worker.py'), '--worker', '--models', join(localModelCacheDir(), 'ocr'), '--cache', join(this.root(), 'compiled'), '--device', device.device, '--threads', '8'],
      env, 'DSH_OCR_RESULT '), pending: 0, tail: Promise.resolve(), samples: [], runs: 0, failed: false, enabled: !device.device.startsWith('GPU') && (!this.foreground || device.device === 'CPU' && !this.lanes.some(lane => lane.device.device === 'CPU')) }
  }
  private async stopLane(lane: Lane): Promise<void> {
    lane.enabled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([lane.current ?? Promise.resolve(), new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000) })]).catch(() => {}) }
    finally { if (timer) clearTimeout(timer); await lane.process.stopAndWait() }
  }
  async enterForeground(yieldIgpu = false): Promise<() => void> {
    this.foreground++; if(yieldIgpu)this.igpuReservations++
    const cpu = this.lanes.filter(lane => lane.device.device === 'CPU')
    try { await Promise.all(this.lanes.filter(lane => lane.device.device !== 'CPU' || cpu.includes(lane) && lane !== cpu[0]).map(lane => this.stopLane(lane))) }
    catch (error) { this.foreground--; if(yieldIgpu)this.igpuReservations--; throw error }
    let released = false
    return () => { if (!released) { released = true; this.foreground--; if(yieldIgpu)this.igpuReservations--; if (!this.foreground) for (const lane of this.lanes.filter(lane=>!lane.failed&&(lane.device.device==='CPU'||lane.device.device.startsWith('NPU')))) lane.enabled = true } }
  }
  private async balanceCpu(): Promise<void> {
    const cpu = this.lanes.filter(lane => lane.device.device === 'CPU')
    const gpuHeavy = this.lanes.filter(lane => lane.device.device.startsWith('CUDA') && lane.enabled && !lane.failed).length >= 4
    await Promise.all(cpu.slice(1).map(async lane => {
      if (this.foreground || gpuHeavy) { if (lane.enabled) await this.stopLane(lane) }
      else if (!lane.failed) lane.enabled = true
    }))
  }
  async yieldMainGpu(): Promise<void> {
    await Promise.all(this.lanes.filter(lane => lane.device.device.startsWith('CUDA')).map(lane => this.stopLane(lane)))
  }
  private async updateDevices(): Promise<void> {
    if (this.stopped || this.polling || !this.loadedRoot) return
    this.polling = true
    try {
      // Keep models warm across PDF rendering / structure gaps; foreground still wins.
      const pending = this.lanes.reduce((sum, lane) => sum + lane.pending, 0)
      const active = ocrDeviceWorkActive(0, this.usedAt, pending)
      // Keep short rendering gaps warm, but do not strand multiple OCR model
      // copies in VRAM while structure/embedding needs the same device.
      const yieldIdleCuda = pending === 0 && Date.now() - this.usedAt >= 10_000 && knowledgeGpuAdmission.hasOtherDemand(this)
      const idle = process.platform === 'linux' ? true : (await desktopIdle()).idleSeconds! >= 300
      const owned = () => backgroundDevicePids(new Set(this.lanes.flatMap(lane => lane.process.pid ? [lane.process.pid] : [])))
      const intel = active && idle ? await this.intelAvailability.sample(owned()) : { available: false }
      knowledgeGpuAdmission.request(this, !this.foreground && active && this.lanes.some(lane=>lane.pending>0))
      const nvidia: Awaited<ReturnType<typeof nvidiaEmbeddingAvailability>> = active && idle && knowledgeGpuAdmission.allowed ? await nvidiaEmbeddingAvailability(owned) : { available: false, reason: 'OCR is idle or foreground inference is active' }
      if (this.stopped || this.foreground || this.igpuReservations) intel.available = false
      if (this.stopped || this.foreground || yieldIdleCuda) nvidia.available = false
      // Reserve headroom; each additional CUDA process can retain two model
      // arenas plus a context. Existing workers already count against free VRAM.
      const resident = this.lanes.filter(lane => lane.device.device.startsWith('CUDA') && lane.process.pid !== undefined).length
      const target = Math.min(this.gpuWorkers, resident + Math.floor(Math.max(0, (nvidia.freeMiB ?? 0) - 2048) / 2048))
      for (const lane of this.lanes.filter(lane => /^GPU|^CUDA/.test(lane.device.device))) {
        if (lane.device.device.startsWith('CUDA') && lane.failed && (lane.retryAt ?? Infinity) <= Date.now()) { lane.failed = false; lane.device.qualified = false }
        const available = lane.device.device.startsWith('CUDA') ? nvidia.available && Number(lane.device.device.split(':')[1]) < this.gpuWorkers : intel.available
        if (!available && lane.enabled) await this.stopLane(lane)
        else if (available && !lane.failed) lane.enabled = true
      }
      if (nvidia.available && target > 0 && Date.now() >= this.gpuRetryAt && !this.lanes.some(lane => lane.device.device === `CUDA:${target - 1}`)) {
        // A missing optional runtime is retried only after explicit setup/reload.
        try { await readFile(join(localModelCacheDir(), 'embedding-gpu-runtime', 'venv', process.platform === 'win32' ? 'pyvenv.cfg' : 'pyvenv.cfg')) }
        catch { this.gpuRetryAt = Date.now() + 60_000; return }
        if (this.stopped || this.foreground) return
        for (let i = 0; i < target; i++) {
          if (!this.lanes.some(lane => lane.device.device === `CUDA:${i}`)) this.lanes.push(this.makeLane({ device: `CUDA:${i}`, name: `NVIDIA OCR worker ${i + 1}`, qualified: false, medianMs: 100 }))
        }
        for (const lane of this.lanes.filter(lane => lane.device.device.startsWith('CUDA'))) lane.enabled = Number(lane.device.device.split(':')[1]) < this.gpuWorkers
      }
      await this.balanceCpu()
    } finally { this.polling = false }
  }
  root(): string { return join(localModelCacheDir(), 'ocr-accelerators') }
  python(): string { return join(this.root(), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }
  get concurrency(): number { return Math.max(1, this.lanes.filter(lane => !lane.failed && lane.enabled).length) }
  async status(): Promise<OcrAccelerationStatus> {
    if (this.state) return this.state
    if (this.loadedRoot === this.root()) return { status: 'ready', message: 'Calibrated local OCR devices', devices: [...this.lanes.map(lane => ({ ...lane.device, qualified: lane.device.qualified && !lane.failed, enabled: lane.enabled && !lane.failed, pending: lane.pending, completed: lane.completed ?? 0 })), ...this.excludedDevices] }
    this.releaseWorkers()
    try {
      const receipt = JSON.parse(await readFile(join(this.root(), 'ready.json'), 'utf8'))
      if (receipt.schema !== 1 || !Array.isArray(receipt.devices)) throw new Error('Invalid acceleration receipt')
      const digest = createHash('sha256')
      for (const name of ['ppocrv5_det.onnx', 'ppocrv5_rec.onnx', 'ppocrv5_dict.txt']) digest.update(await readFile(join(localModelCacheDir(), 'ocr', name)))
      if (digest.digest('hex') !== receipt.modelHash) throw new Error('OCR weights changed; recalibration required')
      this.modelHash = receipt.modelHash
      for (const device of receipt.devices as Device[]) {
        if (/^NPU(?:\.\d+)?$/.test(device.device)) {
          this.excludedDevices.push({ ...device, qualified: false, enabled: false, error: 'Full-page NPU OCR failed scanned-page fidelity checks. NPU layout and embeddings use separate qualification.' })
          continue
        }
        if (!device.qualified || !Number.isFinite(device.medianMs) || device.medianMs! <= 0) continue
        if (!(device.device === 'CPU' || /^NPU(?:\.\d+)?$/.test(device.device) || /^GPU(?:\.\d+)?$/.test(device.device) && /intel/i.test(device.name))) continue
        const copies = device.device === 'CPU' ? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 8), Math.floor(freemem() / (1024 ** 3)))) : 1
        for (let i = 0; i < copies; i++) this.lanes.push(this.makeLane(device))
      }
      if (!this.lanes.some(lane => lane.device.device === 'CPU')) throw new Error('No qualified CPU fallback')
      this.loadedRoot = this.root()
      return { status: 'ready', message: 'OCR first; CPU plus available Intel/NVIDIA GPUs. Foreground inference reserves GPUs and limits OCR to eight CPU threads.', devices: [...this.lanes.map(lane => lane.device), ...this.excludedDevices] }
    } catch { this.releaseWorkers(); return { status: 'not_installed', message: 'Using the standard CPU OCR engine. Download and calibrate optional acceleration to use Intel devices.', devices: [] } }
  }
  async recognize(png: Buffer): Promise<string | undefined> {
    if (this.stopped || (await this.status()).status !== 'ready') return undefined
    this.usedAt = Date.now()
    if (!this.timer) { this.timer = setInterval(() => { void this.updateDevices().catch(() => {}) }, 1000); this.timer.unref?.() }
    let lane: Lane | undefined
    while (!lane) {
      if(this.stopped)return undefined
      const healthy=this.lanes.filter(lane=>!lane.failed&&lane.enabled&&(lane.retryAt??0)<=Date.now())
      if(!healthy.length)return undefined
      const accelerators=healthy.filter(lane=>lane.device.device!=='CPU')
      // One CPU session also consumes pages while accelerators work. Keep the
      // remaining cores available for rendering, parsing and device dispatch.
      const pool=accelerators.length?[...accelerators,...healthy.filter(lane=>lane.device.device==='CPU').slice(0,1)]:healthy
      const choices=pool.filter(lane=>lane.pending < 1).sort((a,b)=>{
        // Prefer idle accelerators, then let CPU take independent queued work.
        if ((a.device.device==='CPU') !== (b.device.device==='CPU')) return a.device.device==='CPU'?1:-1
        // Keep each idle accelerator fed. Timing-only ranking can starve an
        // NPU forever when CUDA workers repeatedly become available first.
        if ((a.pending===0)!==(b.pending===0)) return a.pending===0?-1:1
        if (a.pending===0 && b.pending===0) return (a.lastAssigned??0)-(b.lastAssigned??0) || a.device.medianMs!-b.device.medianMs!
        return (a.pending+1)*a.device.medianMs!-(b.pending+1)*b.device.medianMs!
      })
      lane=choices[0]
      // Busy is not failure. Backpressure avoids spawning extra CPU fallback
      // workers alongside the foreground eight-thread CPU session.
      if(!lane)await new Promise(resolve=>setTimeout(resolve,5))
    }
    lane.pending++
    lane.lastAssigned=Date.now()
    const task = async (): Promise<string | undefined> => {
      try {
        if (this.stopped) return undefined
        if (lane.failed || !lane.enabled) return undefined
        const request = lane.process.request({ png: png.toString('base64') }, 300_000); lane.current = request
        const result = await request
        lane.completed = (lane.completed ?? 0) + 1
        if (typeof result.text !== 'string') throw new Error('Invalid OCR text response')
        if (lane.device.device.startsWith('CUDA') && !lane.device.qualified) {
          if (result.provider !== 'CUDAExecutionProvider') throw new Error('OCR CUDA provider was not verified')
          // Identical workers on the same CUDA device share one backend
          // comparison, but every process must verify its provider and weights.
          const shared = typeof result.modelHash === 'string' && result.modelHash === this.modelHash
          while (shared && this.cudaQualification) await this.cudaQualification
          if (shared && this.cudaQualifiedHash === this.modelHash) {
            lane.device.qualified = true; delete lane.device.error
          } else {
          let release: (() => void) | undefined
          const reservation = shared ? new Promise<void>(resolve => { release = resolve }) : undefined
          if (shared) this.cudaQualification = reservation
          try {
          const reference = this.lanes.filter(other => other.device.device === 'CPU' && !other.failed && other.enabled).sort((a,b)=>(a.pending+1)*a.device.medianMs!-(b.pending+1)*b.device.medianMs!)[0]
          if (!reference) throw new Error('No OCR CPU reference')
          // Serialize the comparison on the CPU lane; never overlap native sessions.
          reference.pending++
          const check = reference.tail.then(() => {
            if(this.stopped || !reference.enabled)throw new Error('OCR yielded before calibration')
            const request=reference.process.request({png:png.toString('base64')},300_000);reference.current=request;return request
          }).finally(()=>{reference.pending--})
          reference.tail = check.catch(() => {})
          const expected = await check
          reference.completed = (reference.completed ?? 0) + 1
          const agreement = ocrTextAgreement(String(expected.text ?? ''), String(result.text ?? ''))
          if (agreement < MIN_OCR_AGREEMENT) {
            // Retry this page on CPU. An ambiguous scan is not a broken device:
            // keep the lane recoverable and qualify again on a later page.
            lane.device.error = `OCR comparison ${Math.round(agreement * 100)}%; CPU used for this page; retrying GPU qualification after cooldown`
            lane.retryAt = Date.now() + 10_000
            lane.device.medianMs = typeof result.elapsedMs === 'number' ? result.elapsedMs : 100
            return String(expected.text ?? '')
          }
          lane.device.qualified = true
          if (shared && result.modelHash === this.modelHash && String(expected.text ?? '').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').length >= 32) this.cudaQualifiedHash = this.modelHash
          delete lane.device.error
          } finally { release?.(); if (this.cudaQualification === reservation) this.cudaQualification = undefined }
          }
        }
        if (lane.runs++ > 0 && typeof result.elapsedMs === 'number' && result.elapsedMs > 0) {
          lane.samples.push(result.elapsedMs); lane.samples = lane.samples.slice(-10)
          const sorted = [...lane.samples].sort((a, b) => a - b); lane.device.medianMs = sorted[Math.floor(sorted.length / 2)]
        }
        return result.text
      } catch (error) { if (lane.enabled) { lane.failed = true; lane.device.error = String(error).slice(-1000); if(lane.device.device.startsWith('CUDA'))lane.retryAt=Date.now()+60_000 }; lane.process.dispose(); return undefined }
      finally { lane.pending-- }
    }
    const result = lane.tail.then(task, task); lane.tail = result.catch(() => {})
    // Release this serialized lane before retrying another: CPU qualification
    // may itself be queued here, so retrying inside the tail can deadlock it.
    const text = await result
    return text === undefined && !this.stopped ? this.recognize(png) : text
  }
  private command(command: string, args: string[], timeout: number, env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' }); this.setupChild = child
      let log = ''
      const append = (data: Buffer) => { log = (log + data.toString()).slice(-4000); this.state = { status: 'installing', message: log, devices: [] } }
      child.stdout.on('data', append); child.stderr.on('data', append)
      const timer = setTimeout(() => { stopOwnedProcess(child); reject(new Error('OCR accelerator setup timed out')) }, timeout)
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('close', code => { clearTimeout(timer); if (this.setupChild === child) this.setupChild = undefined; code === 0 ? resolve() : reject(new Error(`OCR accelerator setup failed: ${log}`)) })
    })
  }
  async prepare(): Promise<OcrAccelerationStatus> {
    if (this.preparation) return this.status()
    if (this.stopped) throw new Error('Knowledge plugin is disabled')
    this.releaseWorkers(); await mkdir(this.root(), { recursive: true }); this.state = { status: 'installing', message: 'Installing private OCR acceleration runtime…', devices: [] }
    this.preparation = ensurePrivatePython(this.root(),(command,args,env)=>this.command(command,args,7_200_000,env))
      .then(python => this.command(python, [script('setup-ocr-accelerators.py'), this.root()], 7_200_000, { ...process.env, CUDA_VISIBLE_DEVICES: '' }))
      .then(() => this.command(this.python(), [script('ocr-accelerator-worker.py'), '--calibrate', '--models', join(localModelCacheDir(), 'ocr'), '--cache', join(this.root(), 'compiled'), '--output', join(this.root(), 'ready.json')], 900_000, acceleratorEnvironment(this.root())))
      .then(async () => {
        if (process.platform === 'linux' || process.platform === 'win32') {
          try { await this.command(this.python(), [script('setup-ocr-gpu.py'), localModelCacheDir()], 7_200_000, acceleratorEnvironment(this.root())) }
          catch { /* CUDA is optional; calibrated CPU/Intel workers remain ready. */ }
        }
        this.gpuRetryAt = 0; this.state = undefined; await this.status()
      })
      .catch(error => { this.state = { status: 'error', message: error instanceof Error ? error.message : String(error), devices: [] } })
      .finally(() => { this.preparation = undefined })
    return this.state
  }
  releaseWorkers(): void { for (const lane of this.lanes) lane.process.dispose(); this.lanes = []; this.excludedDevices = []; this.loadedRoot = undefined; this.modelHash = undefined; this.cudaQualifiedHash = undefined; this.cudaQualification = undefined }
  dispose(): void { knowledgeGpuAdmission.request(this,false); this.stopped = true; if (this.timer) clearInterval(this.timer); this.unregisterDevices(); this.setupChild && stopOwnedProcess(this.setupChild); this.releaseWorkers() }
}
