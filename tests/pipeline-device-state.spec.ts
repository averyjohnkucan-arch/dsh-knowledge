import {expect,it,vi} from 'vitest'
import {OcrAcceleration} from '../src/knowledge/ocr-acceleration.js'
import {EmbeddingAcceleration} from '../src/knowledge/embedding-acceleration.js'
import {StructureV3Manager} from '../src/knowledge/structure-v3.js'
it('reports OCR model exclusion and foreground yielding separately from active work',()=>{
 const manager=new OcrAcceleration(),internal=manager as any
 internal.excludedDevices=[{device:'NPU',qualified:false,error:'Model qualification failed'}]
 internal.lanes=[{device:{device:'GPU'},enabled:false,pending:0,process:{dispose:vi.fn()}}]
 internal.foreground=1
 try{
  expect(manager.runtimeDevices()).toEqual(expect.arrayContaining([
   expect.objectContaining({device:'NPU',state:'unavailable',reason:'Model qualification failed'}),
   expect.objectContaining({device:'GPU',state:'waiting',reason:'Reserved for foreground inference'}),
  ]))
 }finally{manager.dispose()}
})
it('reports embedding admission reasons and supported token limits without hardware probes',()=>{
 const manager=new EmbeddingAcceleration(true),internal=manager as any
 internal.ready={devices:[{device:'NPU',qualified:true,maxTokens:256},{device:'GPU:intel',blockedReason:'Another application is using Intel GPU engines'}]}
 internal.lanes=[{device:'NPU',pending:0,enabled:true,qualified:true,worker:{dispose:vi.fn()}}]
 try{
  expect(manager.runtimeDevices()).toEqual(expect.arrayContaining([
   expect.objectContaining({device:'NPU',state:'ready',reason:expect.stringContaining('256 tokens')}),
   expect.objectContaining({device:'GPU:intel',state:'waiting',reason:'Another application is using Intel GPU engines'}),
  ]))
 }finally{manager.dispose()}
})
it('distinguishes structure VRAM retirement, active work, and foreground reservation',()=>{
 const manager=new StructureV3Manager(),internal=manager as any
 internal.cudaMemoryReduced=true;internal.workers.push({device:'CUDA',busy:true,process:{dispose:vi.fn()}})
 try{
  expect(manager.runtimeDevices()).toEqual(expect.arrayContaining([
   expect.objectContaining({device:'CUDA',state:'running',activeTasks:1}),
   expect.objectContaining({device:'CUDA:1',state:'unavailable',reason:expect.stringContaining('VRAM')}),
  ]))
  internal.foreground=1
  expect(manager.runtimeDevices().find(row=>row.device==='NPU')?.reason).toBe('Reserved for foreground inference')
 }finally{manager.dispose()}
})
