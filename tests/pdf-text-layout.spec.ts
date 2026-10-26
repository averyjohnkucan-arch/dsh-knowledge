import { describe, expect, it } from 'vitest'
import { joinPdfTextItems } from '../src/knowledge/pdf-text-layout.mjs'
const word=(str:string,x:number,y:number,width=20)=>({str,transform:[10,0,0,10,x,y],height:10,width})
describe('PDF text run assembly',()=>{
  it('joins tiny baseline drift without fusing separate words',()=>{
    expect(joinPdfTextItems([word('The',0,700),word('telemetry',25,699.8,45),word('system',75,700.2)])).toBe('The telemetry system')
  })
  it('retains separate lines and original column order',()=>{
    expect(joinPdfTextItems([word('left top',0,700),word('left next',0,685),word('right top',200,700)])).toBe('left top\nleft next\nright top')
  })
  it('joins glyphs without spaces and preserves CJK text',()=>{
    expect(joinPdfTextItems([word('a',0,700,5),word('b',5,700,5)])).toBe('ab')
    expect(joinPdfTextItems([word('中',0,700,10),word('文',10,700,10)])).toBe('中文')
  })
  it('removes discretionary soft-hyphen wraps but retains ordinary hyphens',()=>{
    expect(joinPdfTextItems([word('sys\u00ad',0,700),word('tem',0,680),word('gas-filled',25,680)])).toBe('system gas-filled')
  })
})
