import {expect,it} from 'vitest'
import {ImportCheckpoints} from '../src/knowledge/import-checkpoints.js'
import {parsedTextDocument} from '../src/knowledge/parsed-document.js'
it('keeps stage snapshots separate and never treats source paths as checkpoint paths',async()=>{
 const checkpoints=await ImportCheckpoints.create()
 const a=parsedTextDocument('OCR text',new TextEncoder().encode('source'),'builtin','settings')
 const b={...a,document:{...a.document,text:'OCR text with table'}}
 try{
  await checkpoints.save('../../source.pdf','ocr',a)
  await checkpoints.save('../../source.pdf','parsing',b)
  expect(await checkpoints.load('../../source.pdf','ocr')).toEqual(a)
  expect(await checkpoints.load('../../source.pdf','parsing')).toEqual(b)
  await checkpoints.remove('../../source.pdf','ocr')
  await expect(checkpoints.load('../../source.pdf','ocr')).rejects.toThrow()
  expect(await checkpoints.load('../../source.pdf','parsing')).toEqual(b)
 }finally{await checkpoints.close()}
 await expect(checkpoints.load('../../source.pdf','parsing')).rejects.toThrow('closed')
 await checkpoints.close()
})
