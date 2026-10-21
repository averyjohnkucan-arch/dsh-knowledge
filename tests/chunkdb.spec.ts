import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ChunkDatabase } from '../src/knowledge/chunkdb.js'

const open = (): ChunkDatabase => new ChunkDatabase(':memory:')

const openSeeded = (): ChunkDatabase => {
  const db = open()
  db.putChunks([
    { id: 'c1', docId: 'd1', baseId: 'b1', index: 0, text: 'hello world 中文测试', context: 'doc' },
    { id: 'c2', docId: 'd2', baseId: 'b1', index: 0, text: 'another chunk of text', context: 'doc2' },
    { id: 'c3', docId: 'd3', baseId: 'b2', index: 0, text: '中文内容 深度学习', context: '深度学习笔记' },
  ])
  return db
}

afterEach(() => {})

describe('ChunkDatabase lexical lane', () => {
  it('matches CJK trigrams and latin words through FTS5', async () => {
    const db = openSeeded()
    const hits = await db.lexical('中文测试', ['b1'], 20)
    expect(hits.hits.map(hit => hit.id)).toContain('c1')
    const latin = await db.lexical('hello', ['b1'], 20)
    expect(latin.hits.map(hit => hit.id)).toContain('c1')
    db.close()
  })

  it('does not crash on symbol-only queries (FTS5 would reject MATCH "")', async () => {
    const db = openSeeded()
    for (const query of ['!!!', '###', '中文!!!测试', '（（（']) {
      const result = await db.lexical(query, ['b1'], 20)
      expect(Array.isArray(result.hits)).toBe(true)
    }
    db.close()
  })

  it('routes 1–2 char terms through the LIKE fallback instead of FTS', async () => {
    const db = openSeeded()
    const hits = await db.lexical('中', ['b1', 'b2'], 20)
    expect(hits.hits.length).toBeGreaterThan(0)
    expect(hits.hits.every(hit => hit.score > 0 && hit.score < 1)).toBe(true)
    db.close()
  })

  it('normalizes two-character CJK LIKE scores and breaks equal-length ties by chunk id', async () => {
    const db = open()
    db.putChunks([
      { id: 'c-b', docId: 'd-b', baseId: 'b1', index: 0, text: '年假乙' },
      { id: 'c-a', docId: 'd-a', baseId: 'b1', index: 0, text: '年假甲' },
    ])

    const result = await db.lexical('年假', ['b1'], 20)
    expect(result.hits.map(hit => hit.id)).toEqual(['c-a', 'c-b'])
    expect(result.hits[0]?.score).toBeCloseTo(1024 / (1024 + 3), 12)
    db.close()
  })

  it('treats an empty document allow-list as match-nothing', async () => {
    const db = openSeeded()
    await expect(db.lexical('hello', ['b1'], 20, { docIds: [] })).resolves.toEqual({ total: 0, hits: [] })
    db.close()
  })

  it('excludes documents before FTS, LIKE, and relaxed-query limits', async () => {
    const db = open()
    try {
      db.putChunks([
        { id: 'blocked', docId: 'catalog', baseId: 'b1', index: 0, text: 'alpha zz 年假' },
        { id: 'kept', docId: 'body', baseId: 'b1', index: 0, text: 'alpha 年假 body evidence with extra context' },
        { id: 'foreign', docId: 'foreign', baseId: 'b2', index: 0, text: 'alpha zz 年假' },
      ])
      for (const query of ['alpha', '年假', 'alpha zz']) {
        const result = await db.lexical(query, ['b1'], 1, {
          docIds: ['catalog', 'body', 'foreign'],
          excludeDocIds: ['catalog'],
        })
        expect(result.total, query).toBe(1)
        expect(result.hits.map(hit => hit.docId), query).toEqual(['body'])
      }
      await expect(db.lexical('alpha', ['b1'], 1, { excludeDocIds: ['catalog', 'body'] }))
        .resolves.toEqual({ total: 0, hits: [] })
      const unrestricted = await db.lexical('alpha', ['b1'], 1)
      expect(await db.lexical('alpha', ['b1'], 1, { excludeDocIds: [] })).toEqual(unrestricted)
    } finally {
      db.close()
    }
  })

  it('uses large literal ID sets without exhausting SQL bind parameters', async () => {
    const db = open()
    try {
      const blockedIds = Array.from({ length: 600 }, (_, index) => `catalog-${index}`)
      const keptId = `body'\"%_[literal]`
      db.putChunks([
        ...blockedIds.map((docId, index) => ({
          id: `c${index}`, docId, baseId: 'b1', index: 0, text: 'needle',
        })),
        { id: 'kept', docId: keptId, baseId: 'b1', index: 0, text: 'needle body evidence' },
      ])
      const result = await db.lexical('needle', ['b1'], 1, {
        docIds: [...blockedIds, keptId],
        excludeDocIds: blockedIds,
      })
      expect(result.total).toBe(1)
      expect(result.hits.map(hit => hit.docId)).toEqual([keptId])
    } finally {
      db.close()
    }
  })

  it('interrupts a synchronous SQLite lexical scan at its absolute deadline', async () => {
    const db = open()
    db.putChunks([{ id: 'deadline', docId: 'deadline-doc', baseId: 'b1', index: 0, text: 'alpha deadline evidence' }])
    const now = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(1_000)
    try {
      await expect(db.lexical('alpha', ['b1'], 20, undefined, 500)).rejects.toMatchObject({ name: 'TimeoutError' })
    } finally {
      now.mockRestore()
      db.close()
    }
  })

  it('respects the base scope', async () => {
    const db = openSeeded()
    const b1 = await db.lexical('中文', ['b1'], 20)
    const b2 = await db.lexical('中文', ['b2'], 20)
    expect(b1.hits.some(hit => hit.baseId === 'b2')).toBe(false)
    expect(b2.hits.some(hit => hit.baseId === 'b1')).toBe(false)
    db.close()
  })
})

describe('ChunkDatabase vector lane', () => {
  it('returns cosine-ranked hits only for chunks with vectors', async () => {
    const db = openSeeded()
    const result = await db.vector([1, 0, 0], ['b1'], 20)
    expect(result.total).toBe(0) // no embeddings stored
    db.putChunkBatch([
      { id: 'v1', docId: 'd1', baseId: 'b1', index: 0, text: 'a', embedding: [1, 0, 0], embeddingModel: 'm' },
      { id: 'v2', docId: 'd1', baseId: 'b1', index: 1, text: 'b', embedding: [0, 1, 0], embeddingModel: 'm' },
    ])
    const ranked = await db.vector([1, 0, 0], ['b1'], 20)
    expect(ranked.hits[0].id).toBe('v1')
    expect(ranked.hits[0].score).toBeGreaterThan(ranked.hits[1].score)
    db.close()
  })

  it('treats an empty document allow-list as match-nothing', async () => {
    const db = open()
    db.putChunkBatch([
      { id: 'v1', docId: 'd1', baseId: 'b1', index: 0, text: 'a', embedding: [1, 0], embeddingModel: 'm' },
    ])
    await expect(db.vector([1, 0], ['b1'], 20, { docIds: [] })).resolves.toEqual({ total: 0, hits: [] })
    db.close()
  })

  it('excludes higher-scoring documents before counting and limiting vectors', async () => {
    const db = open()
    try {
      db.putChunks([
        { id: 'blocked', docId: 'catalog', baseId: 'b1', index: 0, text: 'catalog', embedding: [1, 0] },
        { id: 'kept', docId: 'body', baseId: 'b1', index: 0, text: 'body', embedding: [0.9, 0.1] },
        { id: 'foreign', docId: 'foreign', baseId: 'b2', index: 0, text: 'foreign', embedding: [1, 0] },
      ])
      const result = await db.vector([1, 0], ['b1'], 1, {
        docIds: ['catalog', 'body', 'foreign'], excludeDocIds: ['catalog'],
      })
      expect(result.total).toBe(1)
      expect(result.hits.map(hit => hit.docId)).toEqual(['body'])
      await expect(db.vector([1, 0], ['b1'], 1, { excludeDocIds: ['catalog', 'body'] }))
        .resolves.toEqual({ total: 0, hits: [] })
    } finally {
      db.close()
    }
  })

  it('checks deadlines while skipping excluded vectors', async () => {
    const db = open()
    db.putChunks(Array.from({ length: 300 }, (_, index) => ({
      id: `c${index}`, docId: index === 0 ? 'body' : 'catalog', baseId: 'b1', index,
      text: 'needle', embedding: [1, 0],
    })))
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(1_000)
    try {
      await expect(db.vector([1, 0], ['b1'], 1, { excludeDocIds: ['catalog'] }, 500))
        .rejects.toMatchObject({ name: 'TimeoutError' })
    } finally {
      now.mockRestore()
      db.close()
    }
  })
})

describe('ChunkDatabase FTS migration recovery', () => {
  it('rebuilds the trigram index when a previous migration was interrupted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kb-fts-'))
    const path = join(dir, 'chunks.sqlite')
    let db: ChunkDatabase | undefined
    let reopened: ChunkDatabase | undefined
    try {
      db = new ChunkDatabase(path)
      db.putChunks([{ id: 'c1', docId: 'd1', baseId: 'b1', index: 0, text: 'half applied rebuild' }])
      expect((await db.lexical('half applied', ['b1'], 20)).hits.map(hit => hit.id)).toContain('c1')
      db.close()
      db = undefined

      // Reproduce an interrupted upgrade exactly: the FTS table exists with the
      // shape the old textual guard accepted and holds no rows, and no migration
      // marker was written. That is the state whose rebuild the old code skipped
      // forever, leaving the whole lexical lane silently empty.
      const raw = new DatabaseSync(path)
      raw.exec('DROP TRIGGER IF EXISTS chunk_ai')
      raw.exec('DROP TRIGGER IF EXISTS chunk_ad')
      raw.exec('DROP TRIGGER IF EXISTS chunk_au')
      raw.exec('DROP TABLE IF EXISTS chunk_fts')
      raw.exec(`CREATE VIRTUAL TABLE chunk_fts USING fts5(
        search_text, content='chunk', content_rowid='fts_rowid', tokenize='trigram'
      )`)
      raw.exec(`DELETE FROM chunk_meta WHERE key = 'fts_rowid_migrated'`)
      raw.close()

      // Reopening must notice the migration never completed and rebuild.
      reopened = new ChunkDatabase(path)
      const hits = await reopened.lexical('half applied', ['b1'], 20)
      expect(hits.hits.map(hit => hit.id)).toContain('c1')
    } finally {
      try { db?.close() } catch { /* already closed */ }
      try { reopened?.close() } catch { /* already closed */ }
      await rm(dir, { recursive: true, force: true })
    }
  })
})


describe('bulk KB generation removal', () => {
  it('purges only the selected KB and preserves another KB candidate', () => {
    const db = open()
    for (const baseId of ['deleted', 'retained']) {
      const doc = { id: baseId + '-doc', baseId, title: 'test', sourceType: 'text' as const, charCount: 5, chunkCount: 1, createdAt: 1, updatedAt: 2 }
      db.stageDocumentGeneration(doc, [{ id: baseId + '-chunk', docId: doc.id, baseId, index: 0, text: 'hello' }])
    }
    db.discardBaseGenerations('deleted')
    expect(db.stagedDocumentHeaders().map(x => x.id)).toEqual(['retained-doc'])
    db.discardBaseGenerations('deleted')
    db.close()
  })
})

describe('document-scoped publication query plan', () => {
  it('uses the document index even without SQLite statistics and preserves other documents', () => {
    const db = openSeeded()
    const raw = (db as unknown as { db: DatabaseSync }).db
    const prepare = vi.spyOn(raw, 'prepare')
    const doc = { id: 'd1', baseId: 'b1', title: 'updated', sourceType: 'text' as const, charCount: 7, chunkCount: 1, createdAt: 1, updatedAt: 2 }
    db.publishDocumentGeneration(doc, [{ id: 'replacement', docId: 'd1', baseId: 'b1', index: 0, text: 'updated' }], 1)
    const statement = prepare.mock.calls.map(([sql]) => sql).find(sql => sql.startsWith('DELETE FROM chunk ') && sql.includes('base_id = ?'))
    expect(statement).toBeDefined()
    prepare.mockRestore()
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + statement).all('d1', 'b1') as Array<{ detail: string }>
    expect(plan.map(row => row.detail).join(' ')).toContain('chunk_doc_idx')
    expect(db.listChunksByDoc('d2').map(chunk => chunk.id)).toEqual(['c2'])
    db.close()
  })
})

describe('embedding hash migration completion', () => {
  it('backfills legacy vectors once and retains the completion marker across reopen', async () => {
    const dir=await mkdtemp(join(tmpdir(),'kb-hash-migration-')),path=join(dir,'chunks.sqlite')
    try {
      let db=new ChunkDatabase(path)
      db.putChunks([{id:'legacy',docId:'d',baseId:'b',index:0,text:'legacy text',embedding:[1,0],embeddingModel:'test'}]);db.close()
      const raw=new DatabaseSync(path)
      raw.exec("DELETE FROM chunk_meta WHERE key='embedding_hash_backfill_v1'; UPDATE chunk SET embedding_text_hash=NULL")
      raw.close()
      db=new ChunkDatabase(path);db.close()
      const verify=new DatabaseSync(path)
      expect(verify.prepare("SELECT value FROM chunk_meta WHERE key='embedding_hash_backfill_v1'").get()).toEqual({value:'1'})
      expect((verify.prepare('SELECT embedding_text_hash FROM chunk WHERE chunk_id=?').get('legacy') as {embedding_text_hash:string}).embedding_text_hash).toBeTruthy()
      verify.close()
      db=new ChunkDatabase(path);db.close()
    } finally {await rm(dir,{recursive:true,force:true})}
  })
})

describe('large-library status indexes', () => {
  it('keeps passage text out of status scans and scopes embedding statistics', () => {
    const db=openSeeded()
    db.putChunks([{id:'c1',docId:'d1',baseId:'b1',index:0,text:'hello',embedding:[1,0],embeddingModel:'test'}])
    const status=db.docChunkStatus('b1')
    expect([...status.withChunks].sort()).toEqual(['d1','d2'])
    expect([...status.missingEmbedding]).toEqual(['d2'])
    expect(db.chunkStats(['b1'])).toMatchObject({count:2,embedded:true,embeddedCount:1,dimensions:2,embeddingModelCounts:[{baseId:'b1',model:'test',count:1}]})
    const raw=(db as unknown as {db:DatabaseSync}).db
    const plan=raw.prepare('EXPLAIN QUERY PLAN SELECT doc_id, SUM(embedding IS NULL) AS missing FROM chunk WHERE base_id=? GROUP BY doc_id').all('b1') as Array<{detail:string}>
    expect(plan.map(r=>r.detail).join(' ')).toContain('chunk_status_idx')
    const embedded=raw.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM chunk WHERE base_id=? AND embedding IS NOT NULL LIMIT 1').all('b1') as Array<{detail:string}>
    expect(embedded.map(r=>r.detail).join(' ')).toContain('chunk_embedded_idx')
    db.close()
  })
})


describe('embedding format isolation', () => {
  it('ignores stale vector formats while keeping their lexical evidence available', async () => {
    const db = open()
    db.putChunks([
      { id: 'old', docId: 'd-old', baseId: 'b', index: 0, text: 'astronomy old', embedding: [1, 0], embeddingModel: 'local:qwen' },
      { id: 'new', docId: 'd-new', baseId: 'b', index: 0, text: 'astronomy new', embedding: [0.9, 0.1], embeddingModel: 'local:qwen:canonical-single-v1' },
      { id: 'untagged', docId: 'd-untagged', baseId: 'b', index: 0, text: 'astronomy untagged', embedding: [1, 0] },
    ])
    const filter = { embeddingModel: 'local:qwen:canonical-single-v1' }
    const vector = await db.vector([1, 0], ['b'], 10, filter)
    expect(vector.total).toBe(1)
    expect(vector.hits.map(hit => hit.id)).toEqual(['new'])
    expect((await db.lexical('astronomy', ['b'], 10, filter)).hits).toHaveLength(3)
    expect([...db.docChunkStatus('b', filter.embeddingModel).missingEmbedding].sort()).toEqual(['d-old', 'd-untagged'])
    expect(db.docChunkStatus('b').missingEmbedding.size).toBe(0)
    db.close()
  })
})

describe('streaming-safe UI reads and vector publication',()=>{
 it('updates only vector columns when the complete canonical text generation is unchanged',async()=>{
  const db=openSeeded(),raw=(db as unknown as {db:DatabaseSync}).db
  const before=raw.prepare('SELECT fts_rowid FROM chunk WHERE chunk_id=?').get('c1')
  const chunks=db.listChunksByDoc('d1').map(chunk=>({...chunk,embedding:[1,0],embeddingModel:'new-vector-space'}))
  db.publishDocumentGeneration({id:'d1',baseId:'b1',title:'doc',sourceType:'text',charCount:24,chunkCount:1,createdAt:1,updatedAt:2},chunks,1)
  expect(raw.prepare('SELECT fts_rowid FROM chunk WHERE chunk_id=?').get('c1')).toEqual(before)
  expect(db.listChunksByDoc('d1')[0].embedding).toEqual([1,0])
  expect((await db.lexical('hello',['b1'],10)).hits.map(hit=>hit.id)).toContain('c1')
  expect(db.pendingDocumentGenerations()[0].document.updatedAt).toBe(2)
  // A context edit is a text-index change even if the body and IDs match.
  db.publishDocumentGeneration({id:'d1',baseId:'b1',title:'doc',sourceType:'text',charCount:24,chunkCount:1,createdAt:1,updatedAt:3},chunks.map(chunk=>({...chunk,context:'astronomy telescope'})),1)
  expect((await db.lexical('telescope',['b1'],10)).hits.map(hit=>hit.id)).toContain('c1')
  db.close()
 })
 it('returns exact summaries from a read-only worker while the host remains responsive',async()=>{
  const root=await mkdtemp(join(tmpdir(),'knowledge-ui-reader-')),db=new ChunkDatabase(join(root,'chunks.sqlite'))
  try {
   db.putChunks([{id:'a',baseId:'b',docId:'d1',index:0,text:'one',embedding:[1,0],embeddingModel:'m1'},
    {id:'b',baseId:'b',docId:'d2',index:0,text:'two'},
    {id:'c',baseId:'b',docId:'d3',index:0,text:'three',embedding:[0,1],embeddingModel:'m2'}])
   db.putDocumentMetadata({id:'d1',baseId:'b',title:'one',sourceType:'text',charCount:100,tokenCount:20,chunkCount:1,createdAt:1})
   db.putDocumentMetadata({id:'d2',baseId:'b',title:'two',sourceType:'file',charCount:200,tokenCount:40,chunkCount:1,createdAt:1,rawFilePath:'b/d2.txt'})
   let ticked=false
   const timer=setTimeout(()=>{ticked=true},0)
   const [stats,status]=await Promise.all([db.chunkStatsAsync(['b']),db.docChunkStatusAsync('b','m1')])
   clearTimeout(timer)
   expect(ticked).toBe(true)
   const {documents,...chunkStats}=stats as typeof stats & {documents?:unknown};expect(documents).toEqual({documentCount:2,storedDocCount:1,charCount:300,tokenCount:60});expect(chunkStats).toEqual(db.chunkStats(['b']))
   expect(status).toEqual(db.docChunkStatus('b','m1'))
   expect(await db.chunkStatsAsync([])).toEqual(db.chunkStats([]))
   db.putChunks([{id:'b',baseId:'b',docId:'d2',index:0,text:'two',embedding:[1,0],embeddingModel:'m1'}])
   expect(await db.docChunkStatusAsync('b','m1')).toEqual(db.docChunkStatus('b','m1'))
  }finally{db.close();await rm(root,{recursive:true,force:true})}
 })
})
