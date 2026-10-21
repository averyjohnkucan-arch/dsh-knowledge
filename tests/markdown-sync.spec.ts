import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { KnowledgeService } from '../src/knowledge/index.js'
import type { Config } from '../src/knowledge/config.js'
import { indexingSettingsFingerprint } from '../src/knowledge/indexing-settings.js'
import { ChunkDatabase } from '../src/knowledge/chunkdb.js'
import { baseConfigSchema, configOverridesSchema } from '../src/knowledge/domain.js'
const CONFIG: Config = {
  embeddingProvider: 'none',
  embeddingBaseUrl: '',
  embeddingModel: '',
  embeddingApiKey: '',
  rerankModel: '',
  rerankBaseUrl: '',
  rerankApiKey: '',
  localRerankTimeoutMs: 60000,
  smartChunk: true,
  chunkSeparator: '\n\n',
  chunkSize: 800,
  chunkOverlap: 100,
  topK: 6,
  searchMode: 'auto',
  similarityThreshold: 0,
  mmrDiversity: 0,
  rrfVectorWeight: 1,
  embeddingBatchSize: 32,
  siblingChunks: 1,
  localModelCacheDir: '',
  hfEndpoint: '',
  chunkStorePath: '',
  documentProcessorProvider: 'builtin',
  mineruApiKey: '',
  mineruApiHost: '',
  semanticChunk: false,
  semanticChunkThreshold: 0.75,
  chunkTokenLimit: 0,
  conflictStrategy: 'rename',
  urlRefreshHours: 0,
  imageCaptionProvider: 'off',
  imageCaptionModel: '',
  imageCaptionBaseUrl: '',
  imageCaptionApiKey: '',
  resumeInterruptedOnStartup: true,
  autoRetrieve: true,
  autoRetrieveWeight: 3,
  localWorkerIdleTimeoutMs: 60000,
}

const cleanup:Array<()=>Promise<unknown>>=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.restoreAllMocks()})
async function mount(keep=false){
 const ctx=new Context();let handler:((req:unknown,res:unknown)=>void)|undefined
 ctx.provide('webServer',{register:(route:{handler:typeof handler})=>{handler=route.handler;return()=>{}}})
 const fiber=await ctx.plugin(KnowledgeService,{...CONFIG,embeddingProvider:'none',autoRetrieve:false,keepInternalMarkdown:keep})
 cleanup.push(()=>fiber.dispose())
 const service=ctx.get('knowledge') as KnowledgeService;await service.whenReady()
 const base=await service.createBase({name:'isolated Markdown test'})
 return {service,base,handler:handler!}
}
async function directory(){const path=await mkdtemp(join(tmpdir(),'dsh-markdown-sync-'));cleanup.push(()=>rm(path,{recursive:true,force:true}));return path}
async function sync(service:KnowledgeService,id:string){
 const {jobId}=service.startFolderSync(id)
 for(let n=0;n<2000;n++){const status=service.folderSyncStatus(jobId);if(status.state==='failed')throw Error(status.error);if(status.state==='complete')return status.result!;await new Promise(resolve=>setTimeout(resolve,5))}
 throw Error('Sync did not finish')
}
describe('future-only Markdown and settings-aware folder sync',()=>{
 it('saves only future generations and keeps old citations across later reindexing',async()=>{
  const {service,base}=await mount()
  const doc=await service.addTextDocument({baseId:base.id,title:'Document',content:'original indexed passage'})
  expect(service.getDocument(doc.id).markdownRevision).toBeUndefined()
  await service.renameBase(base.id,{config:{keepInternalMarkdown:true}})
  expect(service.getDocument(doc.id).markdownRevision).toBeUndefined()
  await service.reindexDocument(doc.id,{mode:'rechunk'})
  const revision=service.getDocument(doc.id).markdownRevision!
  expect((await service.getMarkdownSnapshot(doc.id,revision)).text).toBe('original indexed passage')
  const found=await service.search({baseId:base.id,query:'indexed',mode:'lexical'})
  expect(found.hits[0].indexedMarkdownUrl).toContain(`/markdown/${revision}?chunk=`)
  await service.renameBase(base.id,{config:{keepInternalMarkdown:false}})
  await service.reindexDocument(doc.id,{mode:'rechunk'})
  expect(service.getDocument(doc.id).markdownRevision).toBeUndefined()
  expect((await service.getMarkdownSnapshot(doc.id,revision)).text).toBe('original indexed passage')
  await service.deleteDocument(doc.id)
  await expect(service.getMarkdownSnapshot(doc.id,revision)).rejects.toThrow('not found')
 })
 it('syncs changed settings and sources once, skips unchanged work, and cleans deleted sources',async()=>{
  const {service,base}=await mount();const path=await directory(),file=join(path,'article.md');await writeFile(file,'A stable article about astronomy.')
  const imported=await service.importDirectoryTree(base.id,path)
  const doc=service.listDocuments(base.id).find(row=>row.sourceType==='file')!
  expect((await sync(service,imported.sourceId)).updated).toBe(0)
  await service.renameBase(base.id,{config:{keepInternalMarkdown:true,chunkSize:300}})
  expect(service.getDocument(doc.id).markdownRevision).toBeUndefined()
  expect((await sync(service,imported.sourceId)).updated).toBe(1)
  const revision=service.getDocument(doc.id).markdownRevision!
  expect((await sync(service,imported.sourceId)).updated).toBe(0)
  expect(service.getDocument(doc.id).markdownRevision).toBe(revision)
  await writeFile(file,'A changed article about telescopes.')
  expect((await sync(service,imported.sourceId)).updated).toBe(1)
  expect(service.getDocument(doc.id).markdownRevision).not.toBe(revision)
  expect((await service.getMarkdownSnapshot(doc.id,revision)).text).toContain('astronomy')
  await rm(file);expect((await sync(service,imported.sourceId)).deleted).toBe(1)
  await expect(service.getMarkdownSnapshot(doc.id,revision)).rejects.toThrow('not found')
 })
 it('never deletes source files when indexed records and internal Markdown are removed',async()=>{
  const {service,base}=await mount(true);const path=await directory(),file=join(path,'original.md');await writeFile(file,'Keep this original source.')
  const imported=await service.importDirectoryTree(base.id,path);const doc=service.listDocuments(base.id).find(row=>row.sourceType==='file')!
  expect(service.getDocument(doc.id).markdownRevision).toBeTruthy()
  await service.deleteDocument(imported.sourceId,{recursive:true})
  expect(await readFile(file,'utf8')).toBe('Keep this original source.')
 })
 it('recursively removes all saved revisions when Sync applies retention off, preserving text and chunks without reindexing',async()=>{
  const {service,base}=await mount(true);const path=await directory()
  await mkdir(join(path,'nested'));await writeFile(join(path,'one.txt'),'A stable astronomy passage.')
  await writeFile(join(path,'nested','two.txt'),'A stable telescope passage.')
  const imported=await service.importDirectoryTree(base.id,path)
  const files=service.listDocuments(base.id).filter(row=>row.sourceType==='file')
  const revisions=files.map(doc=>({id:doc.id,revision:service.getDocument(doc.id).markdownRevision!}))
  // Preserve an additional historical revision whose pointer has already gone.
  await service.reindexDocument(files[0].id,{mode:'rechunk'})
  revisions.push({id:files[0].id,revision:service.getDocument(files[0].id).markdownRevision!})
  await service.renameBase(base.id,{config:{keepInternalMarkdown:false}})
  expect((await service.getMarkdownSnapshot(revisions[0].id,revisions[0].revision)).text).toContain('stable')
  await service.reindexDocument(files[0].id,{mode:'rechunk'})
  const before=files.map(doc=>service.getDocument(doc.id))
  const reindex=vi.spyOn(service,'reindexDocument')
  expect((await sync(service,imported.sourceId)).updated).toBe(2)
  expect(reindex).not.toHaveBeenCalled()
  for(const {id,revision} of revisions)await expect(service.getMarkdownSnapshot(id,revision)).rejects.toThrow('not found')
  files.forEach((doc,index)=>{
   const after=service.getDocument(doc.id)
   expect(after.markdownRevision).toBeUndefined()
   expect(after.rawText).toBe(before[index].rawText)
   expect(after.chunks).toEqual(before[index].chunks)
  })
  expect((await service.search({baseId:base.id,query:'stable',mode:'lexical'})).hits.length).toBe(2)
  expect(await readFile(join(path,'one.txt'),'utf8')).toBe('A stable astronomy passage.')
  expect(await readFile(join(path,'nested','two.txt'),'utf8')).toBe('A stable telescope passage.')
  expect((await sync(service,imported.sourceId)).updated).toBe(0)
  await service.renameBase(base.id,{config:{keepInternalMarkdown:true}})
  expect((await sync(service,imported.sourceId)).updated).toBe(2)
  expect(service.getDocument(files[0].id).markdownRevision).toBeTruthy()
 })
 it('reports a failed retention cleanup and retries it on the next Sync',async()=>{
  const {service,base}=await mount(true);const path=await directory();await writeFile(join(path,'one.txt'),'Original astronomy text.')
  const imported=await service.importDirectoryTree(base.id,path),doc=service.listDocuments(base.id).find(row=>row.sourceType==='file')!
  const revision=service.getDocument(doc.id).markdownRevision!
  await service.renameBase(base.id,{config:{keepInternalMarkdown:false}})
  const repo=(service as unknown as {markdownSnapshots:{clearDocument:(base:string,doc:string)=>Promise<boolean>}}).markdownSnapshots
  const cleanup=vi.spyOn(repo,'clearDocument').mockRejectedValue(Error('permission denied during cleanup'))
  expect((await sync(service,imported.sourceId)).failed).toBe(1)
  expect((await service.getMarkdownSnapshot(doc.id,revision)).text).toContain('astronomy')
  cleanup.mockRestore()
  expect((await sync(service,imported.sourceId)).updated).toBe(1)
  await expect(service.getMarkdownSnapshot(doc.id,revision)).rejects.toThrow('not found')
 },10000)
 it('does not resurrect a document deleted while its saved revision is being prepared',async()=>{
  const {service,base}=await mount(true)
  const repo=(service as unknown as {markdownSnapshots:{save: (...args:any[])=>Promise<string>}}).markdownSnapshots
  const original=repo.save.bind(repo);let release!:()=>void,entered!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve}),started=new Promise<void>(resolve=>{entered=resolve})
  vi.spyOn(repo,'save').mockImplementation(async(...args)=>{entered();await gate;return original(...args)})
  const adding=service.addTextDocument({baseId:base.id,title:'pending',content:'pending source'})
  const failed=expect(adding).rejects.toThrow(/deleted|no longer exists/)
  await started;const doc=service.listDocuments(base.id)[0];await service.deleteDocument(doc.id);release();await failed
  expect(service.listDocuments(base.id)).toEqual([])
 })
 it('serves escaped highlighted revisions, blocks wrong citations, and returns 404 after deletion',async()=>{
  const {service,base,handler}=await mount(true)
  const doc=await service.addTextDocument({baseId:base.id,title:'<script>bad</script>',content:'line one\n<script>unsafe</script>'})
  const revision=service.getDocument(doc.id).markdownRevision!,saved=await service.getMarkdownSnapshot(doc.id,revision)
  const server=createServer(handler as Parameters<typeof createServer>[0])
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanup.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())))
  const address=server.address() as {port:number},root=`http://127.0.0.1:${address.port}/knowledge/documents/${doc.id}/markdown/${revision}`
  const response=await fetch(root+'?chunk='+saved.passages[0].chunkId);const html=await response.text()
  expect(response.status).toBe(200);expect(html).toContain('<mark id="citation">');expect(html).not.toContain('<script>')
  expect(response.headers.get('content-security-policy')).toContain("default-src 'none'")
  expect((await fetch(root+'?chunk=wrong')).status).toBe(400)
  expect(await (await fetch(root+'?download=1')).text()).toBe(saved.text)
  await service.deleteDocument(doc.id);expect((await fetch(root)).status).toBe(404)
 })
 it('preserves settings identities through validation and SQLite metadata roundtrips',async()=>{
  expect(baseConfigSchema.parse({keepInternalMarkdown:true})).toEqual({keepInternalMarkdown:true})
  expect(configOverridesSchema.parse({keepInternalMarkdown:true})).toEqual({keepInternalMarkdown:true})
  const {service}=await mount();const config=service.getConfig()
  expect(indexingSettingsFingerprint({...config,rerankModel:'different',topK:30})).toBe(indexingSettingsFingerprint(config))
  expect(indexingSettingsFingerprint({...config,smartChunk:!config.smartChunk})).not.toBe(indexingSettingsFingerprint(config))
  const path=await directory(),db=new ChunkDatabase(join(path,'test.sqlite'))
  const doc={id:'doc',baseId:'base',title:'test',sourceType:'file' as const,charCount:1,chunkCount:0,createdAt:1,markdownRevision:'saved-rev',indexingSettingsFingerprint:'fingerprint'}
  db.putDocumentMetadata(doc);db.close();const reopened=new ChunkDatabase(join(path,'test.sqlite'))
  expect(reopened.getDocumentMetadata('doc')).toMatchObject({markdownRevision:'saved-rev',indexingSettingsFingerprint:'fingerprint'});reopened.close()
 })
})
