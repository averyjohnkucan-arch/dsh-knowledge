/** Import-wide barriers. A task owns capacity only while executing its current
 * stage; queued documents never retain a parser/OCR worker while waiting for
 * the rest of the import. Stage results must be checkpointed by the caller. */
export const IMPORT_STAGES = ['ocr', 'parsing', 'chunking', 'vectorization'] as const
export type ImportStage = typeof IMPORT_STAGES[number]
export interface ImportStageProgress {
  stage: ImportStage
  total: number
  completed: number
  running: number
  failed: number
}
export interface ImportStageItem { id: string }
export interface ImportStageFailure { id: string; stage: ImportStage; error: unknown }
export interface ImportStageOptions<T extends ImportStageItem> {
  items: readonly T[]
  signal: AbortSignal
  /** Device managers retain their own foreground/VRAM admission. */
  concurrency(stage: ImportStage): number
  enterStage?(stage: ImportStage): Promise<void>
  failure?(failure: ImportStageFailure): void
  execute(stage: ImportStage, item: T, signal: AbortSignal): Promise<void>
  progress?(progress: ImportStageProgress): void
}
export async function runImportStages<T extends ImportStageItem>(options: ImportStageOptions<T>): Promise<{
  completed: string[]; failures: ImportStageFailure[]
}> {
  if (new Set(options.items.map(item => item.id)).size !== options.items.length) throw new Error('Duplicate staged import identity')
  let remaining = [...options.items]
  const failures: ImportStageFailure[] = []
  for (const stage of IMPORT_STAGES) {
    options.signal.throwIfAborted()
    await options.enterStage?.(stage)
    options.signal.throwIfAborted()
    const capacity = options.concurrency(stage)
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid import stage concurrency')
    let next = 0, completed = 0, running = 0, failed = 0
    const passed = new Set<string>()
    const report = () => options.progress?.({ stage, total: remaining.length, completed, running, failed })
    report()
    const consume = async () => {
      while (next < remaining.length && !options.signal.aborted) {
        const item = remaining[next++]
        running++; report()
        try {
          await options.execute(stage, item, options.signal)
          options.signal.throwIfAborted()
          passed.add(item.id); completed++
        } catch (error) {
          if (options.signal.aborted) throw error
          failed++; const failure={id:item.id, stage, error}; failures.push(failure); options.failure?.(failure)
        } finally { running--; report() }
      }
    }
    // Await every in-flight task even on cancellation: no next stage or caller
    // cleanup can race a worker still writing its checkpoint.
    const settled = await Promise.allSettled(Array.from({length:Math.min(capacity, remaining.length)}, consume))
    options.signal.throwIfAborted()
    const rejected = settled.find(result => result.status === 'rejected')
    if (rejected?.status === 'rejected') throw rejected.reason
    remaining = remaining.filter(item => passed.has(item.id))
  }
  return {completed:remaining.map(item => item.id), failures}
}

/** Scheduler occupancy, not a hardware-utilization percentage. */
export interface PipelineDeviceState {
  device:string
  activeTasks:number
  state:'running'|'ready'|'waiting'|'unavailable'
  reason:string
}
