import { describe, expect, it } from 'vitest'
import { resolveEmbeddingCpuTuning, orderedEmbeddingLanes } from '../src/knowledge/embedding-tuning.js'
describe('bounded embedding CPU lanes', () => {
 it('selects measured two-by-eight default and bounds user settings to CPU and RAM', () => {
  expect(resolveEmbeddingCpuTuning({},24,16*1024**3)).toEqual({threads:8,instances:2,microBatch:1})
  expect(resolveEmbeddingCpuTuning({threads:64,instances:4},8,2*1024**3)).toEqual({threads:8,instances:1,microBatch:1})
  expect(resolveEmbeddingCpuTuning({threads:NaN,instances:-2,microBatch:Infinity},4,1024**3)).toEqual({threads:4,instances:1,microBatch:1})
 })
 it('runs independent lanes concurrently and preserves input order', async () => {
  let running=0,peak=0
  const output=await orderedEmbeddingLanes([0,1,2,3,4],2,async (v,_index,lane)=>{running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,lane?1:5));running--;return v*2})
  expect(output).toEqual([0,2,4,6,8]);expect(peak).toBe(2);expect(running).toBe(0)
 })
 it('drains active lanes on failure and does not return partial vectors', async () => {
  let running=0
  await expect(orderedEmbeddingLanes([0,1,2,3],2,async v=>{running++;try{await new Promise(r=>setTimeout(r,2));if(v===0)throw Error('failed');return v}finally{running--}})).rejects.toThrow('failed')
  expect(running).toBe(0)
 })
})
