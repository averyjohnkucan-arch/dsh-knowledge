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
    expect(await manager.recognize(Buffer.from('png'))).toBeUndefined()
    expect(cuda.failed).toBe(true)
    expect(await manager.recognize(Buffer.from('png'))).toBe('OCR evidence')
  })
})
