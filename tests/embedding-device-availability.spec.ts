import { describe, expect, it, vi } from 'vitest'
import { IntelEmbeddingAvailability, foreignNvidiaGraphics, intelActivityAvailable, parseIntelActivity, nvidiaMemorySufficient } from '../src/knowledge/embedding-device-availability.js'
describe('embedding GPU availability', () => {
  it('requires launch headroom without evicting its own already resident workers', () => {
    expect(nvidiaMemorySufficient(3000,false)).toBe(false)
    expect(nvidiaMemorySufficient(5000,false)).toBe(true)
    expect(nvidiaMemorySufficient(3000,true)).toBe(true)
    expect(nvidiaMemorySufficient(500,true)).toBe(false)
    expect(nvidiaMemorySufficient(Number.NaN,true)).toBe(false)
  })
  it('reads Intel engine usage without counting the same client twice', () => {
    expect(parseIntelActivity('drm-driver: i915\ndrm-client-id: 7\ndrm-engine-render: 100 ns\ndrm-engine-compute: 20 ns\ndrm-engine-video: 30 ns\n')).toEqual({client:'7',nanoseconds:150})
    expect(parseIntelActivity('drm-driver: nvidia\ndrm-client-id: 7\n')).toBeUndefined()
  })
  it('withdraws when another application needs Intel GPU capacity', () => {
    expect(intelActivityAvailable(100,100+4e7,1000)).toBe(true)
    expect(intelActivityAvailable(100,100+6e7,1000)).toBe(false)
    expect(intelActivityAvailable(100,50,1000)).toBe(false)
  })
  it('ignores its own GPU jobs and an idle compositor, but yields to applications', () => {
    const idle='0 2993 G - - - - - - gnome-shell\n0 1234 C 90 40 0 0 0 0 python'
    expect(foreignNvidiaGraphics(idle,new Set([1234]))).toBe(false)
    expect(foreignNvidiaGraphics(idle,new Set())).toBe(true)
    expect(foreignNvidiaGraphics('0 5555 G - - - - - - game',new Set())).toBe(true)
    expect(foreignNvidiaGraphics('0 2993 G 20 - - - - - gnome-shell',new Set())).toBe(true)
  })
})

it('allows known desktop rendering but still yields to compute activity and unknown applications',()=>{
 const separate='drm-driver: i915\ndrm-client-id: 7\ndrm-engine-render: 100000000 ns\ndrm-engine-compute: 60000000 ns\ndrm-engine-video: 30000000 ns\n'
 for(const name of ['Xwayland','gnome-shell','ChatGPT']){
  expect(parseIntelActivity(separate,name)).toEqual({client:'7',nanoseconds:60000000})
  expect(intelActivityAvailable(0,parseIntelActivity(separate,name)!.nanoseconds,1000)).toBe(false)
  expect(parseIntelActivity(separate.replace('60000000 ns','0 ns'),name)).toEqual({client:'7',nanoseconds:0})
 }
 expect(parseIntelActivity(separate,'python')).toEqual({client:'7',nanoseconds:190000000})
 expect(parseIntelActivity(separate.replace('drm-engine-compute: 60000000 ns\n',''),'Xwayland')).toEqual({client:'7',nanoseconds:130000000})
})

 it('coalesces concurrent Intel scans for the same ownership and retries after a failed scan', async () => {
  const monitor = new IntelEmbeddingAvailability()
  let finish!: (value: {available:boolean;reason:string}) => void
  const probe = vi.spyOn(monitor as any, 'sampleNow').mockImplementation(() => new Promise(resolve => {finish=resolve}))
  const first=monitor.sample(new Set([1,2]))
  const second=monitor.sample(new Set([2,1]))
  expect(first).toBe(second)
  expect(probe).toHaveBeenCalledOnce()
  finish({available:true,reason:'measured'});await first
  probe.mockRejectedValueOnce(new Error('scan failed'))
  await expect(monitor.sample(new Set([1,2]))).rejects.toThrow('scan failed')
  probe.mockResolvedValueOnce({available:false,reason:'foreign compute'})
  expect(await monitor.sample(new Set([1,2]))).toMatchObject({available:false})
  expect(probe).toHaveBeenCalledTimes(3)
 })
 it('does not reuse a permission decision for different device ownership', async () => {
  const monitor=new IntelEmbeddingAvailability()
  const probe=vi.spyOn(monitor as any,'sampleNow').mockImplementation(async (owned:any)=>({available:owned.has(7),reason:'sample'}))
  const results=await Promise.all([monitor.sample(new Set([7])),monitor.sample(new Set())])
  expect(results.map(value=>value.available)).toEqual([true,false])
  expect(probe).toHaveBeenCalledTimes(2)
 })
