/** Read-only replay of PDF parsing/OCR; never indexes or changes KB settings. */
import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { homedir } from 'node:os'
import { parseDocumentBuffer, disposePdfParsers } from '../../src/knowledge/parse.js'
import { setLocalModelCacheDir } from '../../src/knowledge/embed.js'
import { OcrAcceleration } from '../../src/knowledge/ocr-acceleration.js'
import { OcrPool, useOcrAcceleration } from '../../src/knowledge/ocr-pool.js'
import { disposeOcrWorker } from '../../src/knowledge/ocr.js'
const [root, output, parallelArg='8', limitArg='0'] = process.argv.slice(2)
if (!root || !output) throw Error('Usage: replay <corpus directory> <output JSON> [document concurrency] [limit]')
await mkdir(dirname(output), {recursive:true})
setLocalModelCacheDir(process.env.DSH_MODEL_CACHE ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cache/dsh-knowledge/local-models'))
const manager = new OcrAcceleration(), internal = manager as any
manager.configure({localOcrGpuWorkers:Number(process.env.DSH_BENCH_GPU_WORKERS ?? '8')})
// Experimental counts above the shipping cap are benchmark-only.
if(Number(process.env.DSH_BENCH_GPU_WORKERS)>8)internal.gpuWorkers=Math.min(16,Number(process.env.DSH_BENCH_GPU_WORKERS))
const pages: any[] = [], docs: any[] = []
let ocrPages=0, ocrStarted:number|undefined, ocrFinished:number|undefined
const recognize=OcrPool.prototype.recognize
OcrPool.prototype.recognize=async function(...args:Parameters<OcrPool['recognize']>){ocrStarted ??= performance.now();const result=await recognize.apply(this,args);ocrPages++;ocrFinished=performance.now();return result}
// Instrument the actual production requests, including CPU qualification and retries.
const makeLane=internal.makeLane.bind(manager)
internal.makeLane=(device:any)=>{
 const lane=makeLane(device),request=lane.process.request.bind(lane.process)
 if(device.device==='CPU' && process.env.DSH_BENCH_CPU_THREADS){lane.process.args[lane.process.args.indexOf('--threads')+1]=process.env.DSH_BENCH_CPU_THREADS;lane.process.env.OMP_NUM_THREADS=process.env.DSH_BENCH_CPU_THREADS}
 lane.process.request=async(...args:any[])=>{
  const start=performance.now()
  try{const result=await request(...args);pages.push({device:device.device,ms:performance.now()-start,inferenceMs:result.elapsedMs,chars:String(result.text??'').length});return result}
  catch(error){pages.push({device:device.device,ms:performance.now()-start,error:String(error)});throw error}
 }
 return lane
}
await manager.status()
if(process.env.DSH_BENCH_CPU_WORKERS){
 const wanted=Number(process.env.DSH_BENCH_CPU_WORKERS),cpus=internal.lanes.filter((lane:any)=>lane.device.device==='CPU')
 const template=cpus[0]?.device
 while(cpus.length>wanted){const lane=cpus.pop();internal.lanes.splice(internal.lanes.indexOf(lane),1);lane.process.dispose()}
 while(cpus.length<wanted){const lane=internal.makeLane(template);internal.lanes.push(lane);cpus.push(lane)}
}
for(const [device,key] of [['NPU','DSH_BENCH_NPU_WORKERS'],['GPU','DSH_BENCH_IGPU_WORKERS']]){
 const count=Math.max(1,Math.min(2,Number(process.env[key]??'1'))),template=internal.lanes.find((lane:any)=>lane.device.device===device)?.device
 if(template)for(let i=1;i<count;i++)internal.lanes.push(internal.makeLane(template))
}
useOcrAcceleration(manager)
const files:string[]=[]
async function walk(dir:string):Promise<void>{for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(item.isDirectory())await walk(join(dir,item.name));else if(/\.pdf$/i.test(item.name))files.push(join(dir,item.name))}}
await walk(root)
if(Number(limitArg)>0)files.splice(Number(limitArg))
const manifest=createHash('sha256')
for(const file of files){manifest.update(relative(root,file));manifest.update(await readFile(file))}
let next=0;const started=performance.now();let peakRss=0
const monitor=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss)},200)
let saveTail:Promise<void>=Promise.resolve()
async function save(){const snapshot=JSON.stringify({environment:{gpuWorkers:process.env.DSH_BENCH_GPU_WORKERS??'8',cpuWorkers:process.env.DSH_BENCH_CPU_WORKERS??'auto',cpuThreads:process.env.DSH_BENCH_CPU_THREADS??'auto',npuWorkers:process.env.DSH_BENCH_NPU_WORKERS??'1',igpuWorkers:process.env.DSH_BENCH_IGPU_WORKERS??'1'},corpusHash:manifest.copy().digest('hex'),documents:files.length,completed:docs.length,parallel:Number(parallelArg),seconds:(performance.now()-started)/1000,hostPeakRss:peakRss,ocrPages,ocrSpanSeconds:ocrStarted===undefined?0:((ocrFinished??performance.now())-ocrStarted)/1000,devices:await manager.status(),requests:pages,results:docs},null,2);saveTail=saveTail.then(async()=>{await writeFile(output+'.tmp',snapshot);await rename(output+'.tmp',output)});await saveTail}
process.once('SIGINT',()=>{void disposeOcrWorker().finally(()=>{manager.dispose();process.exit(130)})})
try{
 await Promise.all(Array.from({length:Math.max(1,Number(parallelArg))},async()=>{for(;;){const file=files[next++];if(!file)return;const start=performance.now();const row:any={file:relative(root,file)};try{const text=await parseDocumentBuffer(await readFile(file),file,'application/pdf');Object.assign(row,{chars:text.length,hash:createHash('sha256').update(text).digest('hex')})}catch(error){row.error=String(error)}row.ms=performance.now()-start;docs.push(row);console.log(JSON.stringify({completed:docs.length,total:files.length,...row}));await save()}}))
}finally{clearInterval(monitor);try{await save()}finally{await disposeOcrWorker();manager.dispose();await disposePdfParsers()}}
console.log(JSON.stringify({output,seconds:(performance.now()-started)/1000,ocrPages,inferenceRequests:pages.length,documents:docs.length}))
process.exit(docs.some(row=>row.error)?1:0)
