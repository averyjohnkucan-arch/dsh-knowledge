import {afterEach,expect,it,vi} from 'vitest'
import {Context} from '@deepseek-ai/cordis'
import {createHash} from 'node:crypto'
import {KnowledgeService} from '../src/knowledge/index.js'
const disposals:Array<()=>Promise<void>>=[]
afterEach(async()=>{for(const dispose of disposals.splice(0))await dispose()})
async function fixture(){
 const ctx=new Context();ctx.provide('webServer',{register:()=>()=>{}})
 const fiber=ctx.plugin(KnowledgeService,{embeddingProvider:'none',imageCaptionProvider:'off',chunkStorePath:'',deferredChartEnrichment:true})
 await fiber;disposals.push(async()=>{await fiber.dispose()})
 const service=ctx.get('knowledge') as KnowledgeService;const internal=service as any
 const base=await service.createBase({name:'idle charts'})
 const doc=await service.addTextDocument({baseId:base.id,title:'example.pdf',content:'Original searchable source text.'})
 const bytes=Buffer.from('PDF fixture');const sourceHash=createHash('sha256').update(bytes).digest('hex')
 const parsed={schemaVersion:1 as const,text:'Original searchable source text.',sourceHash,provider:'builtin' as const,optionsFingerprint:'test',completeness:'complete' as const,blocks:[{id:'text',index:0,type:'text' as const,text:'Original searchable source text.',textStart:0,textEnd:32}],assets:[],warnings:[]}
 const processing=await internal.artifacts.save(base.id,doc.id,{document:parsed,assets:[]})
 await internal.store.putDocument({...internal.store.getDocument(doc.id),sourceType:'file',fileName:'example.pdf',rawFilePath:'fixture.pdf',processing})
 internal.store.raw={read:async()=>bytes}
 const extract=vi.spyOn(service.structureV3,'extract').mockResolvedValue({document:{...parsed,blocks:[{id:'table',index:0,type:'table',text:'Measured chart value: 42',textStart:0,textEnd:24}]},assets:[]})
 return {service,internal,doc,extract,processing}
}
it('merges idle chart text without re-running source OCR, and marks the new revision once',async()=>{
 const {internal,doc,extract}=await fixture()
 expect(await internal.enrichNextIdleChart(new AbortController().signal)).toBe(true)
 const next=internal.store.getDocument(doc.id)
 expect(next.rawText).toContain('Original searchable source text.')
 expect(next.rawText).toContain('Measured chart value: 42')
 expect(next.deferredChartEnrichment).toEqual({revision:next.processing.revision,status:'completed'})
 expect(await internal.enrichNextIdleChart(new AbortController().signal)).toBe(false)
 expect(extract).toHaveBeenCalledOnce()
 expect(internal.store.listChunksByDoc(doc.id).map((c:any)=>c.text).join(' ')).toContain('Measured chart value: 42')
})
it('cancellation retains the original searchable generation and leaves enrichment resumable',async()=>{
 const {internal,doc,extract,processing}=await fixture();const controller=new AbortController()
 extract.mockImplementation(async()=>{controller.abort();throw controller.signal.reason})
 await internal.enrichNextIdleChart(controller.signal)
 const next=internal.store.getDocument(doc.id)
 expect(next.processing.revision).toBe(processing.revision)
 expect(next.deferredChartEnrichment).toBeUndefined()
 expect(next.rawText).toBe('Original searchable source text.')
 expect(internal.store.listChunksByDoc(doc.id).length).toBeGreaterThan(0)
})
it('an optional model failure keeps source text and records failure without an infinite retry loop',async()=>{
 const {internal,doc,extract,processing}=await fixture();extract.mockRejectedValue(new Error('model unavailable'))
 await internal.enrichNextIdleChart(new AbortController().signal)
 const next=internal.store.getDocument(doc.id)
 expect(next.processing.revision).toBe(processing.revision)
 expect(next.deferredChartEnrichment.status).toBe('failed')
 expect(next.rawText).toBe('Original searchable source text.')
 expect(await internal.enrichNextIdleChart(new AbortController().signal)).toBe(false)
})
