#!/usr/bin/env node
/** Isolated, real-embedding comparison. Never opens the user's knowledge store. */
import { Context } from '@deepseek-ai/cordis'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import * as KnowledgeModule from '../lib/knowledge/index.js'
const options = Object.fromEntries(process.argv.slice(2).map(arg => { const at=arg.indexOf('=');if(at<0)throw Error('Use --option=value');return [arg.slice(2,at),arg.slice(at+1)] }))
for (const key of ['manifest','output','python','model-root']) if(!options[key])throw Error(`Missing --${key}`)
const output=resolve(options.output);await mkdir(output,{recursive:true})
const sample=JSON.parse(await readFile(options.manifest,'utf8'))
if(sample.length!==50)throw Error('Expected exactly 50 articles')
const articles=[]
for(const item of sample){const data=await readFile(item.path);if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw Error('Article changed after selection');articles.push({...item,text:data.toString('utf8')})}
const home=await mkdtemp(join(tmpdir(),'dsh-chunking-50-'));process.env.DSH_HOME=home
const device=options.device??'CUDA', repetitions=Number(options.repetitions??3)
const script=fileURLToPath(new URL('./embedding-fp16-worker.py',import.meta.url))
let worker, server, fiber, current, sequence=0, workerTail=Promise.resolve(), measured=[], measurements=false
let peakRss=0
const stderr=[]
async function request(texts){
 const work=workerTail.then(()=>new Promise((resolve,reject)=>{
  const id=++sequence;const timer=setTimeout(()=>{worker.kill('SIGKILL');reject(Error('Embedding probe timed out'))},180000)
  current={id,resolve:result=>{clearTimeout(timer);if(measurements)measured.push({count:texts.length,characters:texts.reduce((n,t)=>n+t.length,0),elapsedMs:result.elapsedMs});resolve(result.vectors)},reject:error=>{clearTimeout(timer);reject(error)}}
  worker.stdin.write(JSON.stringify({id,texts})+'\n')
 }));workerTail=work.catch(()=>{});return work
}
async function save(status){await writeFile(join(output,'status.json'),JSON.stringify(status,null,2)+'\n')}
try{
 worker=spawn(options.python,[script,'--models',resolve(options['model-root']),'--device',device,'--threads',options.threads??(device==='CUDA'?'2':'8')],{env:{...process.env,PYTHONUNBUFFERED:'1'},stdio:['pipe','pipe','pipe']})
 worker.stderr.on('data',data=>{stderr.push(String(data));if(stderr.length>100)stderr.shift()})
 const lines=createInterface({input:worker.stdout})
 lines.on('line',line=>{if(!line.startsWith('DSH_EMBED_RESULT '))return;const row=JSON.parse(line.slice(17));if(current?.id!==row.id)return;const pending=current;current=undefined;row.ok?pending.resolve(row):pending.reject(Error(row.error))})
 worker.on('error',error=>current?.reject(error));worker.on('exit',code=>{current?.reject(Error(`Embedding worker exited ${code}: ${stderr.join('').slice(-2000)}`));current=undefined})
 await save({state:'warming',device,articles:articles.length})
 const warm=Array.from({length:device==='CUDA'?16:1},()=> 'A telescope collects light from distant stars. '.repeat(4))
 await request(warm);await request(warm)
 server=createServer(async(req,res)=>{
  try{
   let body='';for await(const data of req)body+=data
   const parsed=JSON.parse(body);const texts=typeof parsed.input==='string'?[parsed.input]:parsed.input
   const vectors=[];const size=device==='CUDA'?16:1
   for(let i=0;i<texts.length;i+=size)vectors.push(...await request(texts.slice(i,i+size)))
   if(vectors.some(v=>v.length!==1024||v.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...v)-1)>.001))throw Error('Invalid vectors')
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:vectors.map((embedding,index)=>({index,embedding}))}))
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error)}}))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port
 const cases=[{name:'plain',smartChunk:false,semanticChunk:false},{name:'smart',smartChunk:true,semanticChunk:false},{name:'semantic',smartChunk:true,semanticChunk:true}]
 const results=[]
 for(let round=0;round<repetitions;round++)for(let step=0;step<cases.length;step++){
  const test=cases[(round+step)%cases.length]
  const config={embeddingProvider:'openai',embeddingBaseUrl:`http://127.0.0.1:${port}/v1`,embeddingModel:'Qwen3-Embedding-0.6B-FP16',embeddingApiKey:'',rerankModel:'',rerankBaseUrl:'',rerankApiKey:'',smartChunk:test.smartChunk,chunkSeparator:'\n\n',chunkSize:800,chunkOverlap:100,topK:6,searchMode:'hybrid',similarityThreshold:0,mmrDiversity:0,rrfVectorWeight:1,embeddingBatchSize:32,siblingChunks:1,localModelCacheDir:join(home,'unused-model-cache'),hfEndpoint:'',chunkStorePath:join(home,'chunks.sqlite'),documentProcessorProvider:'builtin',mineruApiKey:'',mineruApiHost:'',semanticChunk:test.semanticChunk,semanticChunkThreshold:.75,semanticChunkCandidateTokens:128,chunkTokenLimit:0,conflictStrategy:'rename',urlRefreshHours:0,imageCaptionProvider:'off',imageCaptionModel:'',imageCaptionBaseUrl:'',imageCaptionApiKey:'',resumeInterruptedOnStartup:false,autoRetrieve:false,autoRetrieveWeight:3,localWorkerIdleTimeoutMs:60000}
  const ctx=new Context();ctx.provide('webServer',{register:()=>()=>{}})
  fiber=await ctx.plugin(KnowledgeModule.KnowledgeService,config)
  const service=ctx.get('knowledge');await service.whenReady()
  const base=await service.createBase({name:`chunking-${test.name}-${round}`,config:{embeddingProvider:'openai',embeddingBaseUrl:config.embeddingBaseUrl,embeddingModel:config.embeddingModel,smartChunk:test.smartChunk,semanticChunk:test.semanticChunk}})
  await save({state:'running',case:test.name,round:round+1,repetitions,articles:50,completedTrials:results.length})
  measured=[];measurements=true;const started=performance.now();let chunks=0
  for(const [index,article] of articles.entries()){
   const doc=await service.addTextDocument({baseId:base.id,title:article.relative_path??`Article ${index+1}`,content:article.text})
   if(doc.embeddingError)throw Error(doc.embeddingError)
   chunks+=doc.chunkCount
   if((index+1)%10===0)await save({state:'running',case:test.name,round:round+1,articlesComplete:index+1,articles:50,completedTrials:results.length})
  }
  const seconds=(performance.now()-started)/1000;measurements=false
  const embeddingSeconds=measured.reduce((n,m)=>n+m.elapsedMs,0)/1000
  const embeddedInputs=measured.reduce((n,m)=>n+m.count,0)
  peakRss=Math.max(peakRss,process.memoryUsage().rss)
  const result={case:test.name,round:round+1,device,articles:50,bytes:articles.reduce((n,a)=>n+a.bytes,0),seconds,embeddingSeconds,chunks,embeddedInputs,articlesPerMinute:3000/seconds,finalChunksPerSecond:chunks/seconds,embeddingInputsPerSecond:embeddedInputs/embeddingSeconds,hostRssBytes:process.memoryUsage().rss,config:{smartChunk:test.smartChunk,semanticChunk:test.semanticChunk,chunkSize:800,chunkOverlap:100,semanticChunkThreshold:.75,semanticChunkCandidateTokens:128,embeddingBatchSize:32,backendBatchSize:device==='CUDA'?16:1},scope:'Fresh isolated Cordis KnowledgeService, MemoryStore, native FP16 worker via loopback embedding bridge; excludes model load, real SQLite publication and the multi-device scheduler.'}
  results.push(result);await writeFile(join(output,'results.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(result))
  await fiber.dispose();fiber=undefined
 }
 await save({state:'complete',device,articles:50,trials:results.length,peakNodeRssBytes:peakRss})
}catch(error){await save({state:'failed',error:String(error),diagnostics:stderr.join('').slice(-3000)});throw error}
finally{await fiber?.dispose();server?.closeAllConnections();await new Promise(resolve=>server?server.close(resolve):resolve());worker?.kill('SIGTERM');await writeFile(join(output,'worker.stderr'),stderr.join(''));await rm(home,{recursive:true,force:true})}
