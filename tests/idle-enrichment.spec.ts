import {afterEach,expect,it,vi} from 'vitest'
import {IdleEnrichment} from '../src/knowledge/idle-enrichment.js'
afterEach(()=>vi.useRealTimers())
it('waits for imports and a quiet period, then interrupts active enrichment when foreground work arrives',async()=>{
 vi.useFakeTimers();let busy=true;let active:AbortSignal|undefined;let release!:()=>void
 const next=vi.fn(async(signal:AbortSignal)=>{active=signal;await new Promise<void>(r=>{release=r});return true})
 const runner=new IdleEnrichment(()=>busy,next,1000)
 await runner.tick();expect(next).not.toHaveBeenCalled()
 busy=false;vi.advanceTimersByTime(999);await runner.tick();expect(next).not.toHaveBeenCalled()
 vi.advanceTimersByTime(1);const task=runner.tick();expect(next).toHaveBeenCalledOnce()
 await runner.tick();expect(next).toHaveBeenCalledOnce()
 busy=true;await runner.tick();expect(active?.aborted).toBe(true)
 release();await task;runner.stop()
})
it('backs off empty scans rather than repeatedly scanning the entire library',async()=>{
 vi.useFakeTimers();const next=vi.fn(async()=>false);const runner=new IdleEnrichment(()=>false,next,0)
 await runner.tick();await runner.tick();expect(next).toHaveBeenCalledOnce()
 vi.advanceTimersByTime(30_000);await runner.tick();expect(next).toHaveBeenCalledTimes(2)
 runner.stop();vi.advanceTimersByTime(30_000);await runner.tick();expect(next).toHaveBeenCalledTimes(2)
})
