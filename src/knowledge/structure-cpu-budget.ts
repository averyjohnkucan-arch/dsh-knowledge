/** Reserve CPU capacity for structure inference before dispatching more embeddings.
 * Running batches finish normally; idle CPU lanes remain warm for later stages. */
let structureWorkers = 0
export function enterStructureCpuWork(): () => void {
  structureWorkers++
  let released = false
  return () => { if (!released) { released = true; structureWorkers-- } }
}
export function embeddingCpuLaneLimit(cores: number, threads: number): number {
  return Math.max(1, Math.floor((cores - structureWorkers * 8) / Math.max(1, threads)))
}
