import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ChunkDatabase } from '../src/knowledge/chunkdb.js'
import type { KnowledgeDocument, KnowledgeChunk } from '../src/knowledge/types.js'
const doc: KnowledgeDocument = { id: 'doc', baseId: 'base', title: 'old', sourceType: 'text', rawText: 'old text', charCount: 8, chunkCount: 1, createdAt: 1 }
const chunk: KnowledgeChunk = { id: 'chunk', docId: 'doc', baseId: 'base', index: 0, text: 'old text' }
const dirs: string[] = []
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }) })
describe('incremental document metadata', () => {
  it('migrates once, survives reopen, omits raw text in summaries and never resurrects a legacy deletion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-metadata-')); dirs.push(dir)
    const path = join(dir, 'store.sqlite')
    let db = new ChunkDatabase(path)
    expect(db.migrateDocumentMetadata([[doc.id, doc]])).toBe(1)
    expect(db.listDocumentMetadata('base', false)[0].rawText).toBeUndefined()
    expect(db.getDocumentMetadata(doc.id)).toEqual(doc)
    db.close(); db = new ChunkDatabase(path)
    expect(db.getDocumentMetadata(doc.id)).toEqual(doc)
    db.deleteDocumentMetadata(doc.id)
    expect(db.migrateDocumentMetadata([[doc.id, doc]])).toBe(0)
    expect(db.getDocumentMetadata(doc.id)).toBeUndefined()
    db.close()
  })
  it('rolls back a failed migration and permits a complete retry', () => {
    const db = new ChunkDatabase(':memory:')
    const invalid = { ...doc, id: 'bad', charCount: -1 }
    expect(() => db.migrateDocumentMetadata([[doc.id, doc], ['bad', invalid]])).toThrow()
    expect(db.getDocumentMetadata(doc.id)).toBeUndefined()
    expect(db.migrateDocumentMetadata([[doc.id, doc]])).toBe(1)
    db.close()
  })
  it('publishes metadata and chunks together, preserving both on a real SQLite write failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-metadata-')); dirs.push(dir)
    const path = join(dir, 'store.sqlite'), db = new ChunkDatabase(path)
    db.migrateDocumentMetadata([[doc.id, doc]]); db.putChunks([chunk])
    const fault = new DatabaseSync(path)
    fault.exec("CREATE TRIGGER reject_bad_metadata BEFORE UPDATE ON knowledge_document WHEN json_extract(NEW.header, '$.title')='new' BEGIN SELECT RAISE(ABORT, 'simulated metadata disk failure'); END;")
    const next = { ...doc, title: 'new', rawText: 'new text' }, nextChunk = { ...chunk, id: 'new', text: 'new text' }
    expect(() => db.publishDocumentGeneration(next, [nextChunk], doc.createdAt, true)).toThrow('simulated metadata disk failure')
    expect(db.getDocumentMetadata(doc.id)).toEqual(doc)
    expect(db.listChunksByDoc(doc.id)).toEqual([chunk])
    fault.exec('DROP TRIGGER reject_bad_metadata'); fault.close()
    db.publishDocumentGeneration(next, [nextChunk], doc.createdAt, true)
    expect(db.getDocumentMetadata(doc.id)).toEqual(next)
    expect(db.listChunksByDoc(doc.id)).toEqual([nextChunk])
    expect(db.pendingDocumentGenerations()).toEqual([])
    db.close()
  })
})
