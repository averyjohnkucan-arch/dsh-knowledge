import { stopOwnedProcess } from './owned-process.js'
import { ensurePrivatePython } from './private-python.js'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { localModelCacheDir } from './embed.js'
import { StructureProcess } from './structure-process.js'

interface Device { device: string; name: string; qualified: boolean; medianMs?: number; error?: string }
export interface OcrAccelerationStatus { status: 'not_installed' | 'installing' | 'ready' | 'error'; message: string; devices: Device[] }
interface Lane { device: Device; process: StructureProcess; pending: number; tail: Promise<unknown>; samples: number[]; runs: number; failed: boolean }
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
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
  private loadedRoot?: string
  private state?: OcrAccelerationStatus
  private preparation?: Promise<void>
  private setupChild?: ChildProcess
  private stopped = false
  root(): string { return join(localModelCacheDir(), 'ocr-accelerators') }
  python(): string { return join(this.root(), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }
  get concurrency(): number { return Math.max(1, this.lanes.filter(lane => !lane.failed).length) }
  async status(): Promise<OcrAccelerationStatus> {
    if (this.state) return this.state
    if (this.loadedRoot === this.root()) return { status: 'ready', message: 'Calibrated local OCR devices', devices: this.lanes.map(lane => ({ ...lane.device, qualified: !lane.failed })) }
    this.releaseWorkers()
    try {
      const receipt = JSON.parse(await readFile(join(this.root(), 'ready.json'), 'utf8'))
      if (receipt.schema !== 1 || !Array.isArray(receipt.devices)) throw new Error('Invalid acceleration receipt')
      const digest = createHash('sha256')
      for (const name of ['ppocrv5_det.onnx', 'ppocrv5_rec.onnx', 'ppocrv5_dict.txt']) digest.update(await readFile(join(localModelCacheDir(), 'ocr', name)))
      if (digest.digest('hex') !== receipt.modelHash) throw new Error('OCR weights changed; recalibration required')
      for (const device of receipt.devices as Device[]) {
        if (!device.qualified || !Number.isFinite(device.medianMs) || device.medianMs! <= 0) continue
        if (!(device.device === 'CPU' || /^NPU(?:\.\d+)?$/.test(device.device) || /^GPU(?:\.\d+)?$/.test(device.device) && /intel/i.test(device.name))) continue
        this.lanes.push({ device, process: new StructureProcess(this.python(), [script('ocr-accelerator-worker.py'), '--worker', '--models', join(localModelCacheDir(), 'ocr'), '--cache', join(this.root(), 'compiled'), '--device', device.device], acceleratorEnvironment(this.root()), 'DSH_OCR_RESULT '), pending: 0, tail: Promise.resolve(), samples: [], runs: 0, failed: false })
      }
      if (!this.lanes.some(lane => lane.device.device === 'CPU')) throw new Error('No qualified CPU fallback')
      this.loadedRoot = this.root()
      return { status: 'ready', message: 'Explicit CPU/Intel devices; NVIDIA GPU reserved', devices: receipt.devices }
    } catch { this.releaseWorkers(); return { status: 'not_installed', message: 'Using the standard CPU OCR engine. Download and calibrate optional acceleration to use Intel devices.', devices: [] } }
  }
  async recognize(png: Buffer): Promise<string | undefined> {
    if (this.stopped || (await this.status()).status !== 'ready') return undefined
    const choices = this.lanes.filter(lane => !lane.failed && lane.pending < 8)
    choices.sort((a, b) => (a.pending + 1) * a.device.medianMs! - (b.pending + 1) * b.device.medianMs!)
    const lane = choices[0]
    if (!lane) return undefined
    lane.pending++
    const task = async (): Promise<string | undefined> => {
      try {
        if (this.stopped || lane.failed) return undefined
        const result = await lane.process.request({ png: png.toString('base64') }, 300_000)
        if (typeof result.text !== 'string') throw new Error('Invalid OCR text response')
        if (lane.runs++ > 0 && typeof result.elapsedMs === 'number' && result.elapsedMs > 0) {
          lane.samples.push(result.elapsedMs); lane.samples = lane.samples.slice(-10)
          const sorted = [...lane.samples].sort((a, b) => a - b); lane.device.medianMs = sorted[Math.floor(sorted.length / 2)]
        }
        return result.text
      } catch { lane.failed = true; lane.process.dispose(); return undefined }
      finally { lane.pending-- }
    }
    const result = lane.tail.then(task, task); lane.tail = result.catch(() => {}); return result
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
      .then(async () => { this.state = undefined; await this.status() })
      .catch(error => { this.state = { status: 'error', message: error instanceof Error ? error.message : String(error), devices: [] } })
      .finally(() => { this.preparation = undefined })
    return this.state
  }
  releaseWorkers(): void { for (const lane of this.lanes) lane.process.dispose(); this.lanes = []; this.loadedRoot = undefined }
  dispose(): void { this.stopped = true; this.setupChild && stopOwnedProcess(this.setupChild); this.releaseWorkers() }
}
