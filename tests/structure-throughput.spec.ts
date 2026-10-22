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
 @property
 def json(self):
  return {'res':{'parsing_res_list':[{'block_label':v,'block_content':v+' evidence'} for v in self.labels]}}
class Pipeline:
 def __init__(self):
  self.paddlex_pipeline=self
  self._pipeline=self
  self.layout_det_model=Layout().predict
 def predict(self, input, **kwargs):
  assert input in (['table'],['chart'])
  yield Result(input)
g['layout_pipeline']=lambda:Layout()
engine=Pipeline()
g['pipeline']=lambda charts:engine
r=m['extract']('source.pdf',True,True)
assert r['pageCount']==4
assert [b['page'] for b in r['blocks']]==[3,4]
r=m['extract']('source.pdf',False,True)
assert [b['type'] for b in r['blocks']]==['table']
class Empty:
 def predict(self, **kwargs):
  yield {'boxes':[], 'input_img':'unused'}
engine.layout_det_model=Empty().predict
assert m['extract']('source.pdf',True,True)=={'blocks':[],'pageCount':1}
print('ok')
`],{cwd:process.cwd(),encoding:'utf8'})
    expect(output.trim()).toBe('ok')
  })
})

it('uses reference crops for accelerated table pages and rejects screening false positives', () => {
  const output=execFileSync('python3',['-c',`
import runpy
m=runpy.run_path('scripts/structure-v3.py');g=m['extract'].__globals__
class Detector:
 def __init__(self):
  self.runner='accelerated';self._dsh_reference_runner='reference';self.refined=[]
 def __call__(self,input,**kwargs):
  if isinstance(input,str):
   assert kwargs['threshold']==0.25
   for page,label in [('plain','text'),('table','table'),('false_positive','chart')]:
    yield {'input_img':page,'boxes':[{'label':label}], 'crop':'approximate'}
  else:
   assert self.runner=='reference'
   page=input[0];self.refined.append(page)
   yield {'input_img':page,'boxes':[{'label':'table' if page=='table' else 'text'}], 'crop':'exact'}
class Engine:
 def __init__(self):self.paddlex_pipeline=self;self.layout_det_model=Detector()
engine=Engine();g['pipeline']=lambda charts:engine
class Result:
 json={'res':{'parsing_res_list':[{'block_label':'table','block_content':'original cells'}]}}
def predict(image,charts,layout):
 assert image=='table' and layout['crop']=='exact'
 yield Result()
g['predict_page']=predict
result=m['extract']('source.pdf',True,True)
assert result=={'pageCount':3,'blocks':[{'page':2,'type':'table','text':'original cells'}]}
assert engine.layout_det_model.refined==['table','false_positive']
assert engine.layout_det_model.runner=='accelerated'
print('ok')
`],{cwd:process.cwd(),encoding:'utf8'})
  expect(output.trim()).toBe('ok')
})

it('renders only the requested PDF pages and restores their absolute page numbers', () => {
  const output=execFileSync('python3',['-c',String.raw`
import runpy,sys,types,threading
m=runpy.run_path('scripts/structure-v3.py');g=m['extract_range'].__globals__
lock=threading.Lock()
sys.modules['paddlex.inference.utils.io.readers']=types.SimpleNamespace(pdfium_lock=lock)
rendered=[];closed=[]
class Page:
 def __init__(self,index):self.index=index
 def close(self):closed.append(self.index)
class Doc:
 def __len__(self):return 8
 def __getitem__(self,index):return Page(index)
 def close(self):closed.append('doc')
class Reader:
 def __init__(self):self._backend=self
 def load(self,source):
  with lock:return Doc()
 def _render_page(self,page,*,page_index):
  assert page_index==page.index+1
  rendered.append(page.index);return page.index
reader=Reader()
g['pipeline']=lambda charts:types.SimpleNamespace(paddlex_pipeline=types.SimpleNamespace(layout_det_model=types.SimpleNamespace(batch_sampler=types.SimpleNamespace(pdf_reader=reader))))
def extract(images,charts,tables):
 assert images==[2,3] and tables
 return {'pageCount':2,'blocks':[{'page':2,'type':'table','text':'original 123.45'}]}
g['extract']=extract
r=m['extract_range']('source.pdf',True,2,2)
assert r=={'pageCount':8,'pageStart':2,'pageEnd':4,'blocks':[{'page':4,'type':'table','text':'original 123.45'}]}
assert rendered==[2,3] and closed==[2,3,'doc']
for start,limit in [(8,1),(-1,1),(0,9),(True,1)]:
 try:m['extract_range']('source.pdf',True,start,limit)
 except ValueError:pass
 else:raise AssertionError('Invalid range accepted')
print('ok')
`],{cwd:process.cwd(),encoding:'utf8',timeout:5000})
  expect(output.trim()).toBe('ok')
})

it('batches chart crops in page order and restores model state on failures', () => {
 const output=execFileSync('python3',['-c',String.raw`
import sys,types,runpy
sys.path.insert(0,'scripts')
from structure_chart_batch import batch_chart_results
class Image:
 def __getitem__(self,slices):return tuple((s.start,s.stop) for s in slices[:2])
box={'label':'chart','coordinate':[1.9,2.1,8.9,9.8]}
pages=[(2,Image(),True,{'boxes':[box]}),(3,None,False,{'boxes':[]}),(5,Image(),True,{'boxes':[box,box]})]
class Model:
 def __init__(self):self.batch_sampler=types.SimpleNamespace(batch_size=1);self.fail=False;self.short=False
 def __call__(self,input):
  assert self.batch_sampler.batch_size==2
  assert all(item['image']==((2,9),(1,8)) for item in input)
  if self.fail:raise RuntimeError('device failure')
  return iter([{'result':str(i)} for i in range(len(input)-(1 if self.short else 0))])
model=Model()
assert batch_chart_results(pages,model)=={2:[{'result':'0'}],5:[{'result':'1'},{'result':'2'}]}
assert model.batch_sampler.batch_size==1
for mode in ['short','fail']:
 setattr(model,mode,True)
 try:batch_chart_results(pages,model)
 except RuntimeError:pass
 else:raise AssertionError('Invalid batch accepted')
 assert model.batch_sampler.batch_size==1
 setattr(model,mode,False)
m=runpy.run_path('scripts/structure-v3.py');g=m['predict_page'].__globals__
class Engine:
 def __init__(self):self.paddlex_pipeline=self;self._pipeline=self;self.layout_det_model='original layout';self.chart_recognition_model='original chart';self.fail=False
 def predict(self,input,**kwargs):
  assert list(self.chart_recognition_model(input=[input]))==[{'result':'cached value'}]
  if self.fail:raise RuntimeError('downstream failure')
  yield 'success'
engine=Engine();g['pipeline']=lambda charts:engine
assert list(m['predict_page']('image',True,{'boxes':[]},[{'result':'cached value'}]))==['success']
assert engine.layout_det_model=='original layout' and engine.chart_recognition_model=='original chart'
engine.fail=True
try:list(m['predict_page']('image',True,{'boxes':[]},[{'result':'cached value'}]))
except RuntimeError:pass
else:raise AssertionError('Expected failure')
assert engine.layout_det_model=='original layout' and engine.chart_recognition_model=='original chart'
print('ok')
`],{cwd:process.cwd(),encoding:'utf8',timeout:5000})
 expect(output.trim()).toBe('ok')
})

it('skips discarded OCR only for qualified single-chart enrichment pages', () => {
 const output=execFileSync('python3',['-c',String.raw`
import os,runpy,types
m=runpy.run_path('scripts/structure-v3.py');g=m['extract'].__globals__
os.environ['DSH_STRUCTURE_CHART_DIRECT']='1'
class Image:
 def __init__(self,page):self.page=page
 def __getitem__(self,slices):
  assert [(s.start,s.stop) for s in slices[:2]]==[(2,9),(1,8)]
  return self.page
chart={'label':'chart','coordinate':[1.5,2.5,8.5,9.5]}
pages=[(0,Image(1),True,{'boxes':[chart]}),(1,Image(2),True,{'boxes':[chart,chart]}),(2,Image(3),True,{'boxes':[chart,{'label':'table'}]})]
g['structure_inputs']=lambda *args:iter(pages)
full=[];direct=[]
class Model:
 def __call__(self,input):
  direct.extend(item['image'] for item in input)
  return iter([{'result':'preserved chart 123.45'}])
model=Model()
g['pipeline']=lambda charts:types.SimpleNamespace(paddlex_pipeline=types.SimpleNamespace(_pipeline=types.SimpleNamespace(chart_recognition_model=model)))
class Result:
 json={'res':{'parsing_res_list':[{'block_label':'table','block_content':'full table content'}]}}
def predict(image,charts,layout):full.append(image.page);yield Result()
g['predict_page']=predict
result=m['extract']('source.pdf',True,True)
assert direct==[1] and full==[2,3]
assert result['pageCount']==3 and result['blocks'][0]=={'page':1,'type':'chart','text':'preserved chart 123.45'}
full.clear();direct.clear()
m['extract']('source.pdf',True,False)
assert direct==[] and full==[1,2,3]
print('ok')
`],{cwd:process.cwd(),encoding:'utf8',timeout:5000})
 expect(output.trim()).toBe('ok')
})
