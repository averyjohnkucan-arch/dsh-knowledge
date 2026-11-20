/** Isolated DB benchmark: no production database or inference/model changes. */
import {build} from 'esbuild'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,symlinkSync,realpathSync,statSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const baseline=process.argv[2]??'HEAD'
if(!/^[a-zA-Z0-9_.\/-]+$/.test(baseline))throw Error('Invalid baseline ref')
const work=mkdtempSync(join(tmpdir(),'dsh-db-batches-'))
symlinkSync(realpathSync(join(root,'node_modules')),join(work,'node_modules'),'junction')
const old=file=>execFileSync('git',['show',`${baseline}:src/knowledge/${file}`],{cwd:root,encoding:'utf8'})
const options={bundle:true,platform:'node',format:'esm',packages:'external'}
await build({...options,stdin:{contents:old('store.ts'),resolveDir:join(root,'src/knowledge'),sourcefile:'store.ts',loader:'ts'},plugins:[{name:'old-db',setup(b){b.onLoad({filter:/[\\/]knowledge[\\/]chunkdb\.ts$/},()=>({contents:old('chunkdb.ts'),loader:'ts'}))}}],outfile:join(work,'before.mjs')})
await build({...options,entryPoints:[join(root,'src/knowledge/store.ts')],outfile:join(work,'after.mjs')})
const records=Array.from({length:64},(_,i)=>{
 const doc={id:`d${i}`,baseId:'b',title:`Document ${i}`,sourceType:'text',charCount:1600,chunkCount:8,rawText:'Scientific reference passage. '.repeat(64),createdAt:1,updatedAt:2}
 const chunks=Array.from({length:8},(_,j)=>({id:`c${i}-${j}`,docId:doc.id,baseId:'b',index:j,text:`Evidence ${i} ${j}: `+'Astronomy, geology and historical research findings. '.repeat(12),embedding:Array.from({length:1024},(_,k)=>Math.sin(k+i+j)/32),embeddingModel:'benchmark'}))
 return {doc,chunks}
})
function domain(){const tables={bases:new Map(),documents:new Map()};return {global:{get:()=>({}),set:async()=>{}},table:name=>({get:id=>tables[name].get(id),entries:()=>tables[name].entries(),put:async(id,v)=>tables[name].set(id,v),delete:async id=>tables[name].delete(id)}),close:async()=>{}}}
const results=[]
try {
 for(const name of ['before','after']) {
  const {openStore}=await import(pathToFileURL(join(work,name+'.mjs')))
  const path=join(work,name+'.sqlite'),store=await openStore({open:async()=>domain()},{documentMetadataBackend:'sqlite',chunkStorePath:path,legacyJsonPath:join(work,'absent.json')})
  await store.putBase({id:'b',name:'Benchmark',createdAt:1,updatedAt:1})
  await Promise.all(records.map(({doc})=>store.putDocument(doc)))
  const db=store.chunkDb.db
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA wal_autocheckpoint=0')
  let commits=0;const original=db.exec.bind(db);db.exec=sql=>{if(sql==='COMMIT')commits++;return original(sql)}
  const start=performance.now()
  for(let offset=0;offset<records.length;offset+=32) {
   const group=records.slice(offset,offset+32)
   for(let batch=0;batch<4;batch++)await Promise.all(group.map(({doc,chunks})=>store.stageDocumentGeneration(doc,chunks.slice(batch*2,batch*2+2))))
  }
  const checkpointMs=performance.now()-start,checkpointWal=statSync(path+'-wal').size,checkpointCommits=commits
  for(const {doc,chunks}of records){const staged=store.getStagedDocumentGeneration(doc.id);if(staged?.chunks.length!==chunks.length)throw Error('Recovery lost checkpoints')}
  await Promise.all(records.map(({doc,chunks})=>store.commitDocumentGeneration(doc,chunks)))
  const totalMs=performance.now()-start,totalWal=statSync(path+'-wal').size
  original("INSERT INTO chunk_fts(chunk_fts,rank) VALUES('integrity-check',1)")
  results.push({name,documents:64,chunks:512,checkpointMs,checkpointCommits,checkpointWalBytes:checkpointWal,totalMs,totalWalBytes:totalWal})
  await store.close()
 }
 console.log(JSON.stringify({baseline,results,notes:'Deterministic 64-document/512-chunk DB-only workload, 1024-D vectors, 32 concurrent documents. WAL autocheckpoint disabled in these disposable databases to measure generated WAL bytes, not SSD physical writes. Includes recovery reads and atomic publication; excludes OCR, parsing and embedding inference.'},null,2))
} finally {rmSync(work,{recursive:true,force:true})}
