import { readdir, readFile, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
// Plugin-owned consumers share ownership, so OCR and embeddings can coexist.
const backgroundOwners = new Set<() => readonly (number | undefined)[]>()
export function registerBackgroundDevices(owner: () => readonly (number | undefined)[]): () => void {
  backgroundOwners.add(owner); return () => { backgroundOwners.delete(owner) }
}
export function backgroundDevicePids(local: ReadonlySet<number> = new Set()): Set<number> {
  return new Set([...local, ...[...backgroundOwners].flatMap(owner => owner()).filter((pid): pid is number => pid !== undefined)])
}
export interface DeviceAvailability { available: boolean; reason: string; freeMiB?: number }
export function parseIntelActivity(text: string, processName = ''): { client: string; nanoseconds: number } | undefined {
  if (!/^drm-driver:\s*(?:i915|xe)\s*$/m.test(text)) return undefined
  const client = /^drm-client-id:\s*(\S+)/m.exec(text)?.[1]
  if (!client) return undefined
  // Display rendering is not a model reservation. On drivers that report a
  // separate compute engine, retain compute checks for known display clients;
  // unknown applications and older drivers remain conservative.
  const display = /^(?:gnome-shell|kwin_wayland|kwin_x11|Xorg|Xwayland|ChatGPT)$/i.test(processName)
  const compute = /^drm-engine-compute:\s*(\d+) ns/m.exec(text)
  if (display && compute) return {client,nanoseconds:Number(compute[1])}
  let nanoseconds = 0
  for (const match of text.matchAll(/^drm-engine-(?:render|compute|video(?:-enhance)?):\s*(\d+) ns/gm)) nanoseconds += Number(match[1])
  return { client, nanoseconds }
}
export function intelActivityAvailable(previous: number, current: number, elapsedMs: number): boolean {
  return elapsedMs > 0 && current >= previous && (current - previous) / (elapsedMs * 1e6) < .05
}
export class IntelEmbeddingAvailability {
  private files: Array<{ pid: number; path: string; name: string }> = []; private scanned = 0
  private previous = new Map<string, { ns: number; at: number }>()
  private pending = new Map<string, Promise<DeviceAvailability>>()
  sample(owned: ReadonlySet<number>): Promise<DeviceAvailability> {
    const owners = backgroundDevicePids(owned)
    const key = [...owners].sort((a,b) => a-b).join(',')
    const pending = this.pending.get(key)
    if (pending) return pending
    const sample = this.sampleNow(owners).finally(() => { this.pending.delete(key) })
    this.pending.set(key, sample)
    return sample
  }
  private async sampleNow(owned: ReadonlySet<number>): Promise<DeviceAvailability> {
    if (process.platform !== 'linux') return { available: false, reason: 'Device activity monitoring is unavailable; desktop idle is required' }
    owned = backgroundDevicePids(owned)
    const now = Date.now()
    try {
      if (now - this.scanned > 2000) {
        const files: typeof this.files = []
        const pids = (await readdir('/proc')).filter(name => /^\d+$/.test(name)); let next = 0
        await Promise.all(Array.from({ length: 8 }, async () => {
          while (next < pids.length) {
            const pid = Number(pids[next++]); if (owned.has(pid)) continue
            try {
              if ((await stat(`/proc/${pid}`)).uid !== process.getuid?.()) continue
              const name = (await readFile(`/proc/${pid}/comm`,'utf8')).trim()
              for (const fd of await readdir(`/proc/${pid}/fdinfo`)) {
                const path = `/proc/${pid}/fdinfo/${fd}`
                try { if (parseIntelActivity(await readFile(path,'utf8'))) files.push({pid,path,name}) } catch { /* closed fd */ }
              }
            } catch { /* process exited or belongs to another user */ }
          }
        }))
        this.files = files; this.scanned = now
      }
      const samples = new Map<string, number>()
      for (const file of this.files) {
        if (owned.has(file.pid)) continue
        try { const activity = parseIntelActivity(await readFile(file.path,'utf8'),file.name); if (activity) samples.set(`${file.pid}:${activity.client}`, activity.nanoseconds) } catch { /* closed fd */ }
      }
      let known = true, busy = false
      const next = new Map<string, {ns:number;at:number}>()
      for (const [client,ns] of samples) {
        const previous=this.previous.get(client); if (!previous) known=false
        else if (!intelActivityAvailable(previous.ns,ns,now-previous.at)) busy=true
        next.set(client,{ns,at:now})
      }
      this.previous=next
      return {available:known&&!busy,reason:busy?'Another application is using Intel GPU engines':known?'Intel GPU engines are available':'Measuring Intel GPU activity'}
    } catch { return {available:false,reason:'Intel GPU availability could not be verified'} }
  }
}
export function foreignNvidiaGraphics(text: string, owned: ReadonlySet<number>): boolean {
  const compositor=/^(?:gnome-shell|kwin_wayland|kwin_x11|Xorg|Xwayland|dwm)$/i
  for (const line of text.split('\n')) {
    const fields=line.trim().split(/\s+/)
    if (!/^\d+$/.test(fields[0]??'') || !/^\d+$/.test(fields[1]??'')) continue
    if (owned.has(Number(fields[1]))) continue
    const command=fields.at(-1)??''
    if (fields[2]?.includes('C') || !compositor.test(command) || Number(fields[3])>5) return true
  }
  return false
}
export function nvidiaMemorySufficient(freeMiB: number, hasOwnedWorker: boolean): boolean {
  return Number.isFinite(freeMiB) && freeMiB >= (hasOwnedWorker ? 1024 : 4096)
}
export async function nvidiaEmbeddingAvailability(owned: ReadonlySet<number> | (()=>ReadonlySet<number>)): Promise<DeviceAvailability> {
  const currentOwned=()=>backgroundDevicePids(typeof owned==='function'?owned():owned)
  try {
    const [{stdout:apps},{stdout:memory}]=await Promise.all([
      exec('nvidia-smi',['--query-compute-apps=pid','--format=csv,noheader,nounits'],{timeout:2000,windowsHide:true}),
      exec('nvidia-smi',['--query-gpu=memory.free','--format=csv,noheader,nounits'],{timeout:2000,windowsHide:true}),
    ])
    const owners=currentOwned()
    if (apps.split(/\s+/).filter(Boolean).some(pid=>!/^\d+$/.test(pid)||!owners.has(Number(pid)))) return {available:false,reason:'Another inference process reserves the main GPU'}
    const freeMiB=Number(memory.trim().split('\n')[0]),ownGpu=apps.split(/\s+/).some(pid=>owners.has(Number(pid)))
    if (!nvidiaMemorySufficient(freeMiB,ownGpu)) return {available:false,reason:'Not enough free VRAM for background embeddings'}
    if (process.platform==='linux') {
      const {stdout}=await exec('nvidia-smi',['pmon','-s','u','-c','1'],{timeout:2500})
      if (foreignNvidiaGraphics(stdout,currentOwned())) return {available:false,reason:'Another graphics application is using the main GPU'}
    }
    return {available:true,reason:'Main GPU is available for background embedding',freeMiB}
  } catch {return {available:false,reason:'Main GPU availability could not be verified'}}
}
