import { afterEach, describe, expect, it, vi } from 'vitest'
import { BackgroundGpuAdmission, type BackgroundDriver, type BackgroundLease } from '../src/knowledge/background-gpu.js'
afterEach(() => vi.useRealTimers())
describe('cooperative Knowledge GPU admission', () => {
  it('keeps CUDA disabled while waiting and gives the scheduler a yield boundary without dropping warm ownership', async () => {
    vi.useFakeTimers()
    const admission = new BackgroundGpuAdmission(), owner = {}
    let driver!: BackgroundDriver, grant!: (lease: BackgroundLease) => void
    const controller = new AbortController(), release = vi.fn(), stop = vi.fn(async () => {})
    const scheduler = {
      acquire: vi.fn((value: BackgroundDriver) => { driver=value; return new Promise<BackgroundLease>(resolve => { grant=resolve }) }),
      unload: vi.fn(async () => { await driver.unload() }),
    }
    const detach=admission.attach(scheduler,stop)
    admission.request(owner,true)
    expect(admission.allowed).toBe(false)
    expect(driver.priority).toBe('background')
    await driver.load(controller.signal);grant({signal:controller.signal,release})
    await vi.advanceTimersByTimeAsync(0)
    expect(admission.allowed).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(release).toHaveBeenCalledOnce()
    expect(scheduler.acquire).toHaveBeenCalledTimes(2)
    expect(admission.allowed).toBe(true) // warm driver remains owned until unload
    await driver.unload()
    expect(admission.allowed).toBe(false);expect(stop).toHaveBeenCalledOnce()
    grant({signal:controller.signal,release});await vi.advanceTimersByTimeAsync(0)
    admission.request(owner,false);await detach()
  })
  it('cancels a waiting request when no work remains and releases late grants', async () => {
    const admission=new BackgroundGpuAdmission(),owner={}
    let signal!:AbortSignal,grant!:(lease:BackgroundLease)=>void
    const release=vi.fn()
    const detach=admission.attach({acquire:(_driver,s)=>{signal=s!;return new Promise(resolve=>{grant=resolve})},unload:async()=>{}},async()=>{})
    admission.request(owner,true);admission.request(owner,false)
    expect(signal.aborted).toBe(true)
    grant({signal,release});await new Promise<void>(resolve=>setImmediate(resolve))
    expect(release).toHaveBeenCalledOnce();await detach()
  })
})
