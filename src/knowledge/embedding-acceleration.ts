import { availableParallelism, freemem } from 'node:os'
import { resolveEmbeddingCpuTuning } from './embedding-tuning.js'
import { stopOwnedProcess } from './owned-process.js'
import { ensurePrivatePython } from './private-python.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { StructureProcess } from './structure-process.js'
import { desktopIdle } from './resource-policy.js'
export const OPENVINO_EMBEDDING_MODEL = 'OpenVINO/Qwen3-Embedding-0.6B-int8-ov'
interface Device { device: string; name?: string; qualified: boolean; medianMs?: number; minimumCosine?: number; error?: string }
interface Lane { device: string; worker: StructureProcess; pending: number; enabled: boolean; tail: Promise<unknown>; current?: Promise<unknown>; milliseconds: number }
export interface EmbeddingAccelerationStatus { status: 'not_installed'|'installing'|'ready'|'error'; message: string; devices: Device[] }
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
const exec = promisify(execFile)
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
export class EmbeddingAcceleration {
  private cache = ''; private lanes: Lane[] = []; private ready?: EmbeddingAccelerationStatus; private setup?: Promise<void>; private setupChild?: ChildProcess
  private foreground = 0; private timer?: ReturnType<typeof setInterval>; private checking = false; private stopped = false
  private igpuAllowed = true; private mainGpuAllowed = true; private gpuTried = new Set<string>(); private threads = 8; private cpuInstances = 1; private tuningKey = ''; private needsReload = false
  configure(cache: string, options: { localEmbeddingThreads?: number; localEmbeddingInstances?: number; localEmbeddingIgpuIdle?: boolean; localEmbeddingMainGpuIdle?: boolean } = {}): void {
    if (this.cache && this.cache !== cache) { this.release(); this.gpuTried.clear(); this.ready = undefined }
    this.cache = cache; this.stopped = false
    const tuning=resolveEmbeddingCpuTuning({threads:options.localEmbeddingThreads,instances:options.localEmbeddingInstances},availableParallelism(),freemem())
    const key=JSON.stringify([tuning.threads,tuning.instances]);if(this.tuningKey&&key!==this.tuningKey)this.needsReload=true
    this.tuningKey=key;this.threads=tuning.threads;this.cpuInstances=tuning.instances
    this.igpuAllowed = options.localEmbeddingIgpuIdle !== false; this.mainGpuAllowed = options.localEmbeddingMainGpuIdle !== false
  }
  get snapshot(): EmbeddingAccelerationStatus { return this.ready ?? {status:'not_installed',message:'OpenVINO embedding is not installed',devices:[]} }
  private root(): string { return join(this.cache, 'embedding-accelerators') }
  private models(): string { return join(this.root(),'models','qwen3-openvino-int8') }
  private runtime(): string { return join(this.cache,'ocr-accelerators') }
  private python(): string { return join(this.runtime(),'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python') }
  private environment(main = false): NodeJS.ProcessEnv {
    const root=this.runtime(), libraries=join(root,'intel/usr/lib/x86_64-linux-gnu')
    const env: NodeJS.ProcessEnv={...process.env,CUDA_VISIBLE_DEVICES:'',HIP_VISIBLE_DEVICES:'',ROCR_VISIBLE_DEVICES:'',PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1'}
    if(process.platform==='linux') {
      env.LD_LIBRARY_PATH=[libraries,join(libraries,'intel-opencl'),join(root,'intel/usr/local/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
      env.ZE_ENABLE_ALT_DRIVERS=join(libraries,'libze_intel_npu.so.1')
      if(!main) env.OCL_ICD_VENDORS=join(root,'icd'); else delete env.OCL_ICD_VENDORS
    }
    return env
  }
  private lane(device: string, ms: number, main = false): Lane {
    return { device, pending:0, enabled:true, milliseconds:ms, tail:Promise.resolve(), worker:new StructureProcess(this.python(),[script('embedding-accelerator-worker.py'),'--models',this.models(),'--device',device,'--threads',String(this.threads),...(device.startsWith('GPU')?['--vendor',main?'nvidia':'intel']:[])],this.environment(main),'DSH_EMBED_RESULT ') }
  }
  async status(): Promise<EmbeddingAccelerationStatus> {
    if(this.needsReload&&!this.lanes.some(l=>l.pending)){this.release();this.ready=undefined;this.needsReload=false}
    if(this.ready) return this.ready
    try {
      const receipt=JSON.parse(await readFile(join(this.root(),'ready.json'),'utf8')) as {schema:number;modelId:string;devices:Device[]}
      if(receipt.schema!==1||receipt.modelId!==OPENVINO_EMBEDDING_MODEL||!receipt.devices.some(d=>d.device==='CPU'&&d.qualified))throw Error('Missing qualified CPU fallback')
      this.lanes=receipt.devices.filter(d=>d.qualified&&['CPU','NPU'].includes(d.device)).flatMap(d=>Array.from({length:d.device==='CPU'?this.cpuInstances:1},()=>this.lane(d.device,d.medianMs??150)))
      this.ready={status:'ready',message:'OpenVINO CPU/NPU model; separate vector space from the ONNX model. GPU workers require verified idle state and matching vectors.',devices:receipt.devices}
      if(!this.timer){this.timer=setInterval(()=>{void this.updateGpus()},1000);this.timer.unref?.()}
      return this.ready
    } catch {return {status:'not_installed',message:'Download and validate the separate OpenVINO embedding model to enable NPU execution.',devices:[]}}
  }
  private async command(args: string[], command = this.python(), env = this.environment()): Promise<void> {
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});this.setupChild=child;let log='';const timer=setTimeout(()=>stopOwnedProcess(child),7_200_000);timer.unref?.()
      child.stdout.on('data',data=>{log=(log+String(data)).slice(-2000)})
      child.stderr.on('data',data=>{log=(log+String(data)).slice(-2000)})
      child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);this.setupChild=undefined;code===0?resolve():reject(Error(log||'Embedding setup failed'))})
    })
  }
  async prepare(): Promise<EmbeddingAccelerationStatus> {
    if(this.setup)return this.ready!
    this.ready={status:'installing',message:'Installing private runtime, pinned weights, and CPU/NPU validation. No global packages are changed.',devices:[]}
    this.setup=(async()=>{
      const python=await ensurePrivatePython(this.runtime(),(command,args,env)=>this.command(args,command,env))
      await this.command([script('setup-embedding-accelerators.py'),this.cache],python)
      await this.command([script('embedding-accelerator-worker.py'),'--models',this.models(),'--calibrate','--threads',String(this.threads)])
      this.release();this.ready=undefined;await this.status()
    })().catch(error=>{this.ready={status:'error',message:String(error),devices:[]}}).finally(()=>{this.setup=undefined})
    return this.ready
  }
  private async run(lane:Lane,text:string):Promise<number[]> {
    lane.pending++
    const job=lane.tail.then(async()=>{
      if(this.stopped||!lane.enabled)throw Error('Embedding device yielded')
      const promise=lane.worker.request({text},120_000);lane.current=promise
      try {
        const result=await promise;const vector=result.vector
        if(!Array.isArray(vector)||vector.length!==1024||vector.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(Math.hypot(...vector)-1)>.001)throw Error('Invalid OpenVINO vector')
        if(typeof result.elapsedMs==='number')lane.milliseconds=Math.max(1,result.elapsedMs)
        return vector as number[]
      }finally{lane.current=undefined}
    })
    lane.tail=job.catch(()=>{});try{return await job}finally{lane.pending--}
  }
  async embed(texts:readonly string[]):Promise<number[][]> {
    if((await this.status()).status!=='ready')throw Error('OpenVINO embedding model is not installed and validated')
    return await Promise.all(texts.map(async text=>{
      const choices=this.lanes.filter(l=>l.enabled&&(!l.device.startsWith('GPU')||!this.foreground)).sort((a,b)=>(a.pending+1)*a.milliseconds-(b.pending+1)*b.milliseconds)
      const chosen=choices[0];if(!chosen)throw Error('No embedding device is available')
      try{return await this.run(chosen,text)}catch(error){
        if(chosen.device==='CPU')throw error
        if(!String(error).includes('NPU_LONG_INPUT') && !String(error).includes('yield')) {chosen.enabled=false;chosen.worker.dispose();const state=this.ready?.devices.find(d=>d.device===chosen.device);if(state){state.qualified=false;state.error='Device failed at runtime; using CPU until revalidation'}}
        const cpu=this.lanes.filter(l=>l.device==='CPU').sort((a,b)=>a.pending-b.pending)[0]
        if(!cpu)throw error;return await this.run(cpu,text)
      }
    }))
  }
  private async stopGpu(lane:Lane):Promise<void>{
    lane.enabled=false
    let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([lane.current??Promise.resolve(),new Promise<void>(resolve=>{timer=setTimeout(resolve,10_000)})]).catch(()=>{})}finally{if(timer)clearTimeout(timer);await lane.worker.stopAndWait()}
  }
  async enterForeground():Promise<()=>void>{this.foreground++;try{await Promise.all(this.lanes.filter(l=>l.device.startsWith('GPU')).map(l=>this.stopGpu(l)))}catch(error){this.foreground--;throw error}let done=false;return()=>{if(!done){done=true;this.foreground--}}}
  private async updateGpus():Promise<void>{
    if(this.stopped||this.ready?.status!=='ready')return
    const idle=await desktopIdle();const allowed=!this.foreground&&idle.idleSeconds!==null&&Number.isFinite(idle.idleSeconds)&&idle.idleSeconds>=300
    if(!allowed){await Promise.all(this.lanes.filter(l=>l.device.startsWith('GPU')&&l.enabled).map(l=>this.stopGpu(l)));return}
    if(this.checking)return;this.checking=true
    try{
      for(const main of [false,true]){
        const key=main?'main':'intel';const existing=this.lanes.find(l=>l.device===`GPU:${key}`)
        if(main?!this.mainGpuAllowed:!this.igpuAllowed){if(existing?.enabled)await this.stopGpu(existing);continue}
        if(main){try{const {stdout}=await exec('nvidia-smi',['--query-compute-apps=pid','--format=csv,noheader,nounits'],{timeout:2000});const foreign=stdout.split(/\s+/).filter(Boolean).filter(pid=>Number(pid)!==existing?.worker.pid);if(foreign.length){if(existing?.enabled)await this.stopGpu(existing);continue}}catch{continue}}
        if(existing){existing.enabled=true;continue}
        if(this.gpuTried.has(key))continue;this.gpuTried.add(key)
        const candidate=this.lane('GPU',150,main);candidate.device=`GPU:${key}`
        this.lanes.push(candidate)
        try{
          const text='A telescope collects light from distant stars.';const cpu=this.lanes.find(l=>l.device==='CPU')!
          const [a,b]=await Promise.all([this.run(cpu,text),this.run(candidate,text)])
          const cosine=a.reduce((sum,v,i)=>sum+v*b[i],0)
          if(cosine<.995)throw Error('GPU embedding vectors did not match CPU reference')
          this.ready.devices.push({device:candidate.device,name:main?'NVIDIA GPU (idle only)':'Intel iGPU (idle only)',qualified:true,minimumCosine:cosine,medianMs:candidate.milliseconds})
        }catch(error){await this.stopGpu(candidate);this.lanes=this.lanes.filter(l=>l!==candidate);this.ready.devices.push({device:candidate.device,qualified:false,error:String(error)})}
      }
    }finally{this.checking=false}
  }
  async remove():Promise<void>{this.dispose();const {rm}=await import('node:fs/promises');await rm(this.root(),{recursive:true,force:true});this.ready=undefined;this.stopped=false}
  release():void{for(const lane of this.lanes)lane.worker.dispose();this.lanes=[]}
  dispose():void{this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;this.setupChild && stopOwnedProcess(this.setupChild);this.release()}
}
export const embeddingAcceleration=new EmbeddingAcceleration()
