import { fork, type ChildProcess } from 'node:child_process'
import { availableParallelism, freemem } from 'node:os'
import { fileURLToPath } from 'node:url'
import { resolveEmbeddingCpuTuning, type EmbeddingCpuTuning } from './embedding-tuning.js'
import { isLocalEmbedResponse } from './embed-protocol.js'
interface Lane { child?: ChildProcess; tail: Promise<unknown>; pending: number }
export class LocalEmbeddingPool {
  private desired: Partial<EmbeddingCpuTuning> = {}; private active = ''; private lanes: Lane[] = []; private generation = 0; private sequence = 0
  private configuring?: Promise<void>; private idle?: ReturnType<typeof setTimeout>; private idleMs=60_000
  configure(tuning: Partial<EmbeddingCpuTuning>, idleMs = this.idleMs):void{this.desired=tuning;this.idleMs=idleMs}
  private async ready():Promise<EmbeddingCpuTuning>{
    const tuning=resolveEmbeddingCpuTuning(this.desired,availableParallelism(),freemem());const key=JSON.stringify(tuning)
    if(this.configuring)await this.configuring
    if(this.active!==key){
      this.configuring=(async()=>{await Promise.all(this.lanes.map(l=>l.tail));await this.dispose();this.active=key;this.lanes=Array.from({length:tuning.instances},()=>({tail:Promise.resolve(),pending:0}))})()
      try{await this.configuring}finally{this.configuring=undefined}
    }
    return tuning
  }
  private worker(lane:Lane):ChildProcess{
    if(lane.child)return lane.child
    const child=fork(fileURLToPath(new URL('./embed-process.mjs',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,CUDA_VISIBLE_DEVICES:'',HIP_VISIBLE_DEVICES:'',ROCR_VISIBLE_DEVICES:''},execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type')&&!arg.startsWith('--inspect'))})
    lane.child=child;child.unref();child.on('error',()=>{});return child
  }
  private request(lane:Lane,payload:Record<string,unknown>):Promise<number[][]>{
    const child=this.worker(lane),id=++this.sequence
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);child.off('message',message);child.off('exit',exit);child.off('error',error)}
      const fail=(reason:Error)=>{cleanup();if(lane.child===child)lane.child=undefined;child.kill('SIGKILL');reject(reason)}
      const error=(reason:Error)=>fail(reason)
      const exit=()=>fail(new Error('local embedding process exited'))
      const message=(raw:unknown)=>{
        if(!raw||typeof raw!=='object'||(raw as {id?:number}).id!==id)return
        if(!isLocalEmbedResponse(raw)||raw.operation!=='embed'){fail(Error('Invalid embedding pool response'));return}
        if(!raw.ok){fail(Error('local embedding process failed: '+raw.error.message));return}
        const vectors=raw.vectors,expected=(payload.texts as string[]).length
        if(!Array.isArray(vectors)||vectors.length!==expected||vectors.some(v=>!Array.isArray(v)||!v.length||v.some(x=>!Number.isFinite(x)))){fail(Error('Invalid embedding pool vectors'));return}
        cleanup();resolve(vectors)
      }
      const timer=setTimeout(()=>fail(Error('local embedding process timed out')),120_000);timer.unref?.()
      child.on('message',message);child.once('exit',exit);child.once('error',error)
      try{child.send({...payload,protocolVersion:1,id,operation:'embed'},error=>{if(error)fail(error)})}catch(reason){fail(reason instanceof Error?reason:Error(String(reason)))}
    })
  }
  async embed(modelId:string,cacheDir:string,texts:readonly string[],pooling:string,hfEndpoint?:string):Promise<number[][]>{
    if(this.idle){clearTimeout(this.idle);this.idle=undefined}
    const tuning=await this.ready(),generation=this.generation
    const jobs=[...this.lanes].sort((a,b)=>a.pending-b.pending).slice(0,Math.min(this.lanes.length,texts.length)).map((lane,laneIndex,lanes)=>{
      const indices=Array.from({length:texts.length},(_,i)=>i).filter(i=>i%lanes.length===laneIndex);lane.pending++
      const promise=lane.tail.then(async()=>{
        if(this.generation!==generation)throw Error('Embedding pool configuration changed')
        const vectors=await this.request(lane,{modelId,cacheDir,texts:indices.map(i=>texts[i]),pooling,hfEndpoint,cpuTuning:{threads:tuning.threads,instances:1,microBatch:tuning.microBatch}})
        return indices.map((index,i)=>({index,vector:vectors[i]}))
      }).finally(()=>{lane.pending--})
      lane.tail=promise.catch(()=>{});return promise
    })
    try{
      const settled=await Promise.allSettled(jobs);const failure=settled.find(r=>r.status==='rejected');if(failure?.status==='rejected')throw failure.reason
      const result:number[][]=new Array(texts.length);for(const r of settled)if(r.status==='fulfilled')for(const item of r.value)result[item.index]=item.vector
      if(result.some(v=>v.length!==result[0].length))throw Error('Inconsistent embedding pool dimensions')
      return result
    }finally{
      if(this.idleMs>0&&!this.lanes.some(l=>l.pending)){this.idle=setTimeout(()=>{void this.dispose()},this.idleMs);this.idle.unref?.()}
    }
  }
  async dispose():Promise<void>{
    this.generation++;if(this.idle)clearTimeout(this.idle);this.idle=undefined;this.active=''
    const lanes=this.lanes;this.lanes=[]
    await Promise.all(lanes.map(async lane=>{const child=lane.child;lane.child=undefined;if(!child||child.exitCode!==null||child.signalCode!==null)return
      await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve()},1000);child.once('close',()=>{clearTimeout(timer);resolve()});child.kill('SIGKILL')})
    }))
  }
}
export const localEmbeddingPool=new LocalEmbeddingPool()
