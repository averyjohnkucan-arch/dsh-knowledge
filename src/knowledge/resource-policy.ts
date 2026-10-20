import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { uptime } from 'node:os'
const exec = promisify(execFile)
export interface IdleEvidence { idleSeconds: number | null; reason: string }
export interface MainGpuDecision { allowed: boolean; reason: string; idleSeconds: number | null }
export function decideMainGpu(input: { enabled: boolean; foreground: boolean; idleSeconds: number | null; idleAfterSeconds: number; externalCompute: boolean; freeMiB: number }): MainGpuDecision {
  const base = { idleSeconds: input.idleSeconds }
  if (!input.enabled) return { ...base, allowed: false, reason: 'Main GPU acceleration is disabled' }
  if (input.foreground) return { ...base, allowed: false, reason: 'Foreground inference reserves the main GPU' }
  if (input.idleSeconds === null) return { ...base, allowed: false, reason: 'Desktop idle state could not be verified' }
  if (input.idleSeconds < input.idleAfterSeconds) return { ...base, allowed: false, reason: 'Computer is in active use' }
  if (input.externalCompute) return { ...base, allowed: false, reason: 'Another process owns GPU compute resources' }
  if (input.freeMiB < 6144) return { ...base, allowed: false, reason: 'Insufficient free VRAM for background visual models' }
  return { ...base, allowed: true, reason: 'Desktop idle and main GPU available' }
}
export async function desktopIdle(): Promise<IdleEvidence> {
  try {
    if (process.platform === 'linux') {
      const { stdout } = await exec('loginctl', ['list-sessions', '--no-legend', '--no-pager'], { timeout: 2000 })
      const sessions = stdout.split('\n').map(row => row.trim().split(/\s+/)).filter(row => row[1] === String(process.getuid?.()))
      const idle: number[] = []
      for (const session of sessions) {
        const { stdout: detail } = await exec('loginctl', ['show-session', session[0], '-p', 'Type', '-p', 'Remote', '-p', 'State', '-p', 'IdleHint', '-p', 'IdleSinceHintMonotonic'], { timeout: 2000 })
        const fields = Object.fromEntries(detail.trim().split('\n').map(line => line.split('=')))
        if (!['wayland', 'x11'].includes(fields.Type) || fields.Remote !== 'no' || fields.State === 'closing') continue
        if (fields.IdleHint !== 'yes') return { idleSeconds: 0, reason: 'An interactive desktop is active' }
        const since = Number(fields.IdleSinceHintMonotonic)
        if (!Number.isFinite(since) || since <= 0) return { idleSeconds: null, reason: 'Idle timestamp unavailable' }
        idle.push(Math.max(0, uptime() - since / 1_000_000))
      }
      return { idleSeconds: idle.length ? Math.min(...idle) : null, reason: idle.length ? 'All local graphical sessions are idle' : 'No verifiable graphical session' }
    }
    if (process.platform === 'win32') {
      const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshIdle { [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; } [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p); public static double Seconds() { var p=new LASTINPUTINFO(); p.cbSize=(uint)Marshal.SizeOf(p); if(!GetLastInputInfo(ref p)) throw new Exception("Idle probe failed"); return unchecked((uint)Environment.TickCount-p.dwTime)/1000.0; } }'; [DshIdle]::Seconds()`
      const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 4000, windowsHide: true })
      const seconds = Number(stdout.trim())
      return { idleSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null, reason: 'Windows last-input timestamp' }
    }
  } catch { /* Unknown state never grants GPU use. */ }
  return { idleSeconds: null, reason: 'Idle detection is unavailable; using CPU/Intel devices' }
}
export class ResourcePolicy {
  private foreground = 0
  private consumers = new Set<{ stop(): Promise<void>; pid(): number | undefined }>()
  enabled = true
  idleAfterSeconds = 300
  register(consumer: { stop(): Promise<void>; pid(): number | undefined }): () => void { this.consumers.add(consumer); return () => this.consumers.delete(consumer) }
  async enterForeground(): Promise<() => void> {
    this.foreground++
    try { await Promise.all([...this.consumers].map(consumer => consumer.stop())) }
    catch { this.foreground--; throw new Error('Background GPU worker did not release its resources') }
    let released = false
    return () => { if (!released) { released = true; this.foreground-- } }
  }
  async mainGpu(): Promise<MainGpuDecision> {
    const idle = await desktopIdle()
    try {
      const owned = new Set([...this.consumers].map(consumer => consumer.pid()).filter((pid): pid is number => pid !== undefined))
      const [{ stdout: apps }, { stdout: memory }] = await Promise.all([
        exec('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader,nounits'], { timeout: 2000, windowsHide: true }),
        exec('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], { timeout: 2000, windowsHide: true }),
      ])
      const externalCompute = apps.split('\n').map(line => Number(line.trim())).some(pid => Number.isInteger(pid) && pid > 0 && !owned.has(pid))
      return decideMainGpu({ enabled: this.enabled, foreground: this.foreground > 0, idleSeconds: idle.idleSeconds, idleAfterSeconds: this.idleAfterSeconds, externalCompute, freeMiB: Number(memory.trim().split('\n')[0]) })
    } catch { return { allowed: false, idleSeconds: idle.idleSeconds, reason: 'Main GPU availability could not be verified' } }
  }
}
