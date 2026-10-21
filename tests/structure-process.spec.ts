import { describe, expect, it } from 'vitest'
import { StructureProcess } from '../src/knowledge/structure-process.js'
const program = `require('readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);if(!x.wait)console.log('RESULT '+JSON.stringify({id:x.id,ok:true}));});`
const alive = (pid: number) => { try { process.kill(pid,0); return true } catch { return false } }
describe('owned inference worker exit barrier',()=>{
 it('waits until the GPU worker process exits',async()=>{
  const worker=new StructureProcess(process.execPath,['-e',program],process.env,'RESULT ')
  try { await worker.request({},5000);const pid=worker.pid!;expect(alive(pid)).toBe(true);await worker.stopAndWait();expect(alive(pid)).toBe(false) } finally {worker.dispose()}
 })
 it('also waits for a worker already stopped by request cancellation',async()=>{
  const worker=new StructureProcess(process.execPath,['-e',program],process.env,'RESULT ')
  try {
   await worker.request({},5000);const pid=worker.pid!,abort=new AbortController()
   const request=worker.request({wait:true},5000,abort.signal).catch(error=>error)
   abort.abort();await worker.stopAndWait();expect(alive(pid)).toBe(false);expect((await request).message).toMatch(/canceled/)
  } finally {worker.dispose()}
 })
})
