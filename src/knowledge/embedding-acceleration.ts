import { IntelEmbeddingAvailability, nvidiaEmbeddingAvailability } from './embedding-device-availability.js'
import { EmbeddingBatcher } from './embedding-batcher.js'
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
export const FP16_EMBEDDING_MODEL = 'dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated'
export const OPENVINO_EMBEDDING_MODEL = 'OpenVINO/Qwen3-Embedding-0.6B-int8-ov'
interface Device { maxTokens?: number; device: string; name?: string; qualified: boolean; medianMs?: number; minimumCosine?: number; error?: string; blockedReason?: string }
interface Lane { extraWorkers?: StructureProcess[]; qualified?: boolean; device: string; worker: StructureProcess; pending: number; enabled: boolean; tail: Promise<unknown>; current?: Promise<unknown>; milliseconds: number; batcher?: EmbeddingBatcher; jobs?: Set<Promise<unknown>> }
export interface EmbeddingAccelerationStatus { status: 'not_installed'|'installing'|'ready'|'error'; message: string; devices: Device[] }
const script = (name: string) => fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url))
const exec = promisify(execFile)
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
export class EmbeddingAcceleration {
  constructor(private readonly fp16 = false) {}
  private cache = ''; private lanes: Lane[] = []; private ready?: EmbeddingAccelerationStatus; private setup?: Promise<void>; private setupChild?: ChildProcess
  private readonly intelAvailability = new IntelEmbeddingAvailability()
  private used = false; private foreground = 0; private timer?: ReturnType<typeof setInterval>; private checking = false; private polling = false; private stopped = false
  private warming?: Promise<void>; private warmed = false; private reference?:Promise<number[][]>; private gpuRetryAt=new Map<string,number>()
  private igpuAllowed = true; private mainGpuAllowed = true; private mainGpuCopies = 1; private gpuTried = new Set<string>(); private threads = 8; private cpuInstances = 1; private tuningKey = ''; private needsReload = false
  configure(cache: string, options: { localEmbeddingThreads?: number; localEmbeddingInstances?: number; localEmbeddingIgpuIdle?: boolean; localEmbeddingMainGpuIdle?: boolean } = {}): void {
    if (this.cache && this.cache !== cache) { this.release(); this.gpuTried.clear(); this.ready = undefined }
    this.cache = cache; this.stopped = false
    const tuning=resolveEmbeddingCpuTuning({threads:options.localEmbeddingThreads,instances:options.localEmbeddingInstances},availableParallelism(),freemem())
    const key=JSON.stringify([tuning.threads,tuning.instances]);if(this.tuningKey&&key!==this.tuningKey)this.needsReload=true
    this.tuningKey=key;this.threads=tuning.threads;this.cpuInstances=tuning.instances
    this.igpuAllowed = options.localEmbeddingIgpuIdle !== false; this.mainGpuAllowed = options.localEmbeddingMainGpuIdle !== false
  }
  get snapshot(): EmbeddingAccelerationStatus { return this.ready ?? {status:'not_installed',message:'OpenVINO embedding is not installed',devices:[]} }
  private root(): string { return join(this.cache, this.fp16 ? 'embedding-fp16-accelerators' : 'embedding-accelerators') }
  private models(): string { return this.fp16 ? join(this.root(), 'models') : join(this.root(),'models','qwen3-openvino-int8') }
  private runtime(): string { return join(this.cache,'ocr-accelerators') }
  private python(): string { return join(this.runtime(),'venv',process.platform==='win32'?'Scripts/python.exe':'bin/python') }
  private environment(main = false): NodeJS.ProcessEnv {
    const root=this.runtime(), libraries=join(root,'intel/usr/lib/x86_64-linux-gnu')
    const env: NodeJS.ProcessEnv={...process.env,CUDA_VISIBLE_DEVICES:'',HIP_VISIBLE_DEVICES:'',ROCR_VISIBLE_DEVICES:'',PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1'}
    if(main && this.fp16) delete env.CUDA_VISIBLE_DEVICES
    if(process.platform==='linux') {
      env.LD_LIBRARY_PATH=[libraries,join(libraries,'intel-opencl'),join(root,'intel/usr/local/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
      env.ZE_ENABLE_ALT_DRIVERS=join(libraries,'libze_intel_npu.so.1')
      if(main && this.fp16) delete env.CUDA_VISIBLE_DEVICES
      if(main && this.fp16) env.LD_LIBRARY_PATH=[join(this.cache,'embedding-gpu-runtime','venv','lib','python3.12','site-packages','nvidia','cublas','lib'),join(this.cache,'embedding-gpu-runtime','venv','lib','python3.12','site-packages','nvidia','cu13','lib'),join(this.cache,'embedding-gpu-runtime','venv','lib','python3.12','site-packages','nvidia','cudnn','lib'),env.LD_LIBRARY_PATH].join(':')
      if(!main) env.OCL_ICD_VENDORS=join(root,'icd'); else delete env.OCL_ICD_VENDORS
    }
    return env
  }
  private lane(device: string, ms: number, main = false): Lane {
    const python = this.fp16 && main ? join(this.cache,'embedding-gpu-runtime','venv',process.platform==='win32'?'Scripts/python.exe':'bin/python') : this.python()
    const makeWorker = () => new StructureProcess(python,[script(this.fp16 ? 'embedding-fp16-worker.py' : 'embedding-accelerator-worker.py'),'--models',this.models(),'--device',this.fp16 && main ? 'CUDA' : device,'--threads',String(this.threads),...(device.startsWith('GPU')?['--vendor',main?'nvidia':'intel']:[])],this.environment(main),'DSH_EMBED_RESULT ')
    const worker=makeWorker()
    const lane: Lane = { device, pending:0, enabled:true, milliseconds:ms, tail:Promise.resolve(), worker }
    lane.extraWorkers=this.fp16&&main?Array.from({length:this.mainGpuCopies-1},makeWorker):[]
    const workers=[worker,...lane.extraWorkers]
    lane.jobs = new Set()
    lane.batcher = new EmbeddingBatcher(async texts => {
      const rowsPerWorker=Math.ceil(texts.length/workers.length)
      const results=await Promise.all(workers.slice(0,texts.length).map((current,index)=>current.request(this.fp16&&main
        ? {texts:texts.slice(index*rowsPerWorker,(index+1)*rowsPerWorker)} : {text:texts[0]},120_000)))
      const vectors=results.flatMap(result=>this.fp16&&main?result.vectors as number[][]:[result.vector as number[]])
      if (!Array.isArray(vectors)) throw new Error('Invalid embedding vectors')
      return {vectors,elapsedMs:Math.max(...results.map(result=>typeof result.elapsedMs==='number'?result.elapsedMs:100))}
    }, this.fp16 && main ? 16*workers.length : 1)
    return lane
  }
  async status(): Promise<EmbeddingAccelerationStatus> {
    if(this.needsReload&&!this.lanes.some(l=>l.pending)){this.release();this.ready=undefined;this.needsReload=false}
    if(this.ready) return this.ready
    try {
      const receipt=JSON.parse(await readFile(join(this.root(),'ready.json'),'utf8')) as {schema:number;format?:string;modelId:string;devices:Device[]}
      if(receipt.schema!==1||this.fp16&&receipt.format!=='canonical-fp16-v1'||receipt.modelId!==(this.fp16 ? FP16_EMBEDDING_MODEL : OPENVINO_EMBEDDING_MODEL)||!receipt.devices.some(d=>d.device==='CPU'&&d.qualified))throw Error('Missing qualified CPU fallback')
      this.lanes=receipt.devices.filter(d=>d.qualified&&['CPU','NPU'].includes(d.device)).flatMap(d=>Array.from({length:d.device==='CPU'?this.cpuInstances:1},()=>this.lane(d.device,d.medianMs??150)))
      this.ready={status:'ready',message:this.fp16 ? 'One FP16 vector space across CPU, NPU, Intel iGPU and optional NVIDIA CUDA. GPU workers yield for foreground inference.' : 'OpenVINO CPU/NPU model; separate vector space from the ONNX model. GPU workers require verified idle state and matching vectors.',devices:receipt.devices}
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
      await this.command([script(this.fp16 ? 'setup-embedding-fp16.py' : 'setup-embedding-accelerators.py'),this.cache],python)
      await this.command([script(this.fp16 ? 'embedding-fp16-worker.py' : 'embedding-accelerator-worker.py'),'--models',this.models(),'--calibrate','--threads',String(this.threads)])
      this.release();this.gpuTried.clear();this.ready=undefined;await this.status()
    })().catch(error=>{this.ready={status:'error',message:String(error),devices:[]}}).finally(()=>{this.setup=undefined})
    return this.ready
  }
  private async run(lane:Lane,text:string,purpose: 'query'|'index' = 'index'):Promise<number[]> {
    lane.pending++
    if (lane.batcher) {
      if (!lane.enabled) { lane.pending--; throw Error('Embedding device yielded') }
      const job = lane.batcher.request(text,purpose).then(result => {
        if (result.vector.length !== 1024 || result.vector.some(v=>!Number.isFinite(v)) || Math.abs(Math.hypot(...result.vector)-1)>.001) throw Error('Invalid embedding vector')
        lane.milliseconds = Math.max(1,result.elapsedMs); return result.vector
      }).catch(error => { if (!lane.enabled) throw Error('Embedding device yielded'); throw error })
      lane.jobs!.add(job); lane.current = Promise.allSettled([...lane.jobs!])
      try { return await job } finally { lane.pending--; lane.jobs!.delete(job) }
    }
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
  async warm():Promise<void>{
    if(this.warmed)return
    if(this.warming)return this.warming
    this.warming=(async()=>{
      if((await this.status()).status!=='ready')throw Error('Embedding model is not installed and validated')
      const text='A telescope collects light from distant stars and records scientific observations. '.repeat(10)
      await Promise.all(this.lanes.filter(l=>!l.device.startsWith('GPU')).map(async lane=>{
        try {await this.run(lane,text);await this.run(lane,text)}
        catch(error){if(lane.device==='CPU')throw error;lane.enabled=false;lane.worker.dispose();const state=this.ready?.devices.find(d=>d.device===lane.device);if(state){state.qualified=false;state.error='Device warmup failed; using CPU'}}
      }))
      this.warmed=true
    })().finally(()=>{this.warming=undefined})
    return this.warming
  }
  async embed(texts:readonly string[], purpose: 'query'|'index' = 'index'):Promise<number[][]> {
    if((await this.status()).status!=='ready')throw Error('OpenVINO embedding model is not installed and validated')
    if(purpose==='index')await this.warm()
    this.used = true
    if(!this.timer){this.timer=setInterval(()=>{void this.updateGpus()},1000);this.timer.unref?.()}
    return await Promise.all(texts.map(async text=>{
      let chosen:Lane|undefined
      while(!chosen) {
        if(this.stopped)throw Error('Embedding worker stopped')
        const eligible=this.lanes.filter(l=>l.enabled&&l.qualified!==false&&(!l.device.startsWith('GPU')||purpose==='index'&&!this.foreground))
        if(!eligible.length)throw Error('No embedding device is available')
        // Leave bulk work unassigned until a lane has capacity. Eagerly queuing
        // an entire document behind a slow CPU/NPU creates a long tail while
        // faster devices sit idle. CUDA retains enough rows for two batches.
        const choices=eligible.filter(l=>purpose==='query'||l.pending<(l.device==='GPU:main'&&this.fp16?32*(1+(l.extraWorkers?.length??0)):1)).sort((a,b)=>{
          const ap=purpose==='query'&&a.device==='NPU',bp=purpose==='query'&&b.device==='NPU'
          return ap!==bp?(ap?-1:1):(a.pending+1)*a.milliseconds-(b.pending+1)*b.milliseconds
        })
        chosen=choices[0]
        if(!chosen)await Promise.race(eligible.map(l=>l.current??l.tail)).catch(()=>{})
      }
      try{return await this.run(chosen,text,purpose)}catch(error){
        if(chosen.device==='CPU')throw error
        if(!String(error).includes('NPU_LONG_INPUT') && !String(error).includes('yield')) {chosen.enabled=false;chosen.worker.dispose();chosen.extraWorkers?.forEach(worker=>worker.dispose());const state=this.ready?.devices.find(d=>d.device===chosen.device);if(state){state.qualified=false;state.error='Device failed at runtime; using CPU until revalidation'}}
        const cpu=this.lanes.filter(l=>l.device==='CPU').sort((a,b)=>a.pending-b.pending)[0]
        if(!cpu)throw error;return await this.run(cpu,text,purpose)
      }
    }))
  }
  private async stopGpu(lane:Lane):Promise<void>{
    lane.enabled=false
    lane.batcher?.pause()
    let timer:ReturnType<typeof setTimeout>|undefined
    try{await Promise.race([lane.current??Promise.resolve(),new Promise<void>(resolve=>{timer=setTimeout(resolve,10_000)})]).catch(()=>{})}finally{if(timer)clearTimeout(timer);await Promise.all([lane.worker,...lane.extraWorkers??[]].map(worker=>worker.stopAndWait()))}
  }
  async enterForeground():Promise<()=>void>{this.foreground++;try{await Promise.all(this.lanes.filter(l=>l.device.startsWith('GPU')).map(l=>this.stopGpu(l)))}catch(error){this.foreground--;throw error}let done=false;return()=>{if(!done){done=true;this.foreground--}}}
  private async updateGpus():Promise<void>{
    if(this.stopped||!this.used||this.ready?.status!=='ready')return
    if(this.foreground){await Promise.all(this.lanes.filter(l=>l.device.startsWith('GPU')&&l.enabled).map(l=>this.stopGpu(l)));return}
    if(this.polling)return
    this.polling=true
    const decisions=new Map<boolean,{available:boolean;reason:string;freeMiB?:number}>()
    try {
      const idle=await desktopIdle()
      const desktopAvailable=idle.idleSeconds!==null&&Number.isFinite(idle.idleSeconds)&&idle.idleSeconds>=300
      const owned=()=>new Set(this.lanes.flatMap(l=>[l.worker,...l.extraWorkers??[]]).map(worker=>worker.pid).filter((pid):pid is number=>pid!==undefined))
      for(const main of [false,true]) {
        let decision:{available:boolean;reason:string;freeMiB?:number}={available:desktopAvailable,reason:desktopAvailable?'Desktop is idle':'Waiting for desktop idle'}
        if(this.fp16) {
          if(main) {
            decision=await nvidiaEmbeddingAvailability(owned)
            if(process.platform!=='linux'&&!desktopAvailable)decision={available:false,reason:'Waiting for verified desktop idle'}
          } else if(process.platform==='linux') decision=await this.intelAvailability.sample(owned())
        }
        if(main?!this.mainGpuAllowed:!this.igpuAllowed)decision={available:false,reason:'Disabled in embedding settings'}
        if(this.foreground||this.stopped)decision.available=false
        decisions.set(main,decision)
        const current=this.lanes.find(l=>l.device===`GPU:${main?'main':'intel'}`)
        if(!decision.available&&current?.enabled)await this.stopGpu(current)
      }
    }finally{this.polling=false}
    // Activity monitoring above continues while a device is being compiled or
    // calibrated; qualification must never block a foreground yield.
    if(this.checking||this.stopped)return
    this.checking=true
    try {
      for(const main of [true,false]){
        const key=main?'main':'intel', device=`GPU:${key}`
        const existing=this.lanes.find(l=>l.device===device)
        const decision=decisions.get(main)!
        let available=decision.available,reason=decision.reason
        if(this.foreground||this.stopped)available=false
        let state=this.ready?.devices.find(d=>d.device===device || !main&&d.device==='GPU')
        if(!state) {state={device,name:main?'NVIDIA GPU':'Intel iGPU',qualified:false};this.ready!.devices.push(state)}
        state.blockedReason=available?undefined:reason
        if(!available){if(existing?.enabled)await this.stopGpu(existing);continue}
        if(main&&!this.fp16){try{const {stdout}=await exec('nvidia-smi',['--query-compute-apps=pid','--format=csv,noheader,nounits'],{timeout:2000});if(stdout.split(/\s+/).filter(Boolean).some(pid=>Number(pid)!==existing?.worker.pid)){if(existing?.enabled)await this.stopGpu(existing);continue}}catch{continue}}
        if(existing){existing.enabled=true;existing.batcher?.resume();continue}
        if(this.gpuTried.has(key)||(this.gpuRetryAt.get(key)??0)>Date.now())continue
        this.gpuTried.add(key)
        if(main&&this.fp16)this.mainGpuCopies=(decision.freeMiB??0)>=8192?2:1
        const candidate=this.lane('GPU',main?50:200,main);candidate.device=device;candidate.qualified=false
        this.lanes.push(candidate)
        try{
          const texts=['A telescope collects light from distant stars.','An invoice is required before expense reimbursement. '.repeat(12),'Ocean temperatures influence weather and climate. '.repeat(40)]
          const cpu=this.lanes.find(l=>l.device==='CPU')!
          this.reference??=Promise.all(texts.map(text=>this.run(cpu,text,'query')))
          const [references,vectors]=await Promise.all([this.reference,Promise.all(texts.map(text=>this.run(candidate,text)))])
          if(this.foreground||this.stopped||!candidate.enabled)throw Error('Embedding device yielded during validation')
          let cosine=Math.min(...references.map((a,index)=>a.reduce((sum,v,i)=>sum+v*vectors[index][i],0)))
          if(main&&this.fp16) {
            // Initialize both CUDA workers and measure full batches before
            // admitting bulk work. A single cold request otherwise makes the
            // scheduler underestimate GPU throughput and queue work on CPUs.
            const warmInputs=texts.flatMap(text=>Array.from({length:32},()=>text))
            const warm=await Promise.all(warmInputs.map(text=>this.run(candidate,text)))
            cosine=Math.min(cosine,...warm.map((b,index)=>references[Math.floor(index/32)].reduce((sum,v,i)=>sum+v*b[i],0)))
          }
          if(cosine<.995)throw Error('GPU embedding vectors did not match CPU reference')
          candidate.qualified=true
          const result:Device={device,name:main?`NVIDIA GPU (${this.mainGpuCopies} worker${this.mainGpuCopies>1?'s':''}, available only)`:'Intel iGPU (available only)',qualified:true,minimumCosine:cosine,medianMs:candidate.milliseconds}
          if(state)Object.assign(state,result);else this.ready!.devices.push(result)
        }catch(error){
          await this.stopGpu(candidate);this.lanes=this.lanes.filter(l=>l!==candidate)
          if(String(error).includes('yield')){this.gpuTried.delete(key);this.gpuRetryAt.set(key,Date.now()+15_000)}
          else if(state)Object.assign(state,{qualified:false,error:String(error)})
          else this.ready?.devices.push({device,qualified:false,error:String(error)})
        }
      }
    }finally{this.checking=false}
  }
  async remove():Promise<void>{this.dispose();const {rm}=await import('node:fs/promises');await rm(this.root(),{recursive:true,force:true});this.ready=undefined;this.stopped=false}
  release():void{this.warmed=false;this.reference=undefined;for(const lane of this.lanes){lane.batcher?.pause();lane.worker.dispose();lane.extraWorkers?.forEach(worker=>worker.dispose())}this.lanes=[]}
  dispose():void{this.stopped=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;this.setupChild && stopOwnedProcess(this.setupChild);this.release()}
}
export const embeddingAcceleration=new EmbeddingAcceleration()

export const embeddingFp16Acceleration = new EmbeddingAcceleration(true)
