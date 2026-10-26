import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { PdfParserPool } from '../src/knowledge/pdf-parser-pool.js'
const pools: PdfParserPool[] = []
const fixture = fileURLToPath(new URL('./fixtures/pdf-parser-pool.mjs', import.meta.url))
function pool(timeout = 2000) { const value = new PdfParserPool(2, fixture, timeout); pools.push(value); return value }
afterEach(async () => { await Promise.all(pools.splice(0).map(value => value.dispose())) })
describe('independent PDF parser lanes', () => {
  it('parses concurrently without transferring away the caller’s input', async () => {
    const value = pool(), bytes = Buffer.from('slow')
    const slow = value.parse(bytes), fast = value.parse(Buffer.from('fast'))
    expect(await fast).toEqual({text:'fast', pages:undefined, scanned:undefined})
    expect((await slow).text).toBe('slow'); expect(bytes.toString()).toBe('slow')
  })
  it('contains a native failure to its lane and starts a replacement', async () => {
    const value = pool(), slow = value.parse(Buffer.from('slow'))
    await expect(value.parse(Buffer.from('crash'))).rejects.toThrow('exited')
    expect((await slow).text).toBe('slow')
    expect((await value.parse(Buffer.from('recovered'))).text).toBe('recovered')
  })
  it('bounds a stalled request and releases workers on plugin unload', async () => {
    const value = pool(250)
    await expect(value.parse(Buffer.from('hang'))).rejects.toThrow('timed out')
    const active = value.parse(Buffer.from('hang'))
    const rejected = expect(active).rejects.toMatchObject({code:'plugin_stopped'})
    await value.dispose(); await rejected
    await expect(value.parse(Buffer.from('late'))).rejects.toMatchObject({code:'plugin_stopped'})
  })
})

function textPdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let pdf='%PDF-1.4\n'; const offsets:number[]=[]
  objects.forEach((body,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${body}\nendobj\n`})
  const xref=Buffer.byteLength(pdf)
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')
  return Buffer.from(pdf+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
}
it('keeps real small PDF contents independent when reusing one parser worker',async()=>{
  const value=new PdfParserPool(1);pools.push(value)
  const texts=Array.from({length:8},(_,i)=>`Distinct source ${i} orbital navigation.`)
  const parsed=await Promise.all(texts.map(text=>value.parse(textPdf(text))))
  expect(parsed.map(row=>row.text.trim())).toEqual(texts)
})
