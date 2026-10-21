import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KnowledgeChunk, KnowledgeDocument } from './types.js'

export interface MarkdownRange { start: number; end: number; lineStart: number; lineEnd: number }
export interface MarkdownPassage { chunkId: string; index: number; text: string; ranges: MarkdownRange[] }
export interface MarkdownSnapshot {
  schema: 1; baseId: string; documentId: string; revision: string; title: string
  sha256: string; createdAt: number; processingRevision?: string; text: string; passages: MarkdownPassage[]
}
const LIMIT = 100 * 1024 * 1024
const component = (value: string) => { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw Error('Invalid Markdown snapshot identifier'); return value }
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))

/** Map only verifiable passages, in order. Never invent offsets for transformed text. */
export function mapMarkdownPassages(text: string, chunks: readonly KnowledgeChunk[]): MarkdownPassage[] {
  const lines = [0]
  for (let i=0;i<text.length;i++) if(text[i]==='\n')lines.push(i+1)
  const lineOf=(offset:number)=>{let low=0,high=lines.length;while(low<high){const mid=(low+high)>>>1;if(lines[mid]<=offset)low=mid+1;else high=mid}return low}
  let cursor=0
  return [...chunks].sort((a,b)=>a.index-b.index).map(chunk=>{
    const body=chunk.text.trim(),words=body.split(/\s+/u).filter(Boolean)
    const pattern=words.length?new RegExp(words.map(escapeRegex).join('\\s+'),'gu'):undefined
    if(pattern)pattern.lastIndex=cursor
    const match=pattern?.exec(text)
    const ranges:MarkdownRange[]=[]
    if(match){const start=match.index,end=start+match[0].length;ranges.push({start,end,lineStart:lineOf(start),lineEnd:lineOf(Math.max(start,end-1))});cursor=start+((text.codePointAt(start)??0)>0xffff?2:1)}
    return {chunkId:chunk.id,index:chunk.index,text:chunk.text,ranges}
  })
}

/** Versioned derived text, separate from original source files and parse artifacts. */
export class MarkdownSnapshots {
  private memory=new Map<string,MarkdownSnapshot>()
  private writes=new Set<{key:string;promise:Promise<string>}>()
  private deleted=new Set<string>()
  constructor(private root?:string){}
  private key(base:string,doc:string,revision:string){return [base,doc,revision].map(component).join('/')}
  async save(doc:KnowledgeDocument,text:string,chunks:readonly KnowledgeChunk[]):Promise<string>{
    const key=[doc.baseId,doc.id].map(component).join('/')
    if(this.deleted.has(doc.baseId)||this.deleted.has(key))throw Error('Markdown source was deleted')
    const record={key,promise:this.saveVersion(doc,text,chunks)};this.writes.add(record)
    try{return await record.promise}finally{this.writes.delete(record)}
  }
  private async saveVersion(doc:KnowledgeDocument,text:string,chunks:readonly KnowledgeChunk[]):Promise<string>{
    if(Buffer.byteLength(text)>LIMIT)throw Error('Internal Markdown exceeds the 100 MiB limit')
    const revision=randomUUID(),key=this.key(doc.baseId,doc.id,revision)
    const snapshot:MarkdownSnapshot={schema:1,baseId:doc.baseId,documentId:doc.id,revision,title:doc.title,sha256:digest(text),createdAt:Date.now(),text,passages:mapMarkdownPassages(text,chunks),...(doc.processing?{processingRevision:doc.processing.revision}:{})}
    if(!this.root){this.memory.set(key,snapshot);return revision}
    const {text:body,...manifest}=snapshot
    const encoded=JSON.stringify(manifest)
    if(Buffer.byteLength(encoded)>LIMIT)throw Error('Internal Markdown manifest exceeds the 100 MiB limit')
    const target=join(this.root,key),pending=target+'.pending'
    await mkdir(pending,{recursive:true})
    try{await writeFile(join(pending,'indexed.md'),body,{flag:'wx'});await writeFile(join(pending,'manifest.json'),encoded,{flag:'wx'});await rename(pending,target)}catch(error){await rm(pending,{recursive:true,force:true});throw error}
    return revision
  }
  async has(base:string,doc:string,revision:string):Promise<boolean>{
    const key=this.key(base,doc,revision)
    if(!this.root)return this.memory.has(key)
    try{await Promise.all(['indexed.md','manifest.json'].map(name=>stat(join(this.root!,key,name))));return true}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error}
  }
  async load(baseId:string,documentId:string,revision:string):Promise<MarkdownSnapshot|undefined>{
    const key=this.key(baseId,documentId,revision)
    if(!this.root){const value=this.memory.get(key);return value?structuredClone(value):undefined}
    try{
      const path=join(this.root,key)
      for(const name of ['indexed.md','manifest.json'])if((await stat(join(path,name))).size>LIMIT)throw Error('Internal Markdown exceeds read limit')
      const [text,raw]=await Promise.all([readFile(join(path,'indexed.md'),'utf8'),readFile(join(path,'manifest.json'),'utf8')])
      const manifest=JSON.parse(raw)
      if(manifest.schema!==1||manifest.baseId!==baseId||manifest.documentId!==documentId||manifest.revision!==revision||manifest.sha256!==digest(text)||typeof manifest.title!=='string'||!Array.isArray(manifest.passages))throw Error('Invalid internal Markdown snapshot')
      for(const passage of manifest.passages){if(typeof passage.chunkId!=='string'||typeof passage.text!=='string'||!Array.isArray(passage.ranges))throw Error('Invalid Markdown passage');for(const range of passage.ranges)if(!Number.isInteger(range.start)||!Number.isInteger(range.end)||range.start<0||range.end>text.length||range.start>=range.end)throw Error('Invalid Markdown range')}
      return {...manifest,text}
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error}
  }
  async removeRevision(base:string,doc:string,revision:string):Promise<void>{const key=this.key(base,doc,revision);this.memory.delete(key);if(this.root)await rm(join(this.root,key),{recursive:true,force:true})}
  async removeBase(base:string):Promise<void>{const prefix=component(base);this.deleted.add(prefix);await Promise.allSettled([...this.writes].filter(row=>row.key.startsWith(prefix+'/')).map(row=>row.promise));for(const key of this.memory.keys())if(key.startsWith(prefix+'/'))this.memory.delete(key);if(this.root)await rm(join(this.root,prefix),{recursive:true,force:true})}
  async removeDocument(base:string,doc:string):Promise<void>{const prefix=[base,doc].map(component).join('/');this.deleted.add(prefix);await Promise.allSettled([...this.writes].filter(row=>row.key===prefix).map(row=>row.promise));for(const key of this.memory.keys())if(key.startsWith(prefix+'/'))this.memory.delete(key);if(this.root)await rm(join(this.root,prefix),{recursive:true,force:true})}
}

/** Script-free, escaped source viewer; offsets refer only to this saved revision. */
export function renderMarkdownSnapshot(snapshot:MarkdownSnapshot,chunkId?:string):string{
  const passage=chunkId?snapshot.passages.find(row=>row.chunkId===chunkId):undefined
  if(chunkId&&!passage)throw Error('Citation does not belong to this saved document revision')
  const ranges=passage?.ranges??[]
  const parts:string[]=[];let cursor=0
  for(const range of ranges){parts.push(escapeHtml(snapshot.text.slice(cursor,range.start)),`<mark id="citation">${escapeHtml(snapshot.text.slice(range.start,range.end))}</mark>`);cursor=range.end}
  parts.push(escapeHtml(snapshot.text.slice(cursor)))
  const location=ranges.map(r=>`lines ${r.lineStart}–${r.lineEnd}`).join(', ')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(snapshot.title)}</title><style>body{max-width:1000px;margin:2rem auto;padding:0 1rem;font:16px system-ui;color:#ddd;background:#181818}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}mark{background:#ffe36b;color:#111;scroll-margin:5rem}a{color:#9cf}.meta{font-size:13px;color:#aaa}</style></head><body><h1>${escapeHtml(snapshot.title)}</h1><p class="meta">Indexed Markdown · saved revision ${escapeHtml(snapshot.revision)}${location?' · '+escapeHtml(location):''}</p><p><a href="/knowledge/documents/${encodeURIComponent(snapshot.documentId)}/raw?inline=1">Open original source</a></p>${passage&&!ranges.length?`<p>No exact source range could be verified for this transformed passage. Its indexed text is shown below.</p><blockquote><pre>${escapeHtml(passage.text)}</pre></blockquote>`:''}<pre>${parts.join('')}</pre></body></html>`
}
