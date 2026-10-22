import {describe,expect,it}from'vitest'
import {MIN_OCR_AGREEMENT,ocrTextAgreement}from'../src/knowledge/ocr-quality.js'
describe('tolerant OCR backend qualification',()=>{
 const page='The archival correspondence explains the committee proceedings and records the approved meeting date in December. '.repeat(12)
 it('accepts case, punctuation, spacing and small decoding differences',()=>{
  expect(ocrTextAgreement(page,page.toUpperCase())).toBe(1)
  expect(ocrTextAgreement(page,page.replace('committee','commitee').replace('December','Decernber'))).toBeGreaterThan(MIN_OCR_AGREEMENT)
 })
 it('rejects missing paragraphs, unrelated output and insufficient short evidence',()=>{
  expect(ocrTextAgreement(page,page.slice(0,100))).toBeLessThan(MIN_OCR_AGREEMENT)
  expect(ocrTextAgreement(page,'completely unrelated recognized evidence '.repeat(20))).toBeLessThan(MIN_OCR_AGREEMENT)
  expect(ocrTextAgreement('Invoice 123','Invoice 128')).toBe(0)
  expect(ocrTextAgreement('',page)).toBe(0)
 })
 it('preserves Unicode evidence and scales linearly on long pages',()=>{
  expect(ocrTextAgreement('档案 文本 １２３','档案文本123')).toBe(1)
  expect(ocrTextAgreement(page.repeat(100),page.repeat(100))).toBe(1)
 })
})

it('rejects changed numeric meaning even when the surrounding page is identical', () => {
  const context = 'The reported measurement was recorded and independently reviewed. '.repeat(30)
  for (const [before, after] of [['1.25', '125'], ['-12', '12'], ['17%', '17'], ['10 20', '20 10']]) {
    expect(ocrTextAgreement(context + before, context + after)).toBe(0)
  }
  expect(ocrTextAgreement(context + '−12', context + '-12')).toBe(1)
  expect(ocrTextAgreement(context + '17', context.replaceAll('.', ',') + '17')).toBe(1)
})
