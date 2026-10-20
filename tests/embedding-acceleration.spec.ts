import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingAcceleration } from '../src/knowledge/embedding-acceleration.js'
afterEach(()=>vi.useRealTimers())
const vector=()=>[1,...Array(1023).fill(0)]
function fixture() {
 const cpu={device:'CPU',milliseconds:100,pending:0,enabled:true,tail:Promise.resolve(),worker:{request:vi.fn(async()=>({vector:vector(),elapsedMs:100})),stopAndWait:vi.fn(async()=>{}),dispose:vi.fn()}}
 const npu={...cpu,device:'NPU',milliseconds:1,worker:{...cpu.worker,request:vi.fn(async()=>{throw Error('Device disappeared')})}}
 const manager=new EmbeddingAcceleration()
 Object.assign(manager,{ready:{status:'ready',message:'validated',devices:[]},lanes:[cpu,npu]})
 return {manager,cpu,npu}
}
describe('embedding device fallback and yielding',()=>{
 it('keeps results ordered and falls back to the same-export CPU after NPU failure',async()=>{
  const {manager,cpu,npu}=fixture()
  expect(await manager.embed(['one','two'])).toEqual([vector(),vector()])
  expect(npu.worker.request).toHaveBeenCalled();expect(cpu.worker.request).toHaveBeenCalledTimes(2)
  manager.dispose()
 })
 it('releases GPU after its current job completes and never stops CPU or NPU lanes',async()=>{
  const {manager,cpu,npu}=fixture();let finish!:()=>void
  const gpu={...cpu,device:'GPU:intel',current:new Promise<void>(r=>{finish=r}),worker:{...cpu.worker,stopAndWait:vi.fn(async()=>{})}}
  Object.assign(manager,{lanes:[cpu,npu,gpu]})
  const pending=manager.enterForeground();expect(gpu.enabled).toBe(false);expect(gpu.worker.stopAndWait).not.toHaveBeenCalled()
  finish();const release=await pending;expect(gpu.worker.stopAndWait).toHaveBeenCalledTimes(1);expect(cpu.worker.stopAndWait).not.toHaveBeenCalled();expect(npu.worker.stopAndWait).not.toHaveBeenCalled();release();release();manager.dispose()
 })
 it('forces GPU release at ten seconds when the current job does not finish',async()=>{
  vi.useFakeTimers();const {manager,cpu}=fixture()
  const gpu={...cpu,device:'GPU:intel',current:new Promise<void>(()=>{}),worker:{...cpu.worker,stopAndWait:vi.fn(async()=>{})}}
  Object.assign(manager,{lanes:[cpu,gpu]});const pending=manager.enterForeground()
  await vi.advanceTimersByTimeAsync(9999);expect(gpu.worker.stopAndWait).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1);const release=await pending;expect(gpu.worker.stopAndWait).toHaveBeenCalledTimes(1);release();manager.dispose()
 })
})
