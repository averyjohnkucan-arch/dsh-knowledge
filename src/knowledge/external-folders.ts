import { watch, type FSWatcher } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { spawn } from 'node:child_process'

/** Never follow a source symlink outside the selected root. */
export async function externalFile(root: string, path: string): Promise<string> {
  const realRoot = await realpath(root), file = await realpath(path)
  const rel = relative(realRoot, file)
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('Source is outside the selected folder')
  if (!(await stat(file)).isFile()) throw new Error('Original source is not a file')
  return file
}
export async function readableRoot(path: string): Promise<void> {
  if (!(await stat(path)).isDirectory()) throw new Error('Source folder is disconnected')
  await access(path)
  await readdir(path)
}
export interface FolderState { state: 'checking' | 'syncing' | 'connected' | 'disconnected' | 'error' | 'paused'; message?: string; checkedAt?: number }
export interface FolderSource { id: string; path: string; intervalMs: number; enabled: boolean }
/** File events are hints; periodic full reconciliation repairs missed events and restarts. */
export class ExternalFolders {
  readonly states = new Map<string, FolderState>()
  private watchers = new Map<string, { path: string; watcher: FSWatcher }>()
  private pending = new Set<string>()
  private forced = new Set<string>()
  private next = new Map<string, number>()
  private stopped = false
  private running = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  constructor(private sources: () => FolderSource[], private sync: (id: string) => Promise<void>) {}
  start(): void { this.timer = setInterval(() => { void this.tick() }, 1000); this.timer.unref?.(); void this.tick() }
  async tick(): Promise<void> {
    if (this.stopped) return
    const sources = this.sources(), ids = new Set(sources.map(s => s.id))
    for (const [id, entry] of this.watchers) if (!ids.has(id)) { entry.watcher.close(); this.watchers.delete(id) }
    for (const id of this.states.keys()) if (!ids.has(id)) { this.states.delete(id); this.next.delete(id); this.pending.delete(id); this.forced.delete(id) }
    const tasks: Promise<void>[] = []
    for (const source of sources) {
      if (this.running.has(source.id)) continue
      const force = this.forced.has(source.id)
      if (!source.enabled && !force) { this.watchers.get(source.id)?.watcher.close(); this.watchers.delete(source.id); this.states.set(source.id, { state: 'paused' }); continue }
      // One large library must not starve another source's state or manual scan.
      if (this.running.size >= 2) continue
      if (!this.pending.has(source.id) && !force && Date.now() < (this.next.get(source.id) ?? 0)) continue
      this.pending.delete(source.id); this.forced.delete(source.id)
      this.running.add(source.id)
      tasks.push(this.reconcile(source).finally(() => { this.running.delete(source.id) }))
    }
    await Promise.all(tasks)
  }
  private async reconcile(source: FolderSource): Promise<void> {
    const current = () => !this.stopped && this.sources().some(s => s.id === source.id && s.path === source.path)
    this.states.set(source.id, { state: 'checking' })
    try { await readableRoot(source.path) } catch {
      if (!current()) return
      this.watchers.get(source.id)?.watcher.close(); this.watchers.delete(source.id)
      this.states.set(source.id, { state: 'disconnected', message: 'Top-level folder is unavailable. Indexed knowledge is retained.', checkedAt: Date.now() })
      this.next.set(source.id, Date.now() + Math.min(source.intervalMs, 10000)); return
    }
    if (!current()) return
    const previous = this.watchers.get(source.id)
    if (source.enabled && previous?.path !== source.path) {
      previous?.watcher.close(); this.watchers.delete(source.id)
      try {
        const watcher = watch(source.path, { recursive: true, persistent: false }, () => { this.pending.add(source.id) })
        watcher.on('error', () => { watcher.close(); this.watchers.delete(source.id); this.pending.add(source.id) })
        this.watchers.set(source.id, { path: source.path, watcher })
      } catch { /* Polling remains available on filesystems without recursive watches. */ }
    }
    this.states.set(source.id, { state: 'syncing' })
    try {
      await this.sync(source.id)
      if (current()) this.states.set(source.id, { state: this.sources().find(s => s.id === source.id)?.enabled ? 'connected' : 'paused', checkedAt: Date.now() })
    } catch (error) {
      let state: FolderState['state'] = 'error'
      try { await readableRoot(source.path) } catch { state = 'disconnected' }
      if (current()) this.states.set(source.id, { state, message: error instanceof Error ? error.message : String(error), checkedAt: Date.now() })
    }
    if (current()) this.next.set(source.id, Date.now() + source.intervalMs)
  }
  request(id: string, force = false): void { this.pending.add(id); if (force) this.forced.add(id) }
  stop(): void { this.stopped = true; if (this.timer) clearInterval(this.timer); for (const w of this.watchers.values()) w.watcher.close(); this.watchers.clear() }
}

let picking = false
/** User-initiated host dialog. No shell interpolation of paths or user input. */
export async function pickFolder(): Promise<string | null> {
  if (picking) throw new Error('A folder picker is already open')
  picking = true
  const execute = (command: string, args: string[]) => new Promise<string | null>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] }); let output = ''
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Folder picker timed out')) }, 300000)
    child.stdout.setEncoding('utf8'); child.stdout.on('data', data => { output += data; if (output.length > 65536) child.kill() })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('close', code => { clearTimeout(timeout); if (code === 0) resolve(output.trim() || null); else if (code === 1) resolve(null); else reject(new Error('Folder picker could not open on the DSH host')) })
  })
  try {
    if (process.platform === 'win32') return await execute('powershell.exe', ['-NoProfile', '-STA', '-Command', "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = 'Choose the folder to synchronize with Knowledge'; if ($picker.ShowDialog() -eq 'OK') { [Console]::WriteLine($picker.SelectedPath) }; $picker.Dispose()"])
    if (process.platform === 'linux') {
      try { return await execute('zenity', ['--file-selection', '--directory', '--title=Choose a Knowledge source folder']) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return await execute('kdialog', ['--getexistingdirectory', '.']) }
    }
    throw new Error('Native folder selection is available on Windows and Linux; enter the host path manually on this platform')
  } finally { picking = false }
}
