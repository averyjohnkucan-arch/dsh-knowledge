import{build}from'esbuild';import{execFileSync}from'node:child_process';import{tmpdir}from'node:os';import{fileURLToPath,pathToFileURL}from'node:url';
import{readdirSync,readFileSync,mkdtempSync,statSync,writeFileSync,symlinkSync,realpathSync}from'node:fs';import{join}from'node:path';import{performance}from'node:perf_hooks';
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const [key,...value]=arg.replace(/^--/,'').split('=');return[key,value.join('=')]}));
if(!args.source||!args.baseline||!/^[a-f0-9]{7,40}$/i.test(args.baseline))throw Error('Use --source=/path/to/Markdown --baseline=<commit-SHA> [--output=/path/report.json]');
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
const buildDir=mkdtempSync(join(tmpdir(),'dsh-write-benchmark-modules-'));
symlinkSync(realpathSync(join(packageRoot,'node_modules')),join(buildDir,'node_modules'),'junction');
const old=(file)=>execFileSync('git',['show',args.baseline+':src/knowledge/'+file],{cwd:packageRoot,encoding:'utf8'});
const common={bundle:true,platform:'node',format:'esm',packages:'external'};
await build({...common,stdin:{contents:old('store.ts'),resolveDir:join(packageRoot,'src/knowledge'),sourcefile:'store.ts',loader:'ts'},plugins:[{name:'baseline-db',setup(b){b.onLoad({filter:/[\\/]knowledge[\\/]chunkdb\.ts$/},()=>({contents:old('chunkdb.ts'),loader:'ts'}))}}],outfile:join(buildDir,'before.mjs')});
await build({...common,entryPoints:[join(packageRoot,'src/knowledge/store.ts')],outfile:join(buildDir,'after.mjs')});
await build({...common,entryPoints:[join(packageRoot,'src/knowledge/chunk.ts')],outfile:join(buildDir,'chunk.mjs')});
const {openStore:before}=await import(pathToFileURL(join(buildDir,'before.mjs')));
const {openStore:after}=await import(pathToFileURL(join(buildDir,'after.mjs')));
const {chunkText}=await import(pathToFileURL(join(buildDir,'chunk.mjs')));
const root=args.source,files=readdirSync(root,{recursive:true}).filter(p=>p.endsWith('.md')).sort().slice(0,256),dir=mkdtempSync('/tmp/dsh-fresh-store-'),results=[];
function domain(){const tables={bases:new Map(),documents:new Map()};let global={overrides:{},groups:[],enabled:true,enabledBaseIds:[]};return{name:'knowledge',global:{get:()=>global,set:async(v)=>{global=v}},table:(name)=>({get:id=>tables[name].get(id),entries:()=>tables[name].entries(),put:async(id,v)=>tables[name].set(id,v),delete:async(id)=>tables[name].delete(id)}),close:async()=>{}}}
const records=files.map((file,i)=>{const text=readFileSync(join(root,file),'utf8'),pieces=chunkText(text,500,100,{smartChunk:true});return{doc:{id:'doc-'+i,baseId:'base',title:file,sourceType:'text',charCount:text.length,rawText:text,chunkCount:pieces.length,createdAt:1,updatedAt:2},chunks:pieces.map((p,index)=>({id:`chunk-${i}-${index}`,docId:'doc-'+i,baseId:'base',index,text:p.text,context:file,...(p.heading?{heading:p.heading}:{})}))}});
for(const[name,open,concurrency]of[['before8',before,8],['after8',after,8],['after32',after,32]]){
 const path=join(dir,name+'.sqlite'),store=await open({open:async()=>domain()},{chunkStorePath:path,legacyJsonPath:join(dir,'missing.json')});await store.putBase({id:'base',name:'Benchmark',createdAt:1,updatedAt:1});const db=store.chunkDb.db;db.exec('PRAGMA wal_checkpoint(TRUNCATE)');db.exec('PRAGMA wal_autocheckpoint=0');
 const histogram={},publish=store.chunkDb.publishDocumentGenerations.bind(store.chunkDb);store.chunkDb.publishDocumentGenerations=(entries)=>{histogram[entries.length]=(histogram[entries.length]??0)+1;return publish(entries)};
 const start=performance.now();let cursor=0;await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<records.length){const item=records[cursor++];await store.putDocument({...item.doc,rawText:undefined,chunkCount:0,incomplete:true});await new Promise(r=>setTimeout(r,5));await store.putDocument({...item.doc,chunkCount:0,incomplete:true});await store.commitDocumentGeneration(item.doc,item.chunks);await store.putDocument({...item.doc,sourceSignature:'signature'})}}));
 const seconds=(performance.now()-start)/1000,walBytes=statSync(path+'-wal').size;db.exec("INSERT INTO chunk_fts(chunk_fts,rank) VALUES('integrity-check',1)");const count=db.prepare('SELECT count(*) AS n FROM chunk').get().n;if(count!==records.reduce((n,r)=>n+r.chunks.length,0))throw Error('wrong count '+count);results.push({name,concurrency,seconds,documents:256,chunks:count,inputBytes:records.reduce((s,r)=>s+Buffer.byteLength(r.doc.rawText),0),walBytes,batchHistogram:histogram});console.log(JSON.stringify(results.at(-1)));await store.close();
}
const report=JSON.stringify({directory:dir,results,notes:'Read-only 256 Markdown sources; actual DomainStore/SQLite pipeline including placeholder, resumable source-text update, publication and source signature. Simulated 5ms parser delay in both variants. Separate databases; WAL checkpoint disabled during timed region. Does not include processor artifacts, OCR, embedding or physical SSD writes.'},null,2);
if(args.output)writeFileSync(args.output,report);else console.log(report);
