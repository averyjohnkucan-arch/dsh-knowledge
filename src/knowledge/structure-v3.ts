import { knowledgeGpuAdmission } from './background-gpu.js'
import { acceleratorEnvironment } from './ocr-acceleration.js'
import { registerBackgroundDevices, backgroundDevicePids, IntelEmbeddingAvailability, nvidiaEmbeddingAvailability } from './embedding-device-availability.js'
import { enterStructureCpuWork } from './structure-cpu-budget.js'
import { availableParallelism, freemem } from 'node:os'
import { ProcessingQueue } from './processing-queue.js'
import { stopOwnedProcess } from './owned-process.js'
import { ensurePrivatePython } from './private-python.js'
import { StructureProcess } from './structure-process.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { localModelCacheDir } from './embed.js'
import { parsedTextDocument } from './parsed-document.js'
import { extractHtmlToMarkdown } from './parse.js'
import type { ParsedBlock, ProcessingOutput } from './processing-types.js'

export interface StructureStatus { status: 'not_downloaded' | 'installing' | 'ready' | 'error'; progress: number; message: string; device: 'cpu'; activity?: { activeDocuments: number; foreground: boolean; devices: { device: string; active: number; pages: number; requests: number; seconds: number }[] } }
interface StructureLane { process: StructureProcess; busy: boolean; device: string; disabled?: boolean; initialized?: boolean; current?: Promise<unknown> }
const isCuda = (device: string) => device === 'CUDA' || device === 'CUDA:1'
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
export class StructureV3Manager {
  private state: StructureStatus = { status: 'not_downloaded', progress: 0, message: '', device: 'cpu' }
  private children = new Set<ChildProcess>()
  private setup?: Promise<void>
  private readonly concurrency = Math.max(1, Math.min(2, Math.floor(availableParallelism() / 8), Math.floor(freemem() / (4 * 1024 ** 3))))
  private readonly queue = new ProcessingQueue(this.concurrency + 2)
  private readonly cpuQueue = new ProcessingQueue(this.concurrency)
  private chartBatchSize = 1
  private directCharts = false
  private cpuRequests = 0
  private readonly capacityWaiters = new Set<() => void>()
  private active = 0
  private readonly measurements = new Map<string, {pages:number;requests:number;seconds:number}>()
  private readonly stop = new AbortController()
  private readonly workers: StructureLane[] = []
  private foreground = 0
  private readonly intelAvailability = new IntelEmbeddingAvailability()
  private readonly unregisterDevices = registerBackgroundDevices(() => this.workers.map(lane => lane.process.pid))
  private layoutFailed = new Set<string>()
  private readonly reservedDevices = new Set<string>()
  private reserveDevice(device: string): string { this.reservedDevices.add(device); return device }
  private stopped = false
  private workerRoot?: string
  root(): string { return join(localModelCacheDir(), 'structure-v3') }
  python(): string { return join(this.root(), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }
  async status(): Promise<StructureStatus> {
    if (this.state.status === 'installing' || this.state.status === 'error') return { ...this.state }
    try {
      const receipt = JSON.parse(await readFile(join(this.root(), 'ready.json'), 'utf8'))
      if (receipt.schema !== 1 || receipt.device !== 'cpu' || receipt.paddleocr !== '3.7.0') throw new Error('Unverified installation')
      await access(this.python())
      let layout = ''
      try {
        const acceleration = JSON.parse(await readFile(join(this.root(), 'layout-openvino/ready.json'), 'utf8'))
        if (acceleration.schema === 1 && acceleration.model === 'PP-DocLayout_plus-L' && Array.isArray(acceleration.devices)) {
          const devices = acceleration.devices.filter((device: string) => ['NPU','GPU'].includes(device) && !this.layoutFailed.has(device))
          if (devices.length) layout = ` · OpenVINO ${devices.join('/')} layout${this.foreground ? ' (paused for chat)' : ''}`
        }
      } catch { /* The standard CPU installation remains usable. */ }
      let cuda = ''
      try {
        const gpu = JSON.parse(await readFile(join(this.root(), 'gpu-ready.json'), 'utf8'))
        if (gpu.schema === 1 && gpu.precision === 'float32' && gpu.tf32 === false && !['CUDA','CUDA:1'].every(device => this.layoutFailed.has(device))) cuda = this.foreground ? ' · CUDA paused for chat' : ' · CUDA FP32'
      } catch { /* Optional GPU runtime is not installed. */ }
      return { status: 'ready', progress: 100, message: `PP-StructureV3: English OCR, tables and charts · CPU${cuda}${layout}`, device: 'cpu',
        activity:{activeDocuments:this.active,foreground:this.foreground>0,devices:[...new Set([...this.measurements.keys(),...this.workers.map(lane=>lane.device)])].map(device=>({device,active:this.workers.filter(lane=>lane.device===device&&lane.busy).length,...(this.measurements.get(device)??{pages:0,requests:0,seconds:0})}))} }
    } catch { return { status: 'not_downloaded', progress: 0, message: '', device: 'cpu' } }
  }
  private run(command: string, args: string[], timeout: number, signal?: AbortSignal, onText?: (text: string) => void, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Knowledge plugin is disabled'))
    signal?.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env: {
        ...process.env, ...extraEnv, CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '',
        PADDLE_PDX_CACHE_HOME: join(this.root(), 'models'), HF_HOME: join(this.root(), 'hf-cache'),
        PYTHONUNBUFFERED: '1',
      } })
      this.children.add(child)
      let log = '', expired = false
      const append = (data: Buffer) => { log = (log + data.toString()).slice(-6000); onText?.(log) }
      child.stdout.on('data', append); child.stderr.on('data', append)
      const stop = () => { stopOwnedProcess(child, 'SIGTERM'); const kill = setTimeout(() => stopOwnedProcess(child), 5000); kill.unref(); child.once('close', () => clearTimeout(kill)) }
      const timer = setTimeout(() => { expired = true; stop() }, timeout)
      const abort = () => stop()
      signal?.addEventListener('abort', abort, { once: true })
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.children.delete(child) }
      child.once('error', error => { cleanup(); reject(error) })
      child.once('close', code => { cleanup(); if (signal?.aborted) reject(signal.reason); else if (expired) reject(new Error('PP-StructureV3 timed out')); else if (code !== 0) reject(new Error(`PP-StructureV3 failed: ${log}`)); else resolve() })
    })
  }
  async prepare(): Promise<StructureStatus> {
    if (this.setup) return this.status()
    await mkdir(this.root(), { recursive: true })
    this.state = { status: 'installing', progress: 0, message: 'Preparing isolated CPU runtime…', device: 'cpu' }
    this.setup = ensurePrivatePython(this.root(),(command,args,env)=>this.run(command,args,7200000,undefined,undefined,env))
      .then(python => this.run(python, [script('setup-structure-v3.py'), this.root()], 7200000, undefined, log => {
      this.state = { ...this.state, message: log.slice(-2000), progress: log.includes('Downloading and loading') ? 80 : log.includes('Installing pinned') ? 30 : 5 }
    })).then(() => { this.state = { status: 'ready', progress: 100, message: 'CPU pipeline ready', device: 'cpu' } }).catch(error => {
      this.state = { status: 'error', progress: 0, message: error instanceof Error ? error.message : String(error), device: 'cpu' }
    }).finally(() => { this.setup = undefined })
    return { ...this.state }
  }
  private notifyCapacity(): void { for (const wake of [...this.capacityWaiters]) wake() }
  private waitCapacity(signal: AbortSignal): Promise<void> {
    return new Promise((resolve,reject) => {
      const finish = (error?: unknown) => {clearTimeout(timer);this.capacityWaiters.delete(wake);signal.removeEventListener('abort',abort);error ? reject(error) : resolve()}
      const wake = () => finish()
      const abort = () => finish(signal.reason ?? new Error('Structure work canceled'))
      // External device availability has no local completion event.
      const timer = setTimeout(wake,1000)
      this.capacityWaiters.add(wake);signal.addEventListener('abort',abort,{once:true})
      if(signal.aborted)abort()
    })
  }
  private async layoutDevice(tablesOnly = true): Promise<string> {
    if (this.foreground) return 'CPU'
    try {
      const cuda = JSON.parse(await readFile(join(this.root(), 'gpu-ready.json'), 'utf8'))
      if (cuda.schema === 1 && cuda.paddleocr === '3.7.0' && cuda.precision === 'float32' && cuda.tf32 === false) {
        this.chartBatchSize = cuda.chartBatchSize === 2 ? 2 : 1
        this.directCharts = cuda.singleChartDirect === true
        const decision = knowledgeGpuAdmission.allowed ? await nvidiaEmbeddingAvailability(() => backgroundDevicePids()) : {available:false,freeMiB:0}
        if (decision.available && !this.foreground && !this.stopped) {
          for (const device of ['CUDA','CUDA:1']) {
            if (this.layoutFailed.has(device) || this.reservedDevices.has(device) || this.workers.some(lane => lane.device === device && lane.busy)) continue
            const resident = this.workers.some(lane => lane.device === device && !lane.disabled && lane.initialized && lane.process.pid)
            // Reserve room for another worker still loading: its process may
            // exist before the CUDA allocator reflects the full model footprint.
            const loading = [...this.reservedDevices].filter(value => isCuda(value) && !this.workers.some(lane => lane.device === value && lane.initialized && !lane.disabled)).length
            if ((decision.freeMiB ?? 0) >= (resident ? 2048 : 8192) + loading * 8192) return this.reserveDevice(device)
          }
        }
      }
    } catch { /* The optional CUDA runtime is not qualified. */ }
    try {
      const receipt = JSON.parse(await readFile(join(this.root(), 'layout-openvino/ready.json'), 'utf8'))
      if (receipt.schema !== 1 || receipt.model !== 'PP-DocLayout_plus-L' || !Array.isArray(receipt.devices)) return 'CPU'
      const free = (device: string) => receipt.devices.includes(device) && !this.layoutFailed.has(device) && !this.reservedDevices.has(device) && !this.workers.some(lane => lane.device === device && lane.busy)
      if (tablesOnly && free('NPU')) return this.reserveDevice('NPU')
      if (free('GPU')) {
        let decision = await this.intelAvailability.sample(backgroundDevicePids())
        // Engine counters need two samples. Do not pin an entire PDF to CPU
        // merely because this is the first admission check after startup.
        if (!decision.available && decision.reason === 'Measuring Intel GPU activity') {
          await new Promise<void>(resolve => setTimeout(resolve, 200))
          if (this.foreground || this.stopped || !free('GPU')) return 'CPU'
          decision = await this.intelAvailability.sample(backgroundDevicePids())
        }
        if (decision.available && !this.foreground && !this.stopped && free('GPU')) return this.reserveDevice('GPU')
      }
    } catch { /* Optional acceleration is not installed. */ }
    return 'CPU'
  }
  async yieldMainGpu(): Promise<void> {
    await Promise.all(this.workers.filter(lane => isCuda(lane.device)).map(lane => this.stopLane(lane)))
  }
  private async stopLane(lane: StructureLane): Promise<void> {
    lane.disabled = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([lane.current ?? Promise.resolve(), new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000) })]).catch(() => {}) }
    finally { if (timer) clearTimeout(timer); await lane.process.stopAndWait() }
  }
  async enterForeground(): Promise<() => void> {
    this.foreground++
    try {
      await Promise.all(this.workers.filter(lane => lane.device !== 'CPU').map(lane => this.stopLane(lane)))
    } catch (error) { this.foreground--; throw error }
    let released = false
    return () => { if (!released) { released = true; this.foreground--; this.notifyCapacity() } }
  }
  private worker(device: string): StructureLane {
    for (let i = this.workers.length - 1; i >= 0; i--) {
      if (this.workers[i].disabled && !this.workers[i].busy) { this.workers[i].process.dispose(); this.workers.splice(i, 1) }
    }
    let lane = this.workers.find(worker => !worker.busy && worker.device === device && !worker.disabled)
    if (lane) return lane
    const env: NodeJS.ProcessEnv = {
      ...process.env, CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '',
      PADDLE_PDX_CACHE_HOME: join(this.root(), 'models'), HF_HOME: join(this.root(), 'hf-cache'), PYTHONUNBUFFERED: '1',
    }
    // Only an explicitly qualified receipt enables the optional Intel layout path.
    if (device === 'NPU' || device === 'GPU') Object.assign(env, acceleratorEnvironment(join(localModelCacheDir(), 'ocr-accelerators')), {
      PYTHONPATH: [join(this.root(), 'export-overlay'), process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
      DSH_STRUCTURE_LAYOUT_MODEL: join(this.root(), 'layout-openvino/layout.xml'),
      DSH_STRUCTURE_LAYOUT_CACHE: join(this.root(), 'layout-openvino/compiled'),
      DSH_STRUCTURE_LAYOUT_DEVICE: device,
    })
    else { delete env.DSH_STRUCTURE_LAYOUT_MODEL; delete env.DSH_STRUCTURE_LAYOUT_DEVICE }
    env.DSH_STRUCTURE_CHART_DIRECT = this.directCharts ? '1' : '0'
    delete env.DSH_STRUCTURE_CHART_BATCH
    env.DSH_STRUCTURE_DEVICE = isCuda(device) ? 'gpu:0' : 'cpu'
    if (isCuda(device)) {
      delete env.CUDA_VISIBLE_DEVICES
      const libraries = ['cuda_nvrtc','cuda_runtime','cuda_cupti','cudnn','cublas','cufft','curand','cusolver','cusparse','cusparselt','nccl','nvtx','nvjitlink','cufile']
      env.LD_LIBRARY_PATH = [...libraries.map(name => join(this.root(), 'cuda-overlay/nvidia', name, 'lib')), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
      env.PYTHONPATH = [join(this.root(), 'gpu-overlay'),join(this.root(), 'cuda-overlay'),process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')
      env.NVIDIA_TF32_OVERRIDE = '0'
      env.DSH_STRUCTURE_CHART_BATCH = String(this.chartBatchSize)
      env.FLAGS_allocator_strategy = 'auto_growth'
      env.FLAGS_fraction_of_gpu_memory_to_use = '0.7'
    }
    lane = {process: new StructureProcess(this.python(), [script('structure-v3.py'), '--worker'], env), busy: false, device}
    this.workers.push(lane)
    return lane
  }
  async extract(bytes: Uint8Array, fingerprint: string, charts: boolean, timeout: number, signal?: AbortSignal, tablesOnly = false): Promise<ProcessingOutput> {
    const failed = new AbortController()
    const combined = AbortSignal.any([...(signal ? [signal] : []), this.stop.signal, failed.signal])
    type Result = { pageCount: number; pageStart?: number; pageEnd?: number; blocks: { page: number; type: string; text: string }[] }
    const ranged = tablesOnly && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-'
    const devices = new Set<string>()
    let dir: string | undefined
    this.active++; knowledgeGpuAdmission.request(this, !this.foreground)
    try {
      combined.throwIfAborted()
      if ((await this.status()).status !== 'ready') throw Object.assign(new Error('Install PP-StructureV3 in Knowledge → Local Models first'), { code: 'structure_not_ready' })
      dir = await mkdtemp(join(tmpdir(), 'dsh-structure-'))
      const input = join(dir, 'source.pdf')
      await writeFile(input, bytes)
      if (this.workerRoot !== this.root()) {
        for (const lane of this.workers) lane.process.dispose()
        this.workers.length = 0; this.workerRoot = this.root()
      }
      let serial = 0
      const onCpu = <T>(task: () => Promise<T>): Promise<T> => {
        this.cpuRequests++
        return this.cpuQueue.run(task,combined).finally(() => {this.cpuRequests--;this.notifyCapacity()})
      }
      const run = async (device: string, start?: number, limit?: number): Promise<Result> => {
        combined.throwIfAborted()
        if (this.foreground && isCuda(device)) return onCpu(() => run('CPU', start, limit))
        if (this.foreground) device = 'CPU'
        const output = join(dir!, `result-${serial++}.json`)
        const releaseCpu = isCuda(device) ? undefined : enterStructureCpuWork()
        try {
          const lane = this.worker(device)
          lane.busy = true
          try {
            const started = performance.now()
            lane.current = lane.process.request({input, output, charts, tablesOnly,
              ...(start === undefined ? {} : {startPage:start,pageLimit:limit})}, timeout, combined)
            await lane.current
            const result = JSON.parse(await readFile(output, 'utf8')) as Result
            if (!Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 10000 || !Array.isArray(result.blocks)) throw new Error('Invalid PP-StructureV3 page count')
            if (start !== undefined && (result.pageStart !== start || result.pageEnd !== Math.min(result.pageCount, start + limit!))) throw new Error('Incomplete PP-StructureV3 page range')
            for (const block of result.blocks) {
              if (!Number.isInteger(block.page) || block.page < (start ?? 0) + 1 || block.page > (result.pageEnd ?? result.pageCount) || typeof block.text !== 'string' || typeof block.type !== 'string') throw new Error('Invalid PP-StructureV3 result')
            }
            lane.initialized = true
            devices.add(device)
            const measured = this.measurements.get(device) ?? {pages:0,requests:0,seconds:0}
            measured.pages += start === undefined ? result.pageCount : result.pageEnd! - start
            measured.requests++; measured.seconds += (performance.now() - started) / 1000
            this.measurements.set(device, measured)
            return result
          } catch (error) {
            if (device === 'CPU' || combined.aborted || this.stopped) throw error
            // Retry only this uncommitted range. Earlier ranges remain intact.
            if (!lane.disabled) this.layoutFailed.add(device)
            lane.disabled = true; await lane.process.stopAndWait()
            return await (isCuda(device) ? onCpu(() => run('CPU', start, limit)) : run('CPU', start, limit))
          } finally { lane.busy = false; lane.current = undefined }
        } finally { releaseCpu?.(); await rm(output, {force:true}) }
      }
      const schedule = async (claim: (device: string) => {start?:number;limit?:number} | undefined): Promise<Result | undefined> => {
        for (;;) {
          const outcome = await this.queue.run(async (): Promise<{retry:true}|{result:Result|undefined}> => {
            const device = await this.layoutDevice(tablesOnly)
            let dispatched = false
            try {
              const cuda = isCuda(device) && !this.foreground
              // Do not hold the outer queue while waiting for a CPU slot. That
              // would strand newly available CUDA behind long CPU chart jobs.
              if (!cuda && this.cpuRequests >= this.concurrency) return {retry:true}
              const range = claim(device)
              if (!range) return {result:undefined}
              dispatched = true
              return {result:await (cuda ? run(device,range.start,range.limit) : onCpu(() => run(this.foreground ? 'CPU' : device,range.start,range.limit)))}
            } finally {
              this.reservedDevices.delete(device)
              if(dispatched)this.notifyCapacity()
            }
          },combined)
          if ('result' in outcome) return outcome.result
          if(this.cpuRequests >= this.concurrency)await this.waitCapacity(combined)
        }
      }
      // Discover page count while completing the first page. Subsequent ranges
      // re-enter global admission, so fast devices can take work from long PDFs.
      const first = (await schedule(() => ranged ? {start:0,limit:1} : {}))!
      const results: Result[] = [first]
      if (ranged && first.pageCount > 1) {
        let next = 1
        const consume = async () => {
          while (next < first.pageCount) {
            const result = await schedule(device => {
              if (next >= first.pageCount) return undefined
              const start = next
              const limit = Math.min(isCuda(device) ? 8 : 1, first.pageCount - start)
              next += limit
              return {start,limit}
            })
            if (result) {
              if (result.pageCount !== first.pageCount) throw new Error('PP-StructureV3 PDF changed during processing')
              results.push(result)
            }
          }
        }
        const jobs = Array.from({length:this.concurrency + 2}, () => consume().catch(error => {failed.abort(error);throw error}))
        const settled = await Promise.allSettled(jobs)
        const rejected = settled.find(result => result.status === 'rejected')
        if (rejected?.status === 'rejected') throw rejected.reason
        results.sort((a,b) => a.pageStart! - b.pageStart!)
        let end = 0
        for (const result of results) {
          if (result.pageStart !== end) throw new Error('Incomplete PP-StructureV3 page coverage')
          end = result.pageEnd!
        }
        if (end !== first.pageCount) throw new Error('Incomplete PP-StructureV3 page coverage')
      }
      const blocks: ParsedBlock[] = []; let text = ''
      for (const result of results) for (const block of result.blocks) {
        const content = block.text.includes('<table') ? await extractHtmlToMarkdown(block.text) : block.text
        const start = text.length; text += content + '\n\n'
        const type = block.type.includes('title') ? 'heading' : block.type === 'table' || block.type === 'chart' ? 'table' : 'text'
        blocks.push({id:`structure-${blocks.length}`,index:blocks.length,type,text:content,textStart:start,textEnd:start+content.length,pageIndex:block.page-1})
      }
      if (!tablesOnly && !text.trim()) throw new Error('PP-StructureV3 returned no readable text')
      const output = parsedTextDocument(text, bytes, 'paddle', fingerprint)
      return {...output, document:{...output.document,processorVersion:`PaddleOCR 3.7.0 / PP-StructureV3 ${[...devices].sort().join('+')}${ranged ? ' / bounded page ranges' : ''}`,blocks,
        completeness:'complete' as const,pageCount:first.pageCount,processedPages:Array.from({length:first.pageCount},(_,index)=>index)}}
    } finally {
      if (dir) await rm(dir,{recursive:true,force:true})
      this.active--; knowledgeGpuAdmission.request(this, this.active > 0 && !this.foreground)
      if (!this.active) await Promise.all(this.workers.filter(lane => lane.device !== 'CPU').map(lane => this.stopLane(lane)))
    }
  }
  dispose(): void { knowledgeGpuAdmission.request(this, false); this.unregisterDevices(); this.stopped = true; this.stop.abort(); this.notifyCapacity(); for (const lane of this.workers) lane.process.dispose(); for (const child of this.children) stopOwnedProcess(child, 'SIGTERM') }
}
export const structureV3 = new StructureV3Manager()
