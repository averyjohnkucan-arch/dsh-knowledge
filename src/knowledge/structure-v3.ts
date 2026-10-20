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

export interface StructureStatus { status: 'not_downloaded' | 'installing' | 'ready' | 'error'; progress: number; message: string; device: 'cpu' }
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
export class StructureV3Manager {
  private state: StructureStatus = { status: 'not_downloaded', progress: 0, message: '', device: 'cpu' }
  private children = new Set<ChildProcess>()
  private setup?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private stopped = false
  private worker?: StructureProcess
  private workerRoot?: string
  root(): string { return join(localModelCacheDir(), 'structure-v3') }
  python(): string { return join(this.root(), 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') }
  async status(): Promise<StructureStatus> {
    if (this.state.status === 'installing' || this.state.status === 'error') return { ...this.state }
    try {
      const receipt = JSON.parse(await readFile(join(this.root(), 'ready.json'), 'utf8'))
      if (receipt.schema !== 1 || receipt.device !== 'cpu' || receipt.paddleocr !== '3.7.0') throw new Error('Unverified installation')
      await access(this.python())
      return { status: 'ready', progress: 100, message: 'PP-StructureV3: English OCR, layout, tables and charts · CPU', device: 'cpu' }
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
  async extract(bytes: Uint8Array, fingerprint: string, charts: boolean, timeout: number, signal?: AbortSignal): Promise<ProcessingOutput> {
    const task = async () => {
      signal?.throwIfAborted()
      if ((await this.status()).status !== 'ready') throw Object.assign(new Error('Install PP-StructureV3 in Knowledge → Local Models first'), { code: 'structure_not_ready' })
      const dir = await mkdtemp(join(tmpdir(), 'dsh-structure-'))
      try {
        await writeFile(join(dir, 'source.pdf'), bytes)
        if (this.stopped) throw new Error('Knowledge plugin is disabled')
        if (!this.worker || this.workerRoot !== this.root()) {
          this.worker?.dispose(); this.workerRoot = this.root()
          this.worker = new StructureProcess(this.python(), [script('structure-v3.py'), '--worker'], {
            ...process.env, CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '',
            PADDLE_PDX_CACHE_HOME: join(this.root(), 'models'), HF_HOME: join(this.root(), 'hf-cache'), PYTHONUNBUFFERED: '1',
          })
        }
        await this.worker.run(join(dir, 'source.pdf'), join(dir, 'result.json'), charts, timeout, signal)
        const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8')) as { pageCount: number; blocks: { page: number; type: string; text: string }[] }
        if (!Number.isInteger(result.pageCount) || result.pageCount < 1 || result.pageCount > 10000 || !Array.isArray(result.blocks)) throw new Error('Invalid PP-StructureV3 page count')
        const blocks: ParsedBlock[] = []; let text = ''
        for (const block of result.blocks) {
          if (!Number.isInteger(block.page) || block.page < 1 || typeof block.text !== 'string') throw new Error('Invalid PP-StructureV3 result')
          const content = block.text.includes('<table') ? await extractHtmlToMarkdown(block.text) : block.text
          const start = text.length; text += content + '\n\n'
          const type = block.type.includes('title') ? 'heading' : block.type === 'table' || block.type === 'chart' ? 'table' : 'text'
          blocks.push({ id: `structure-${blocks.length}`, index: blocks.length, type, text: content, textStart: start, textEnd: start + content.length, pageIndex: block.page - 1 })
        }
        if (!text.trim()) throw new Error('PP-StructureV3 returned no readable text')
        const output = parsedTextDocument(text, bytes, 'paddle', fingerprint)
        return { ...output, document: { ...output.document, processorVersion: 'PaddleOCR 3.7.0 / PP-StructureV3 CPU', blocks,
          completeness: 'complete' as const, pageCount: result.pageCount, processedPages: Array.from({ length: result.pageCount }, (_, index) => index) } }
      } finally { await rm(dir, { recursive: true, force: true }) }
    }
    const pending = this.queue.then(task, task); this.queue = pending.catch(() => {}); return pending
  }
  dispose(): void { this.stopped = true; this.worker?.dispose(); for (const child of this.children) stopOwnedProcess(child, 'SIGTERM') }
}
export const structureV3 = new StructureV3Manager()
