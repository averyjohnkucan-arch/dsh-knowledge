import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingBatcher } from '../src/knowledge/embedding-batcher.js'
import { EmbeddingAcceleration } from '../src/knowledge/embedding-acceleration.js'
afterEach(()=>vi.useRealTimers())
const vector=()=>[1,...Array(1023).fill(0)]
function fixture() {
 const cpu={device:'CPU',milliseconds:100,pending:0,enabled:true,tail:Promise.resolve(),worker:{request:vi.fn(async()=>({vector:vector(),elapsedMs:100})),stopAndWait:vi.fn(async()=>{}),dispose:vi.fn()}}
 const npu={...cpu,device:'NPU',milliseconds:1,worker:{...cpu.worker,request:vi.fn(async()=>{throw Error('Device disappeared')})}}
 const manager=new EmbeddingAcceleration()
 Object.assign(manager,{warmed:true,ready:{status:'ready',message:'validated',devices:[]},lanes:[cpu,npu]})
 return {manager,cpu,npu}
}
describe('embedding device fallback and yielding',()=>{
 it('runs CPU, NPU and available GPU lanes concurrently instead of switching the whole pipeline',async()=>{
  const {manager,cpu}=fixture();let finish!:()=>void
  const gate=new Promise<void>(resolve=>{finish=resolve})
  const lanes=['CPU','NPU','GPU:main'].map(device=>({...cpu,device,milliseconds:100,worker:{...cpu.worker,request:vi.fn(async()=>{await gate;return {vector:vector(),elapsedMs:100}})}}))
  Object.assign(manager,{lanes})
  const pending=manager.embed(['one','two','three'])
  await new Promise<void>(resolve=>setImmediate(resolve))
  for(const lane of lanes)expect(lane.worker.request).toHaveBeenCalledTimes(1)
  finish();expect(await pending).toHaveLength(3);manager.dispose()
 })

 it('does not queue a whole document behind a slow device',async()=>{
  const {manager,cpu}=fixture();let finish!:()=>void
  const gate=new Promise<void>(resolve=>{finish=resolve})
  cpu.worker.request.mockImplementation(async()=>{await gate;return {vector:vector(),elapsedMs:100}})
  Object.assign(manager,{lanes:[cpu]})
  const pending=manager.embed(['one','two','three','four'])
  await new Promise<void>(resolve=>setImmediate(resolve))
  expect(cpu.pending).toBe(1)
  expect(cpu.worker.request).toHaveBeenCalledTimes(1)
  finish();expect(await pending).toHaveLength(4);manager.dispose()
 })
 it('keeps results ordered and falls back to the same-export CPU after NPU failure',async()=>{
  const {manager,cpu,npu}=fixture()
  expect(await manager.embed(['one','two'])).toEqual([vector(),vector()])
  expect(npu.worker.request).toHaveBeenCalled();expect(cpu.worker.request).toHaveBeenCalledTimes(2)
  manager.dispose()
 })
 it('keeps retrieval off GPUs even when a GPU lane is much faster',async()=>{
  const {manager,cpu}=fixture()
  const gpu={...cpu,device:'GPU:main',milliseconds:1,worker:{...cpu.worker,request:vi.fn(async()=>({vector:vector(),elapsedMs:1}))}}
  Object.assign(manager,{lanes:[cpu,gpu]})
  await manager.embed(['question'],'query')
  expect(cpu.worker.request).toHaveBeenCalledTimes(1);expect(gpu.worker.request).not.toHaveBeenCalled();manager.dispose()
 })
 it('releases GPU after its current job completes and never stops CPU or NPU lanes',async()=>{
  const {manager,cpu,npu}=fixture();let finish!:()=>void
  const second={...cpu.worker,stopAndWait:vi.fn(async()=>{})}
  const gpu={...cpu,device:'GPU:main',extraWorkers:[second],current:new Promise<void>(r=>{finish=r}),worker:{...cpu.worker,stopAndWait:vi.fn(async()=>{})}}
  Object.assign(manager,{lanes:[cpu,npu,gpu]})
  const pending=manager.enterForeground();expect(gpu.enabled).toBe(false);expect(gpu.worker.stopAndWait).not.toHaveBeenCalled()
  finish();const release=await pending;expect(gpu.worker.stopAndWait).toHaveBeenCalledTimes(1);expect(second.stopAndWait).toHaveBeenCalledTimes(1);expect(cpu.worker.stopAndWait).not.toHaveBeenCalled();expect(npu.worker.stopAndWait).not.toHaveBeenCalled();release();release();manager.dispose()
 })
 it('forces GPU release at ten seconds when the current job does not finish',async()=>{
  vi.useFakeTimers();const {manager,cpu}=fixture()
  const gpu={...cpu,device:'GPU:intel',current:new Promise<void>(()=>{}),worker:{...cpu.worker,stopAndWait:vi.fn(async()=>{})}}
  Object.assign(manager,{lanes:[cpu,gpu]});const pending=manager.enterForeground()
  await vi.advanceTimersByTimeAsync(9999);expect(gpu.worker.stopAndWait).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1);const release=await pending;expect(gpu.worker.stopAndWait).toHaveBeenCalledTimes(1);release();manager.dispose()
 })
 it('falls back after a five-second NPU queue wait without disabling or stopping the NPU',async()=>{
  vi.useFakeTimers();const {manager,cpu,npu}=fixture()
  let finish!:()=>void
  const gate=new Promise<void>(resolve=>{finish=resolve})
  const calls:string[]=[]
  const batcher=new EmbeddingBatcher(async texts=>{calls.push(texts[0]);await gate;return {vectors:[vector()],elapsedMs:1}},1)
  Object.assign(npu,{batcher,jobs:new Set()})
  const active=batcher.request('bulk')
  await vi.advanceTimersByTimeAsync(3)
  const query=manager.embed(['question'],'query')
  await vi.advanceTimersByTimeAsync(4999);expect(cpu.worker.request).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1);expect(await query).toEqual([vector()])
  expect(npu.enabled).toBe(true);expect(npu.worker.dispose).not.toHaveBeenCalled()
  finish();await active;await vi.advanceTimersByTimeAsync(10)
  expect(calls).toEqual(['bulk']);manager.dispose()
 })

 it('retains runtime diagnostics and pauses the failed lane before CPU fallback',async()=>{
  const {manager,npu}=fixture();const pause=vi.fn()
  Object.assign(npu,{batcher:{request:vi.fn(async()=>{throw Error('driver reset details')}),pause},jobs:new Set()})
  const device={device:'NPU',qualified:true};Object.assign(manager,{ready:{status:'ready',devices:[device]}})
  await manager.embed(['question'],'query')
  expect(pause).toHaveBeenCalled();expect(manager.snapshot.devices[0].error).toContain('driver reset details')
  manager.dispose()
 })
 it('requalifies a failed NPU against CPU before returning it to service',async()=>{
  const {manager,cpu,npu}=fixture()
  Object.assign(npu,{enabled:false,qualified:false})
  const worker={...cpu.worker,request:vi.fn(async()=>({vector:vector(),elapsedMs:80}))}
  const candidate={...cpu,device:'NPU',worker}
  Object.assign(manager,{lane:vi.fn(()=>candidate),ready:{status:'ready',devices:[{device:'NPU',qualified:false,error:'old failure'}]}})
  await (manager as unknown as {revalidateNpu():Promise<void>}).revalidateNpu()
  expect(manager.snapshot.devices[0]).toMatchObject({qualified:true,minimumCosine:1})
  expect(manager.snapshot.devices[0].error).toBeUndefined();manager.dispose()
 })

})
