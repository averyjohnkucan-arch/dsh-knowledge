import { afterEach, describe, expect, it, vi } from 'vitest'
import { OcrAcceleration } from '../src/knowledge/ocr-acceleration.js'
const managers: OcrAcceleration[] = []
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose(); vi.useRealTimers() })
function fixture() {
  const manager = new OcrAcceleration(); managers.push(manager)
  const lane = (device: string, milliseconds = 100) => ({ device: {device, qualified:true, medianMs:milliseconds},
    process: {request:vi.fn(async () => ({text:'OCR evidence',elapsedMs:100})),stopAndWait:vi.fn(async()=>{}),dispose:vi.fn()},
    pending:0,tail:Promise.resolve(),samples:[],runs:0,failed:false,enabled:true })
  const cpu=lane('CPU'), extraCpu=lane('CPU'), npu=lane('NPU'), igpu=lane('GPU'), cuda=lane('CUDA:0',1)
  Object.assign(manager,{loadedRoot:manager.root(),lanes:[cpu,extraCpu,npu,igpu,cuda]})
  return {manager,cpu,extraCpu,npu,igpu,cuda}
}
describe('OCR foreground resource handoff',()=>{
  it('releases GPUs and surplus CPU sessions while keeping one CPU and NPU running',async()=>{
    const {manager,cpu,extraCpu,npu,igpu,cuda}=fixture()
    const release=await manager.enterForeground()
    expect(cpu.enabled).toBe(true);expect(npu.enabled).toBe(true)
    expect(extraCpu.enabled).toBe(false);expect(igpu.enabled).toBe(false);expect(cuda.enabled).toBe(false)
    expect(cpu.process.stopAndWait).not.toHaveBeenCalled();expect(npu.process.stopAndWait).not.toHaveBeenCalled()
    expect(cuda.process.stopAndWait).toHaveBeenCalledOnce()
    await expect(manager.recognize(Buffer.from('png'))).resolves.toBe('OCR evidence')
    expect(cuda.process.request).not.toHaveBeenCalled()
    release();release();expect(extraCpu.enabled).toBe(true);expect(cuda.enabled).toBe(false)
  })
  it('finishes the current GPU request before granting foreground ownership',async()=>{
    const {manager,cuda}=fixture();let finish!:()=>void
    Object.assign(cuda,{current:new Promise<void>(resolve=>{finish=resolve})})
    const handoff=manager.enterForeground()
    expect(cuda.enabled).toBe(false);expect(cuda.process.stopAndWait).not.toHaveBeenCalled()
    finish();const release=await handoff;expect(cuda.process.stopAndWait).toHaveBeenCalledOnce();release()
  })
  it('enforces ten seconds even if a GPU call stalls',async()=>{
    vi.useFakeTimers();const {manager,cuda}=fixture()
    Object.assign(cuda,{current:new Promise(()=>{})})
    const handoff=manager.enterForeground()
    await vi.advanceTimersByTimeAsync(9999);expect(cuda.process.stopAndWait).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1);const release=await handoff;expect(cuda.process.stopAndWait).toHaveBeenCalledOnce();release()
  })
  it('falls back instead of dropping a page when an accelerator fails',async()=>{
    const {manager,cuda}=fixture();cuda.process.request.mockRejectedValueOnce(Error('device reset'))
    expect(await manager.recognize(Buffer.from('png'))).toBe('OCR evidence')
    expect(cuda.failed).toBe(true)
    expect(await manager.recognize(Buffer.from('png'))).toBe('OCR evidence')
  })
})

describe('CUDA OCR admission',()=>{
 const evidence='The archival correspondence records committee proceedings and the meeting date in December. '.repeat(10)
 it('admits a healthy GPU despite a small OCR transcription difference',async()=>{
  const {manager,cpu,cuda}=fixture();cuda.device.qualified=false
  cpu.process.request.mockResolvedValue({text:evidence,elapsedMs:100})
  cuda.process.request.mockResolvedValue({text:evidence.replace('committee','commitee'),elapsedMs:20,provider:'CUDAExecutionProvider'} as never)
  expect(await manager.recognize(Buffer.from('scan'))).toContain('commitee')
  expect(cuda.device.qualified).toBe(true);expect(cuda.failed).toBe(false)
 })
 it('uses CPU for a bad qualification page and retries the GPU on a later page',async()=>{
  vi.useFakeTimers();const {manager,cpu,cuda}=fixture();cuda.device.qualified=false
  cpu.process.request.mockResolvedValue({text:evidence,elapsedMs:100})
  cuda.process.request.mockResolvedValueOnce({text:'Unrelated output',elapsedMs:20,provider:'CUDAExecutionProvider'} as never)
  expect(await manager.recognize(Buffer.from('scan'))).toBe(evidence)
  expect(cuda.failed).toBe(false);expect(cuda.device.qualified).toBe(false)
  await vi.advanceTimersByTimeAsync(10001)
  cuda.process.request.mockResolvedValue({text:evidence,elapsedMs:20,provider:'CUDAExecutionProvider'} as never)
  expect(await manager.recognize(Buffer.from('next scan'))).toBe(evidence)
  expect(cuda.device.qualified).toBe(true)
 })
})


describe('OCR queue backpressure',()=>{
 it('waits for healthy lanes instead of spilling busy pages into extra CPU workers',async()=>{
  const {manager,cpu,npu}=fixture();const release=await manager.enterForeground()
  let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve})
  for(const lane of [cpu,npu])lane.process.request.mockImplementation(async()=>{await gate;return{text:'OCR evidence',elapsedMs:10}})
  const jobs=Array.from({length:12},()=>manager.recognize(Buffer.from('page')))
  await new Promise(resolve=>setTimeout(resolve,20))
  expect(cpu.process.request).toHaveBeenCalledTimes(1);expect(npu.process.request).toHaveBeenCalledTimes(1)
  finish();expect(await Promise.all(jobs)).toEqual(Array(12).fill('OCR evidence'));release()
 })
})


it('reroutes queued GPU pages through the bounded CPU/NPU lanes during foreground handoff',async()=>{
 const {manager,cuda}=fixture();let finish!:()=>void
 const gate=new Promise<void>(resolve=>{finish=resolve})
 cuda.process.request.mockImplementation(async()=>{await gate;return{text:'OCR evidence',elapsedMs:20}})
 const jobs=[manager.recognize(Buffer.from('a')),manager.recognize(Buffer.from('b'))]
 await new Promise<void>(resolve=>setImmediate(resolve))
 const handoff=manager.enterForeground();finish();const release=await handoff
 expect(await Promise.all(jobs)).toEqual(['OCR evidence','OCR evidence'])
 expect(cuda.process.request).toHaveBeenCalledTimes(1);release()
})

it('queues on a faster CUDA lane instead of making a short document wait for slow CPU OCR', async () => {
  const {manager,cpu,npu,igpu,cuda}=fixture()
  let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve})
  cuda.process.request.mockImplementation(async()=>{await gate;return{text:'OCR evidence',elapsedMs:1}})
  const jobs=Array.from({length:12},()=>manager.recognize(Buffer.from('page')))
  await new Promise<void>(resolve=>setImmediate(resolve))
  expect(cuda.process.request).toHaveBeenCalledTimes(1)
  expect(cpu.process.request).not.toHaveBeenCalled();expect(npu.process.request).not.toHaveBeenCalled();expect(igpu.process.request).not.toHaveBeenCalled()
  finish();expect(await Promise.all(jobs)).toEqual(Array(12).fill('OCR evidence'))
  const status=await manager.status(),device=status.devices.find(device=>device.device==='CUDA:0')
  expect(device).toMatchObject({enabled:true,pending:0,completed:12})
})

it('shares CUDA backend qualification only for matching provider and source model identity', async () => {
  const {manager,cpu,cuda}=fixture();cuda.device.qualified=false
  const evidence='OCR evidence from archival correspondence with a verified recording date.'
  cpu.process.request.mockResolvedValue({text:evidence,elapsedMs:100})
  Object.assign(manager,{modelHash:'known-weights'})
  const clone={...cuda,device:{...cuda.device,device:'CUDA:1'},tail:Promise.resolve(),pending:0}
  ;(manager as any).lanes.push(clone)
  cuda.process.request.mockResolvedValue({text:evidence,elapsedMs:1,provider:'CUDAExecutionProvider',modelHash:'known-weights'} as never)
  expect(await Promise.all([manager.recognize(Buffer.from('one')),manager.recognize(Buffer.from('two'))])).toEqual([evidence,evidence])
  expect(cpu.process.request).toHaveBeenCalledOnce()
  expect(cuda.device.qualified).toBe(true);expect(clone.device.qualified).toBe(true)
})

it('keeps more CPU OCR capacity when CUDA is absent and reduces contention with a large CUDA pool', async () => {
  const {manager,cpu,extraCpu,cuda}=fixture()
  ;(manager as any).lanes.push(...Array.from({length:3},(_,i)=>({...cuda,device:{...cuda.device,device:`CUDA:${i+1}`}})))
  await (manager as any).balanceCpu()
  expect(cpu.enabled).toBe(true);expect(extraCpu.enabled).toBe(false)
  for(const lane of (manager as any).lanes)if(lane.device.device.startsWith('CUDA'))lane.enabled=false
  await (manager as any).balanceCpu();expect(extraCpu.enabled).toBe(true)
})
