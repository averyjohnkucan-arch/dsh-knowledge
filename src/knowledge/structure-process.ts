import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

/** One serialized request per persistent process; bounded diagnostics, no document text over stdout. */
export class StructureProcess {
  private child?: ChildProcessWithoutNullStreams
  private closing = new Set<ChildProcessWithoutNullStreams>()
  private pending?: { id: number; resolve(result: Record<string, unknown>): void; reject(error: Error): void }
  private get label(): string { return this.prefix === 'DSH_EMBED_RESULT ' ? 'Embedding' : this.prefix === 'DSH_OCR_RESULT ' ? 'OCR' : 'PP-StructureV3' }
  private sequence = 0
  private log = ''
  constructor(private command: string, private args: string[], private env: NodeJS.ProcessEnv, private prefix = 'DSH_STRUCTURE_RESULT ') {}
  private stop(error: Error): void {
    const child = this.child; this.child = undefined
    const pending = this.pending; this.pending = undefined
    pending?.reject(error)
    if (child) { this.closing.add(child); child.once('exit', () => this.closing.delete(child)); child.kill('SIGKILL') }
  }
  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child
    const child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'], env: this.env, windowsHide: true })
    this.child = child; this.log = ''
    child.unref()
    child.stderr.on('data', data => { this.log = (this.log + data.toString()).slice(-6000) })
    child.stdin.on('error', error => { if (this.child === child) this.stop(error) })
    const lines = createInterface({ input: child.stdout })
    lines.on('line', line => {
      if (this.child !== child || !line.startsWith(this.prefix)) return
      try {
        const result = JSON.parse(line.slice(this.prefix.length))
        const pending = this.pending
        if (!pending || result.id !== pending.id) return
        this.pending = undefined
        if (result.ok === true) pending.resolve(result)
        else pending.reject(new Error(`${this.label} inference failed: ${String(result.error ?? 'unknown error').slice(0, 1000)}`))
      } catch { this.stop(new Error(`Invalid ${this.label} worker response`)) }
    })
    child.once('error', error => { if (this.child === child) this.stop(error) })
    child.once('close', () => { lines.close(); if (this.child === child) this.stop(new Error(`${this.label} worker exited: ${this.log}`)) })
    return child
  }
  async run(input: string, output: string, charts: boolean, timeout: number, signal?: AbortSignal): Promise<void> {
    await this.request({ input, output, charts }, timeout, signal)
  }
  request(payload: Record<string, unknown>, timeout: number, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted()
    if (this.pending) return Promise.reject(new Error(`${this.label} worker is busy`))
    return new Promise((resolve, reject) => {
      const id = ++this.sequence
      const timer = setTimeout(() => this.stop(new Error(`${this.label} timed out`)), timeout)
      const abort = () => this.stop(new Error(`${this.label} request canceled`))
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
      this.pending = { id, resolve: result => { cleanup(); resolve(result) }, reject: error => { cleanup(); reject(error) } }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        this.start().stdin.write(JSON.stringify({ ...payload, id }) + '\n', error => {
          if (error) this.stop(error)
        })
      } catch (error) { this.stop(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  get pid(): number | undefined { return this.child?.pid }
  async stopAndWait(): Promise<void> {
    const children = new Set(this.closing)
    if (this.child) children.add(this.child)
    const closed = [...children].map(child => new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      const done = () => { clearTimeout(timer); resolve() }
      const timer = setTimeout(() => { child.removeListener('exit', done); reject(new Error('Inference worker did not release its device')) }, 10_000)
      child.once('exit', done)
    }))
    this.stop(new Error('Background inference yielded to foreground work'))
    await Promise.all(closed)
  }

  dispose(): void { this.stop(new Error('Knowledge plugin stopped')) }
}
