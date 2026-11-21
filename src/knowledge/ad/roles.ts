import { z } from 'zod'

export const actions = ['read','settings','sync','models','policy'] as const
export type AdAction = typeof actions[number]
const group = z.string().trim().min(1).max(128).refine(value => !/[\x00-\x1f\x7f]/.test(value))
export const groups = z.array(group).max(32)
export const roleGroups = z.object({ read: groups.min(1), settings: groups, sync: groups, models: groups }).strict()
export const safeSettings = z.object({
  topK: z.number().int().min(1).max(25), searchMode: z.enum(['auto','hybrid','vector','lexical']),
  similarityThreshold: z.number().min(0).max(1), siblingChunks: z.number().int().min(0).max(10),
  chunkSize: z.number().int().min(100).max(8000), chunkOverlap: z.number().int().min(0).max(2000),
  keepInternalMarkdown: z.boolean(), ocrEnabled: z.boolean(),
}).strict()
export function projectSettings(config: object) {
  return Object.fromEntries(Object.keys(safeSettings.shape).map(key => [key, Reflect.get(config,key)]))
}
