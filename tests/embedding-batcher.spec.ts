import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddingBatcher } from '../src/knowledge/embedding-batcher.js'
afterEach(() => vi.useRealTimers())
describe('GPU micro-batching', () => {
  it('coalesces requests, bounds batch size and keeps vector order', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async (texts: string[]) => ({ vectors: texts.map(text => [Number(text)]), elapsedMs: 12 }))
    const queue = new EmbeddingBatcher(execute, 2)
    const jobs = [queue.request('1'), queue.request('2'), queue.request('3')]
    await vi.advanceTimersByTimeAsync(20)
    expect((await Promise.all(jobs)).map(r => r.vector)).toEqual([[1],[2],[3]])
    expect(execute.mock.calls.map(([texts]) => texts)).toEqual([['1','2'],['3']])
  })
  it('groups similar lengths and bounds padded work without changing result order', async () => {
    vi.useFakeTimers()
    const execute = vi.fn(async (texts: string[]) => ({ vectors: texts.map(text => [text.length]), elapsedMs: 10 }))
    const queue = new EmbeddingBatcher(execute, 16)
    const lengths = [5000, 20, 5001, 20, 9000, 9001, 9002, 9003]
    const jobs = lengths.map(length => queue.request('x'.repeat(length)))
    await vi.advanceTimersByTimeAsync(50)
    expect((await Promise.all(jobs)).map(result => result.vector[0])).toEqual(lengths)
    expect(execute.mock.calls[0][0].map(text => text.length)).toEqual([5000, 5001])
    for (const [texts] of execute.mock.calls) expect(Math.max(...texts.map(text => text.length)) * texts.length).toBeLessThanOrEqual(32768)
  })
  it('lets retrieval jump ahead of queued indexing after the current job', async () => {
    vi.useFakeTimers()
    let finish!:()=>void
    const gate=new Promise<void>(resolve=>{finish=resolve})
    const calls:string[]=[]
    const queue=new EmbeddingBatcher(async texts=>{calls.push(texts[0]);if(texts[0]==='active')await gate;return {vectors:[[1]],elapsedMs:1}},1)
    const active=queue.request('active')
    await vi.advanceTimersByTimeAsync(3)
    const bulk=queue.request('queued bulk'),query=queue.request('question','query')
    finish();await active;await vi.advanceTimersByTimeAsync(20);await Promise.all([bulk,query])
    expect(calls).toEqual(['active','question','queued bulk'])
  })
  it('rejects undispatched work immediately when the GPU is needed', async () => {
    vi.useFakeTimers(); const execute = vi.fn(async () => ({vectors:[[1]],elapsedMs:1}))
    const queue = new EmbeddingBatcher(execute)
    const job = queue.request('waiting'); const result = expect(job).rejects.toThrow('yielded')
    queue.pause(); await result; await vi.advanceTimersByTimeAsync(20)
    expect(execute).not.toHaveBeenCalled()
    queue.resume();const resumed=queue.request('ready');await vi.advanceTimersByTimeAsync(5);expect((await resumed).vector).toEqual([1])
  })
  it('expires only the queued query and preserves active and queued indexing', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const calls: string[] = []
    const queue = new EmbeddingBatcher(async texts => {
      calls.push(texts[0]); if (texts[0] === 'active') await gate
      return { vectors: [[1]], elapsedMs: 1 }
    }, 1)
    const active = queue.request('active')
    await vi.advanceTimersByTimeAsync(3)
    const bulk = queue.request('bulk')
    const query = queue.request('question', 'query', 5000)
    const expired = expect(query).rejects.toThrow('queue wait budget')
    await vi.advanceTimersByTimeAsync(5000); await expired
    expect(calls).toEqual(['active'])
    finish(); await active; await vi.advanceTimersByTimeAsync(10); await bulk
    expect(calls).toEqual(['active', 'bulk'])
  })
  it('clears the queue deadline when query inference starts', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const queue = new EmbeddingBatcher(async () => { await gate; return { vectors: [[1]], elapsedMs: 6000 } }, 1)
    const query = queue.request('question', 'query', 5000)
    await vi.advanceTimersByTimeAsync(6000)
    finish(); expect((await query).vector).toEqual([1])
  })

})
