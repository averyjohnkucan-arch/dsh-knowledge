import { describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
const state = vi.hoisted(() => ({ active: 0, peak: 0, releases: [] as Array<() => void> }))
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), availableParallelism: () => 24, freemem: () => 32 * 1024 ** 3 }))
vi.mock('../src/knowledge/embed.js', () => ({localModelCacheDir: () => '/unused'}))
vi.mock('../src/knowledge/parse.js', () => ({extractHtmlToMarkdown: async (text: string) => text}))
vi.mock('../src/knowledge/structure-process.js', () => ({StructureProcess: class {
  async request(payload: {output: string}) {
    state.peak = Math.max(state.peak, ++state.active)
    await new Promise<void>(resolve => state.releases.push(resolve))
    await writeFile(payload.output, JSON.stringify({pageCount: 1, blocks: [{page: 1, type: 'table', text: 'retained evidence'}]}))
    state.active--
  }
  dispose() {}
}}))
import { StructureV3Manager } from '../src/knowledge/structure-v3.js'
describe('bounded structure worker pool', () => {
  it('runs two independent documents and cancels a queued document without dispatching it', async () => {
    const manager = new StructureV3Manager()
    vi.spyOn(manager, 'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
    const first = manager.extract(new Uint8Array([1]), 'a', true, 1000)
    const second = manager.extract(new Uint8Array([2]), 'b', true, 1000)
    await vi.waitFor(() => expect(state.active).toBe(2))
    const abort = new AbortController()
    const third = manager.extract(new Uint8Array([3]), 'c', true, 1000, abort.signal)
    const rejected = expect(third).rejects.toMatchObject({name:'AbortError'})
    try {
      await vi.waitFor(() => expect(state.active).toBe(2))
      abort.abort(); await rejected
      state.releases.splice(0).forEach(release => release())
      const results = await Promise.all([first, second])
      expect(results.map(result => result.document.blocks[0].text)).toEqual(['retained evidence','retained evidence'])
      expect(state.peak).toBe(2)
    } finally { state.releases.splice(0).forEach(release => release()); manager.dispose() }
  })
})

describe('structure accelerator handoff', () => {
  it('retries a failed accelerated document on CPU without committing partial output', async () => {
    const manager = new StructureV3Manager()
    vi.spyOn(manager, 'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
    const internal = manager as unknown as {layoutDevice(): Promise<string>; worker(device: string): any}
    vi.spyOn(internal, 'layoutDevice').mockResolvedValue('NPU')
    const npu = {device:'NPU',busy:false,disabled:false,process:{request:vi.fn(async()=>{throw Error('NPU reset')}),stopAndWait:vi.fn(async()=>{}),dispose(){}}}
    const cpu = {device:'CPU',busy:false,process:{request:vi.fn(async(payload:{output:string})=>{
      await writeFile(payload.output,JSON.stringify({pageCount:2,blocks:[{page:2,type:'table',text:'complete CPU recovery'}]}))
    }),dispose(){}}}
    const worker = vi.spyOn(internal, 'worker').mockImplementation(device=>device==='CPU'?cpu:npu)
    try {
      const result = await manager.extract(new Uint8Array([1]),'recovery',true,1000)
      expect(result.document.blocks[0]).toMatchObject({text:'complete CPU recovery',pageIndex:1})
      expect(worker.mock.calls.map(([device])=>device)).toEqual(['NPU','CPU'])
      expect(npu.disabled).toBe(true);expect(npu.process.stopAndWait).toHaveBeenCalledOnce()
    } finally { manager.dispose() }
  })
  it('finishes current accelerator work before granting chat and uses CPU during nested reservations', async () => {
    const manager = new StructureV3Manager()
    let finish!:()=>void
    const lane = {device:'NPU',busy:true,disabled:false,current:new Promise<void>(resolve=>{finish=resolve}),process:{stopAndWait:vi.fn(async()=>{}),dispose(){}}}
    Object.assign(manager,{workers:[lane]})
    const internal = manager as unknown as {layoutDevice(): Promise<string>}
    const entering = manager.enterForeground()
    expect(lane.disabled).toBe(true);expect(lane.process.stopAndWait).not.toHaveBeenCalled()
    finish();const release=await entering
    expect(lane.process.stopAndWait).toHaveBeenCalledOnce()
    expect(await internal.layoutDevice()).toBe('CPU')
    const nested=await manager.enterForeground();nested()
    expect(await internal.layoutDevice()).toBe('CPU')
    release();release();manager.dispose()
  })
  it('stops an unresponsive accelerator after ten seconds', async () => {
    vi.useFakeTimers()
    const manager = new StructureV3Manager()
    const lane = {device:'GPU',busy:true,current:new Promise(()=>{}),process:{stopAndWait:vi.fn(async()=>{}),dispose(){}}}
    Object.assign(manager,{workers:[lane]})
    try {
      const entering=manager.enterForeground()
      await vi.advanceTimersByTimeAsync(9999);expect(lane.process.stopAndWait).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1);const release=await entering
      expect(lane.process.stopAndWait).toHaveBeenCalledOnce();release()
    } finally {manager.dispose();vi.useRealTimers()}
  })
})

it('runs NVIDIA structure alongside two CPU/Intel jobs and releases device memory at stage completion', async () => {
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
  const internal=manager as unknown as {layoutDevice():Promise<string>;worker(device:string):any}
  vi.spyOn(internal,'layoutDevice').mockResolvedValueOnce('NPU').mockResolvedValueOnce('GPU').mockResolvedValueOnce('CUDA')
  const releases:Array<()=>void>=[]
  const lanes=['NPU','GPU','CUDA'].map(device=>({device,busy:false,process:{
    request:vi.fn(async(payload:{output:string})=>{
      await new Promise<void>(resolve=>releases.push(resolve))
      await writeFile(payload.output,JSON.stringify({pageCount:1,blocks:[{page:1,type:'table',text:device+' evidence'}]}))
    }),stopAndWait:vi.fn(async()=>{}),dispose(){},
  }}))
  Object.assign(manager,{workers:lanes,workerRoot:manager.root()})
  vi.spyOn(internal,'worker').mockImplementation(device=>lanes.find(lane=>lane.device===device))
  const jobs=lanes.map((_,i)=>manager.extract(new Uint8Array([i]),String(i),true,1000))
  try {
    await vi.waitFor(()=>expect(releases).toHaveLength(3))
    releases.splice(0).forEach(release=>release())
    const results=await Promise.all(jobs)
    expect(results.map(result=>result.document.blocks[0].text).sort()).toEqual(['CUDA evidence','GPU evidence','NPU evidence'])
    for(const lane of lanes)expect(lane.process.stopAndWait).toHaveBeenCalledOnce()
  } finally {releases.splice(0).forEach(release=>release());manager.dispose()}
})

it.each(['available', 'busy', 'foreground'] as const)('takes a second Intel activity sample before admission: %s', async mode => {
  const {mkdtemp,mkdir,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const root=await mkdtemp(join(tmpdir(),'structure-admission-'))
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'root').mockReturnValue(root)
  await mkdir(join(root,'layout-openvino'))
  await writeFile(join(root,'layout-openvino/ready.json'),JSON.stringify({schema:1,model:'PP-DocLayout_plus-L',devices:['GPU']}))
  const sample=vi.fn().mockImplementationOnce(async()=>{
    if(mode==='foreground') Object.assign(manager,{foreground:1})
    return {available:false,reason:'Measuring Intel GPU activity'}
  }).mockResolvedValue({available:mode==='available',reason:mode==='available'?'Intel GPU engines are available':'Another application is using Intel GPU engines'})
  Object.assign(manager,{intelAvailability:{sample}})
  try {
    const device=await (manager as unknown as {layoutDevice():Promise<string>}).layoutDevice()
    expect(device).toBe(mode==='available'?'GPU':'CPU')
    expect(sample).toHaveBeenCalledTimes(mode==='foreground'?1:2)
  } finally {manager.dispose();await rm(root,{recursive:true,force:true})}
})

it('distributes one long PDF across devices in bounded ranges and commits complete ordered pages', async () => {
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
  const internal=manager as unknown as {layoutDevice():Promise<string>;worker(device:string):any;reservedDevices:Set<string>}
  const calls:Array<{device:string;start:number;limit:number;input:string}>=[]
  let active=0,peak=0
  const lanes=['CUDA','CUDA:1','NPU','GPU'].map(device=>({device,busy:false,process:{
    request:vi.fn(async(payload:{input:string;output:string;startPage:number;pageLimit:number})=>{
      calls.push({device,start:payload.startPage,limit:payload.pageLimit,input:payload.input})
      peak=Math.max(peak,++active)
      await new Promise(resolve=>setTimeout(resolve,device.startsWith('CUDA')?1:15))
      const end=Math.min(33,payload.startPage+payload.pageLimit)
      await writeFile(payload.output,JSON.stringify({pageCount:33,pageStart:payload.startPage,pageEnd:end,
        blocks:Array.from({length:end-payload.startPage},(_,i)=>({page:payload.startPage+i+1,type:'table',text:`page ${payload.startPage+i+1}`}))}))
      active--
    }),stopAndWait:vi.fn(async()=>{}),dispose(){},
  }}))
  Object.assign(manager,{workers:lanes,workerRoot:manager.root()})
  vi.spyOn(internal,'layoutDevice').mockImplementation(async()=>{
    const lane=lanes.find(lane=>!lane.busy&&!internal.reservedDevices.has(lane.device))!
    internal.reservedDevices.add(lane.device)
    return lane.device
  })
  vi.spyOn(internal,'worker').mockImplementation(device=>lanes.find(lane=>lane.device===device))
  try {
    const result=await manager.extract(Buffer.from('%PDF-test'),'ranges',true,1000,undefined,true)
    expect(result.document.blocks.map(block=>block.pageIndex)).toEqual(Array.from({length:33},(_,i)=>i))
    expect(result.document.processedPages).toHaveLength(33)
    expect(new Set(calls.map(call=>call.input)).size).toBe(1)
    expect(new Set(calls.map(call=>call.device))).toEqual(new Set(['CUDA','CUDA:1','NPU','GPU']))
    expect(calls.filter(call=>call.device.startsWith('CUDA')).some(call=>call.limit===8)).toBe(true)
    expect(calls.filter(call=>!call.device.startsWith('CUDA')).every(call=>call.limit===1)).toBe(true)
    expect(peak).toBe(4)
    const metrics=(manager as unknown as {measurements:Map<string,{pages:number;requests:number;seconds:number}>}).measurements
    expect([...metrics.values()].reduce((sum,value)=>sum+value.pages,0)).toBe(33)
    expect(metrics.size).toBe(4)
    expect([...metrics.values()].every(value=>value.requests>0&&value.seconds>0)).toBe(true)
  } finally {manager.dispose()}
})

it('rejects incomplete page ranges instead of marking the PDF complete', async () => {
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
  const internal=manager as unknown as {layoutDevice():Promise<string>;worker(device:string):any}
  vi.spyOn(internal,'layoutDevice').mockResolvedValue('CPU')
  vi.spyOn(internal,'worker').mockImplementation(()=>({busy:false,device:'CPU',process:{
    request:async(payload:{output:string;startPage:number;pageLimit:number})=>{
      await writeFile(payload.output,JSON.stringify({pageCount:3,pageStart:payload.startPage,
        pageEnd:payload.startPage===0?1:payload.startPage,blocks:[]}))
    },dispose(){},
  }}))
  try {
    await expect(manager.extract(Buffer.from('%PDF-test'),'incomplete',true,1000,undefined,true)).rejects.toThrow('Incomplete PP-StructureV3 page range')
  }finally{manager.dispose()}
})

it('retries only the failed range on CPU and retains already completed pages', async () => {
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'status').mockResolvedValue({status:'ready',progress:100,message:'',device:'cpu'})
  const internal=manager as unknown as {layoutDevice():Promise<string>;worker(device:string):any}
  vi.spyOn(internal,'layoutDevice').mockResolvedValueOnce('CPU').mockResolvedValueOnce('CUDA').mockResolvedValue('CPU')
  const calls:Array<{device:string;start:number;limit:number}>=[]
  vi.spyOn(internal,'worker').mockImplementation(device=>({device,busy:false,disabled:false,process:{
    request:async(payload:{output:string;startPage:number;pageLimit:number})=>{
      calls.push({device,start:payload.startPage,limit:payload.pageLimit})
      if(device==='CUDA')throw Error('device reset')
      const end=Math.min(12,payload.startPage+payload.pageLimit)
      await writeFile(payload.output,JSON.stringify({pageCount:12,pageStart:payload.startPage,pageEnd:end,
        blocks:Array.from({length:end-payload.startPage},(_,i)=>({page:payload.startPage+i+1,type:'table',text:`value ${payload.startPage+i}`}))}))
    },stopAndWait:async()=>{},dispose(){},
  }}))
  try {
    const result=await manager.extract(Buffer.from('%PDF-test'),'retry-ranges',true,1000,undefined,true)
    expect(result.document.blocks.map(block=>block.pageIndex)).toEqual(Array.from({length:12},(_,i)=>i))
    expect(calls.filter(call=>call.start===0)).toHaveLength(1)
    expect(calls.filter(call=>call.start===1)).toEqual([{device:'CUDA',start:1,limit:8},{device:'CPU',start:1,limit:8}])
  } finally {manager.dispose()}
})

it.each([[25000,['CUDA','CUDA:1']],[12000,['CUDA','CPU']],[4000,['CPU','CPU']]] as const)('reserves loading VRAM before admitting parallel CUDA workers: %i MiB', async (free,expected) => {
  const {mkdtemp,rm}=await import('node:fs/promises')
  const {tmpdir}=await import('node:os')
  const {join}=await import('node:path')
  const availability=await import('../src/knowledge/embedding-device-availability.js')
  const probe=vi.spyOn(availability,'nvidiaEmbeddingAvailability').mockResolvedValue({available:true,freeMiB:free,reason:'available'})
  const root=await mkdtemp(join(tmpdir(),'structure-vram-'))
  const manager=new StructureV3Manager()
  vi.spyOn(manager,'root').mockReturnValue(root)
  await writeFile(join(root,'gpu-ready.json'),JSON.stringify({schema:1,paddleocr:'3.7.0',precision:'float32',tf32:false}))
  const internal=manager as unknown as {layoutDevice():Promise<string>}
  try {
    expect((await Promise.all([internal.layoutDevice(),internal.layoutDevice()])).sort()).toEqual([...expected].sort())
    expect(await internal.layoutDevice()).toBe('CPU')
  }finally{manager.dispose();probe.mockRestore();await rm(root,{recursive:true,force:true})}
})
