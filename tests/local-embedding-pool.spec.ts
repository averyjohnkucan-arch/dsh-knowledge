import { afterEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({children:[] as Array<{messages:Record<string,unknown>[];kill(signal?:string):boolean}>,running:0,peak:0}))
vi.mock('node:os',async(importOriginal)=>({...await importOriginal<typeof import('node:os')>(),availableParallelism:()=>24,freemem:()=>16*1024**3}))
vi.mock('node:child_process',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('node:child_process')>();const {EventEmitter}=await import('node:events')
 return {...actual,fork:()=>{
  class Child extends EventEmitter {
   messages:Record<string,unknown>[]=[];exitCode:null|number=null;signalCode:null|string=null;connected=true
   unref(){}
   send(message:Record<string,unknown>,callback?:(error:null)=>void){this.messages.push(message);state.running++;state.peak=Math.max(state.peak,state.running);setTimeout(()=>{state.running--;this.emit('message',{protocolVersion:1,id:message.id,operation:'embed',ok:true,vectors:(message.texts as string[]).map(text=>[Number(text),1])})},5);callback?.(null);return true}
   kill(signal='SIGKILL'){if(this.signalCode)return false;this.signalCode=signal;queueMicrotask(()=>{this.emit('exit',null,signal);this.emit('close',null,signal)});return true}
  }
  const child=new Child();state.children.push(child);return child
 }}
})
import { LocalEmbeddingPool } from '../src/knowledge/local-embedding-pool.js'
afterEach(()=>{state.children=[];state.running=0;state.peak=0})
describe('independent embedding processes',()=>{
 it('executes bulk work in parallel processes and reassembles vectors in original order',async()=>{
  const pool=new LocalEmbeddingPool();pool.configure({threads:8,instances:2,microBatch:1},0)
  try{expect(await pool.embed('model','cache',['0','1','2','3','4'],'mean')).toEqual([[0,1],[1,1],[2,1],[3,1],[4,1]])
   expect(state.children).toHaveLength(2);expect(state.peak).toBe(2)
   for(const child of state.children)expect(child.messages[0].cpuTuning).toEqual({threads:8,instances:1,microBatch:1})
   await pool.embed('model','cache',['5','6'],'mean');expect(state.children).toHaveLength(2)
  }finally{await pool.dispose()}
 })
 it('drains requests before changing the number of instances',async()=>{
  const pool=new LocalEmbeddingPool();pool.configure({threads:8,instances:2},0)
  try{await pool.embed('model','cache',['0','1'],'mean');pool.configure({threads:16,instances:1},0);expect(await pool.embed('model','cache',['2','3'],'mean')).toEqual([[2,1],[3,1]]);expect(state.children).toHaveLength(3)}finally{await pool.dispose()}
 })
})
