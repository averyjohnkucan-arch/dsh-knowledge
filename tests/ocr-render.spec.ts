import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { streamOcrRasters, disposeOcrRenderers } from '../src/knowledge/ocr-render-client.js'
const fixture=fileURLToPath(new URL('./fixtures/ocr-render.mjs',import.meta.url))
const limits={maxPages:100,pageBytes:96*1024**2,totalBytes:256*1024**2,maxDimension:16384,timeoutMs:3000,window:1}
afterEach(()=>disposeOcrRenderers())
describe('isolated streamed OCR rendering',()=>{
 it('starts recognition on page one and applies backpressure before rendering the whole document',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve}),seen:number[]=[]
  const pending=streamOcrRasters(Buffer.from('ready'),undefined,limits,async page=>{seen.push(page);if(page===1)await gate},fixture)
  while(!seen.length)await new Promise(resolve=>setTimeout(resolve,10))
  await new Promise(resolve=>setTimeout(resolve,50));expect(seen).toEqual([1]);release()
  expect(await pending).toBe(true);expect(seen).toEqual([1,2,3])
 })
 it('never reports a successful prefix when a later page fails',async()=>{
  await expect(streamOcrRasters(Buffer.from('fail'),undefined,limits,async()=>{},fixture)).rejects.toThrow('broken page 2')
 })
 it('contains native renderer crashes and enforces the document deadline',async()=>{
  await expect(streamOcrRasters(Buffer.from('crash'),undefined,limits,async()=>{},fixture)).rejects.toThrow('renderer exited')
  await expect(streamOcrRasters(Buffer.from('hang'),undefined,{...limits,timeoutMs:100},async()=>{},fixture)).rejects.toThrow('timed out')
 })
 it('stops rendering if OCR rejects a page',async()=>{
  await expect(streamOcrRasters(Buffer.from('ready'),undefined,limits,async()=>{throw Error('OCR failed')},fixture)).rejects.toThrow('OCR failed')
 })
})
