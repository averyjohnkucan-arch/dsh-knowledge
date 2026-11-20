import {expect,it,vi} from 'vitest'
import {IMPORT_STAGES,runImportStages} from '../src/knowledge/import-stages.js'
it('drains all documents before advancing and respects per-stage capacity',async()=>{
 const items=Array.from({length:9},(_,i)=>({id:String(i)}))
 const done=new Map<string,Set<string>>(),active=new Map<string,number>(),peaks=new Map<string,number>()
 const result=await runImportStages({items,signal:new AbortController().signal,concurrency:stage=>stage==='ocr'?3:2,
  execute:async(stage,item)=>{
   const previous=IMPORT_STAGES[IMPORT_STAGES.indexOf(stage)-1]
   if(previous)expect(done.get(previous)?.size).toBe(items.length)
   const count=(active.get(stage)??0)+1;active.set(stage,count);peaks.set(stage,Math.max(count,peaks.get(stage)??0))
   await new Promise(resolve=>setTimeout(resolve,2))
   const complete=done.get(stage)??new Set();complete.add(item.id);done.set(stage,complete);active.set(stage,active.get(stage)!-1)
  }})
 expect(result.completed).toHaveLength(9);expect(result.failures).toEqual([])
 expect(peaks.get('ocr')).toBeLessThanOrEqual(3)
 for(const stage of IMPORT_STAGES.slice(1))expect(peaks.get(stage)).toBeLessThanOrEqual(2)
})
it('does not run later stages for a failed document, but finishes healthy ones',async()=>{
 const execute=vi.fn(async(stage:string,item:{id:string})=>{if(stage==='parsing'&&item.id==='bad')throw new Error('failed')})
 const result=await runImportStages({items:[{id:'bad'},{id:'good'}],signal:new AbortController().signal,concurrency:()=>2,execute})
 expect(result.completed).toEqual(['good']);expect(result.failures).toMatchObject([{id:'bad',stage:'parsing'}])
 expect(execute.mock.calls.filter(([stage,item])=>item.id==='bad').map(([stage])=>stage)).toEqual(['ocr','parsing'])
})
it('drains in-flight writes before reporting cancellation and never starts another stage',async()=>{
 const controller=new AbortController();let finish!:()=>void
 const execute=vi.fn(async()=>{await new Promise<void>(resolve=>{finish=resolve})})
 const run=runImportStages({items:[{id:'a'},{id:'b'}],signal:controller.signal,concurrency:()=>1,execute})
 await vi.waitFor(()=>expect(execute).toHaveBeenCalledOnce())
 let settled=false;void run.catch(()=>{settled=true})
 controller.abort();await Promise.resolve();expect(settled).toBe(false)
 finish();await expect(run).rejects.toThrow();expect(execute).toHaveBeenCalledOnce()
})
it('rejects duplicate document identities before executing work',async()=>{
 const execute=vi.fn()
 await expect(runImportStages({items:[{id:'a'},{id:'a'}],signal:new AbortController().signal,concurrency:()=>1,execute})).rejects.toThrow('Duplicate')
 expect(execute).not.toHaveBeenCalled()
})
