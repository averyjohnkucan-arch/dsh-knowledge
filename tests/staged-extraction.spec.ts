import {beforeEach,expect,it,vi} from 'vitest'
import {ArtifactRepository} from '../src/knowledge/artifacts.js'
import {extractDocumentContent,enrichDocumentContent,processDocumentFile} from '../src/knowledge/document-processing.js'
import {runImportStages} from '../src/knowledge/import-stages.js'
import type {KnowledgeConfig} from '../src/knowledge/types.js'
import type {ProcessingOutput} from '../src/knowledge/processing-types.js'
const mocks=vi.hoisted(()=>({parse:vi.fn(),caption:vi.fn()}))
vi.mock('../src/knowledge/parse.js',()=>({extensionOf:(name:string)=>name.split('.').at(-1),parseDocumentBuffer:mocks.parse}))
vi.mock('../src/knowledge/caption.js',()=>({captionPdfImages:mocks.caption}))
const config={documentProcessorProvider:'builtin',imageCaptionProvider:'paddle'} as KnowledgeConfig
beforeEach(()=>{mocks.parse.mockReset().mockResolvedValue('source text');mocks.caption.mockReset().mockResolvedValue('table content')})
it('publishes prepared output without invoking source OCR or enrichment twice',async()=>{
 const input={bytes:new TextEncoder().encode('PDF source'),fileName:'sample.pdf',config}
 const extracted=await extractDocumentContent(input)
 expect(mocks.caption).not.toHaveBeenCalled()
 const prepared=await enrichDocumentContent(input,extracted)
 const artifacts=new ArtifactRepository()
 const result=await processDocumentFile({...input,prepared,artifacts,baseId:'base',documentId:'doc'})
 expect(result.text).toBe('source text\n\ntable content')
 expect(mocks.parse).toHaveBeenCalledOnce();expect(mocks.caption).toHaveBeenCalledOnce()
 expect(await artifacts.getJob('base','doc')).toMatchObject({state:'completed'})
})
it('runs extraction for the entire import before any table/chart parsing',async()=>{
 const items=Array.from({length:5},(_,i)=>({id:String(i),bytes:new TextEncoder().encode(`PDF source ${i}`),fileName:'sample.pdf',config}))
 const prepared=new Map<string,ProcessingOutput>();const artifacts=new ArtifactRepository()
 mocks.caption.mockImplementation(async()=>{expect(mocks.parse).toHaveBeenCalledTimes(5);return 'table content'})
 const result=await runImportStages({items,signal:new AbortController().signal,concurrency:()=>2,execute:async(stage,item)=>{
   if(stage==='ocr')prepared.set(item.id,await extractDocumentContent(item))
  else if(stage==='parsing')prepared.set(item.id,await enrichDocumentContent(item,prepared.get(item.id)!))
  else if(stage==='chunking'){
   expect(mocks.caption).toHaveBeenCalledTimes(5)
   await processDocumentFile({...item,prepared:prepared.get(item.id),artifacts,baseId:'base',documentId:item.id})
  }else for(const doc of items)expect(await artifacts.getJob('base',doc.id)).toMatchObject({state:'completed'})
 }})
 expect(result.completed).toHaveLength(5);expect(result.failures).toEqual([])
 expect(mocks.parse).toHaveBeenCalledTimes(5);expect(mocks.caption).toHaveBeenCalledTimes(5)
})
it('rejects stale prepared content instead of silently rerunning OCR in a later stage',async()=>{
 const input={bytes:new TextEncoder().encode('source'),fileName:'sample.pdf',config}
 const prepared=await enrichDocumentContent(input,await extractDocumentContent(input))
 const artifacts=new ArtifactRepository()
 await expect(processDocumentFile({...input,bytes:new TextEncoder().encode('changed'),prepared,artifacts,baseId:'base',documentId:'doc'})).rejects.toMatchObject({code:'prepared_source_changed'})
 expect(mocks.parse).toHaveBeenCalledOnce();expect(mocks.caption).toHaveBeenCalledOnce()
 expect(await artifacts.getJob('base','doc')).toMatchObject({state:'failed'})
})

it('defers detailed charts without delaying text extraction or calling the chart model',async()=>{
 const input={bytes:new TextEncoder().encode('source'),fileName:'sample.pdf',config:{...config,deferredChartEnrichment:true}}
 const output=await extractDocumentContent(input)
 expect(await enrichDocumentContent(input,output)).toBe(output)
 expect(mocks.caption).not.toHaveBeenCalled()
})

it('keeps deferred photos out of the initial import even when a vision provider is selected',async()=>{
 const input={bytes:new TextEncoder().encode('source'),fileName:'sample.pdf',config:{...config,imageCaptionProvider:'dsh' as const,deferredPhotoCaptions:true}}
 const output=await extractDocumentContent(input)
 expect(await enrichDocumentContent(input,output)).toBe(output)
 expect(mocks.caption).not.toHaveBeenCalled()
})
