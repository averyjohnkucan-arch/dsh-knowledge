// Exact vector search in a read-only worker. Stream BLOBs; retain only top K.
// Never build a corpus-sized vector/text cache on the Harness event loop.
import {DatabaseSync} from 'node:sqlite'
import {parentPort,workerData} from 'node:worker_threads'
let db
try{
 const {path,embedding,baseIds,limit,filter={},deadlineAt}=workerData
 db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500; BEGIN')
 const terms=['embedding IS NOT NULL'],params=[]
 const inList=(column,values,exclude=false)=>{if(values?.length){terms.push(`${column} ${exclude?'NOT IN':'IN'} (${values.map(()=>'?').join(',')})`);params.push(...values)}}
 inList('base_id',baseIds);inList('doc_id',filter.docIds);inList('doc_id',filter.excludeDocIds,true)
 if(filter.embeddingModel!==undefined){terms.push('embedding_model=?');params.push(filter.embeddingModel)}
 const q=Float32Array.from(embedding),normQ=Math.hypot(...q),best=[];let total=0,minimum=-Infinity
 for(const row of db.prepare(`SELECT chunk_id,embedding FROM chunk WHERE ${terms.join(' AND ')}`).iterate(...params)){
  if((total++&63)===0&&Date.now()>=deadlineAt)throw Error('knowledge vector search deadline exceeded')
  const bytes=row.embedding;if(!bytes||bytes.byteLength!==q.length*4||!q.length)continue
  const b=bytes.byteOffset%4===0?new Float32Array(bytes.buffer,bytes.byteOffset,q.length):new Float32Array(Uint8Array.from(bytes).buffer)
  let dot=0,norm=0;for(let i=0;i<q.length;i++){dot+=q[i]*b[i];norm+=b[i]*b[i]}
  const score=norm&&normQ?Math.max(0,Math.min(1,dot/(Math.sqrt(norm)*normQ))):0
  if(best.length<limit||score>minimum){best.push({id:row.chunk_id,score});best.sort((a,b)=>b.score-a.score);if(best.length>limit)best.pop();minimum=best.at(-1)?.score??-Infinity}
 }
 const get=db.prepare('SELECT * FROM chunk WHERE chunk_id=?')
 const hits=best.map(hit=>({row:get.get(hit.id),score:hit.score}))
 db.exec('COMMIT');parentPort.postMessage({ok:true,value:{total,hits}})
}catch(error){parentPort.postMessage({ok:false,error:String(error)})}finally{db?.close()}
