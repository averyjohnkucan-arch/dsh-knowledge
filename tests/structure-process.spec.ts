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
 it('contains broken stdin pipe errors without crashing the host',async()=>{
  const worker=new StructureProcess(process.execPath,['-e',program],process.env,'RESULT ')
  try{
   const pending=worker.request({wait:true},5000).catch(error=>error)
   const child=(worker as unknown as {child:{stdin:{emit(event:string,error:Error):void}}}).child
   const failure=Object.assign(new Error('broken pipe'),{code:'EPIPE'})
   expect(()=>child.stdin.emit('error',failure)).not.toThrow()
   expect((await pending).code).toBe('EPIPE');await worker.stopAndWait()
  }finally{worker.dispose()}
 })

})
