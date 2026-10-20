export interface EmbeddingCpuTuning { threads: number; instances: number; microBatch: number }
export function resolveEmbeddingCpuTuning(input: Partial<EmbeddingCpuTuning>, cores: number, freeBytes: number): EmbeddingCpuTuning {
  const positive = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
  const available = Math.max(1, Math.floor(cores))
  const memoryInstances = Math.max(1, Math.min(4, Math.floor(freeBytes / (2 * 1024 ** 3))))
  const instances = Math.min(positive(input.instances, available >= 16 ? 2 : 1, 4), memoryInstances, available)
  return { instances, threads: Math.min(positive(input.threads, 8, 64), Math.max(1, Math.floor(available / instances))), microBatch: positive(input.microBatch, 1, 8) }
}
/** Each lane owns a separate model instance; preserve caller order and drain failures. */
export async function orderedEmbeddingLanes<T, R>(items: readonly T[], lanes: number, run: (item: T, index: number, lane: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0, failure: unknown, failed = false
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, async (_, lane) => {
    while (!failed && next < items.length) {
      const index = next++
      try { results[index] = await run(items[index], index, lane) } catch (error) { failed = true; failure = error }
    }
  }))
  if (failed) throw failure
  return results
}
