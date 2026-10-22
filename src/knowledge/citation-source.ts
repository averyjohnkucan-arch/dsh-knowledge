import { createHash } from 'node:crypto'
import type { KnowledgeChunk } from './types.js'
export const passageHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
export function passageUrl(documentId: string, chunk: KnowledgeChunk, revision?: string): string {
  const root = `/knowledge/documents/${encodeURIComponent(documentId)}`
  return revision
    ? `${root}/markdown/${encodeURIComponent(revision)}?chunk=${encodeURIComponent(chunk.id)}&view=1#citation`
    : `${root}/passage/${encodeURIComponent(chunk.id)}?hash=${passageHash(chunk.text)}&view=1#citation`
}
