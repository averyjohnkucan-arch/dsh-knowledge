import { describe, expect, it, vi, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactRepository } from '../src/knowledge/artifacts.js'
import { ProcessingQueue } from '../src/knowledge/processing-queue.js'
import { processDocumentFile } from '../src/knowledge/document-processing.js'
import { ocrDeviceWorkActive } from '../src/knowledge/ocr-acceleration.js'
import type { KnowledgeConfig } from '../src/knowledge/types.js'
const mocks = vi.hoisted(() => ({ parse: vi.fn(), caption: vi.fn() }))
vi.mock('../src/knowledge/parse.js', () => ({extensionOf: (name: string) => name.split('.').at(-1), parseDocumentBuffer: mocks.parse}))
vi.mock('../src/knowledge/caption.js', () => ({captionPdfImages: mocks.caption}))
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); for (const dir of roots.splice(0)) await rm(dir, {recursive:true,force:true}) })
describe('structure throughput', () => {
  it('does not let structure enrichment block another document from parsing', async () => {
    const root=await mkdtemp(join(tmpdir(),'dsh-structure-gate-'));roots.push(root)
    const artifacts=new ArtifactRepository(root), queue=new ProcessingQueue(1)
    const signal=new AbortController().signal
    let finish!: () => void, captionStarted!: () => void
    const started=new Promise<void>(resolve=>{captionStarted=resolve})
    const held=new Promise<string>(resolve=>{finish=()=>resolve('table data')})
    mocks.parse.mockResolvedValue('ordinary source text')
    mocks.caption.mockImplementation(()=>{captionStarted();return held})
    const input={artifacts,baseId:'base',bytes:new TextEncoder().encode('source'),signal,
      runParsing:<T>(task:()=>Promise<T>)=>queue.run(task,signal)}
    const pdf=processDocumentFile({...input,documentId:'pdf',fileName:'scan.pdf',config:{documentProcessorProvider:'builtin',imageCaptionProvider:'paddle'} as KnowledgeConfig})
    await started
    const markdown=await processDocumentFile({...input,documentId:'markdown',fileName:'text.md',config:{documentProcessorProvider:'builtin',imageCaptionProvider:'off'} as KnowledgeConfig})
    expect(markdown.text).toBe('ordinary source text')
    finish();expect((await pdf).text).toContain('table data')
  })
  it('keeps devices warm between documents, drains queued work, and yields immediately to inference', () => {
    expect(ocrDeviceWorkActive(0,1,0,60_001)).toBe(true)
    expect(ocrDeviceWorkActive(0,1,0,300_001)).toBe(false)
    expect(ocrDeviceWorkActive(0,1,2,400_001)).toBe(true)
    expect(ocrDeviceWorkActive(1,1,2,2)).toBe(false)
  })
  it('skips full OCR on text-only pages but preserves tables, charts, original page numbers and empty results', () => {
    const output=execFileSync('python3',['-c',`
import runpy, json, pathlib
m=runpy.run_path('scripts/structure-v3.py')
g=m['extract'].__globals__
class Layout:
 def predict(self, **kwargs):
  for labels in [[],['text'],['table'],['chart']]:
   yield {'boxes':[{'label':v} for v in labels], 'input_img':labels}
class Result:
 def __init__(self, labels): self.labels=labels
 def save_to_json(self, save_path):
  pathlib.Path(save_path).write_text(json.dumps({'parsing_res_list':[{'block_label':v,'block_content':v+' evidence'} for v in self.labels]}))
class Pipeline:
 def predict(self, input, **kwargs):
  assert input in (['table'],['chart'])
  yield Result(input)
g['layout_pipeline']=lambda:Layout()
g['pipeline']=lambda charts:Pipeline()
r=m['extract']('source.pdf',True,True)
assert r['pageCount']==4
assert [b['page'] for b in r['blocks']]==[3,4]
r=m['extract']('source.pdf',False,True)
assert [b['type'] for b in r['blocks']]==['table']
class Empty:
 def predict(self, **kwargs):
  yield {'boxes':[], 'input_img':'unused'}
g['layout_pipeline']=lambda:Empty()
assert m['extract']('source.pdf',True,True)=={'blocks':[],'pageCount':1}
print('ok')
`],{cwd:process.cwd(),encoding:'utf8'})
    expect(output.trim()).toBe('ok')
  })
})
