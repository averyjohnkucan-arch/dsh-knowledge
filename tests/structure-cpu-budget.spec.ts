import { expect, it } from 'vitest'
import { enterStructureCpuWork, embeddingCpuLaneLimit } from '../src/knowledge/structure-cpu-budget.js'
it('reserves structure threads and restores embedding capacity as stages finish',()=>{
 expect(embeddingCpuLaneLimit(24,8)).toBe(3)
 const first=enterStructureCpuWork(),second=enterStructureCpuWork()
 try {
  expect(embeddingCpuLaneLimit(24,8)).toBe(1)
  first();first();expect(embeddingCpuLaneLimit(24,8)).toBe(2)
  expect(embeddingCpuLaneLimit(4,8)).toBe(1)
 } finally {first();second()}
 expect(embeddingCpuLaneLimit(24,8)).toBe(3)
})
