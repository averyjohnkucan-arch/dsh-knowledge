import { fork, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'

let running=0
const queued=new Set<()=>void>(), children=new Set<ChildProcess>()
const capacity=Math.max(1,Math.min(4,Math.floor(availableParallelism()/4)))
export async function disposeOcrRenderers():Promise<void>{
  await Promise.all([...children].map(child=>new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGKILL')})))
}
/** Returns false only when the optional compiled worker is absent. Never mask a partial render as success. */
export async function streamOcrRasters(bytes:Uint8Array,pages:readonly number[]|undefined,
  limits:{maxPages:number;pageBytes:number;totalBytes:number;maxDimension:number;timeoutMs:number;window:number},
  consume:(page:number,png:Buffer)=>Promise<void>,
  modulePath=fileURLToPath(new URL('./ocr-render-process.mjs',import.meta.url))):Promise<boolean>{
  if(!existsSync(modulePath))return false
  while(running>=capacity)await new Promise<void>(resolve=>{const wake=()=>{queued.delete(wake);resolve()};queued.add(wake)})
  running++
  try {
    await new Promise<void>((resolve,reject)=>{
      const child=fork(modulePath,[],{execArgv:[],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{...process.env,CUDA_VISIBLE_DEVICES:'',ELECTRON_RUN_AS_NODE:'1'}})
      children.add(child)
      let settled=false
      const finish=(error?:Error)=>{
        if(settled)return;settled=true;clearTimeout(timer)
        child.kill('SIGKILL')
        // Observe exit before allowing the next PDF to use this render slot.
        child.once('exit',()=>error?reject(error):resolve())
      }
      const timer=setTimeout(()=>finish(Error('OCR page rendering timed out')),limits.timeoutMs)
      child.on('message',(value:any)=>{
        if(settled)return
        if(value?.type==='page'&&Number.isInteger(value.page)&&value.png instanceof Uint8Array){
          void consume(value.page,Buffer.from(value.png)).then(()=>{if(!settled&&child.connected)child.send({type:'ack'},error=>{if(error)finish(error)})},error=>finish(error instanceof Error?error:Error(String(error))))
        }else if(value?.type==='done')finish()
        else if(value?.type==='error')finish(Object.assign(Error(String(value.message)),{code:'ocr_incomplete'}))
        else finish(Error('Invalid OCR renderer response'))
      })
      child.once('error',error=>{if(child.pid===undefined){settled=true;clearTimeout(timer);children.delete(child);reject(error)}else finish(error)})
      child.once('exit',(code,signal)=>{children.delete(child);if(!settled){settled=true;clearTimeout(timer);reject(Error(`OCR renderer exited (${signal??code})`))}})
      child.send({type:'render',bytes,pages,...limits,window:Math.max(1,Math.min(8,limits.window))},error=>{if(error)finish(error)})
    })
    return true
  }finally{running--;for(const wake of queued)wake()}
}
