import {expect,it,vi} from 'vitest'
import {createManagedCaption} from '../src/knowledge/managed-caption.js'

function setup(stream: (...args: any[]) => AsyncIterable<any>) {
 const saveImage=vi.fn(async()=>({id:'image-ref'}))
 const llm={stream:vi.fn(stream)}
 const caption=createManagedCaption({get:name=>name==='llm'?llm:{saveImage}})
 return {caption,llm,saveImage}
}
it('uses host attachments and the managed model with bounded non-reasoning output',async()=>{
 const {caption,llm,saveImage}=setup(async function*(){
  yield {type:'reasoning-delta',text:'hidden'}
  yield {type:'text-delta',text:'A mountain.'}
  yield {type:'block-end',block:{type:'text',text:'A mountain.'}}
  yield {type:'finish',reason:{kind:'stop'}}
 })
 expect(await caption(new Uint8Array([1]),'ninfer/vision','Describe')).toBe('A mountain.')
 expect(saveImage).toHaveBeenCalledOnce()
 expect(llm.stream).toHaveBeenCalledWith(expect.objectContaining({provider:'ninfer',model:'vision',maxTokens:128,reasoningEffort:'off',messages:[{role:'user',content:[{type:'text',text:'Describe'},{type:'image',attachment:{id:'image-ref'}}]}]}))
})
it.each(['error','aborted','missing'])('rejects partial output on %s',async(kind)=>{
 const {caption}=setup(async function*(){yield {type:'text-delta',text:'partial'};if(kind!=='missing')yield {type:'finish',reason:{kind}}})
 await expect(caption(new Uint8Array(),'p/m','Describe')).rejects.toThrow()
})
it('serializes image requests and cancels queued requests without submitting them',async()=>{
 let release!:()=>void
 const wait=new Promise<void>(r=>{release=r})
 const {caption,llm,saveImage}=setup(async function*(){await wait;yield {type:'text-delta',text:'caption'};yield {type:'finish',reason:{kind:'stop'}}})
 const first=caption(new Uint8Array(),'p/m','Describe')
 const cancel=new AbortController()
 const queued=caption(new Uint8Array(),'p/m','Describe',cancel.signal)
 const rejected=expect(queued).rejects.toMatchObject({name:'AbortError'})
 cancel.abort();await rejected
 release();await first
 expect(llm.stream).toHaveBeenCalledOnce();expect(saveImage).toHaveBeenCalledOnce()
})
it('validates the managed model before saving an attachment',async()=>{
 const {caption,saveImage}=setup(async function*(){})
 await expect(caption(new Uint8Array(),'invalid','Describe')).rejects.toThrow('provider/model')
 expect(saveImage).not.toHaveBeenCalled()
})
