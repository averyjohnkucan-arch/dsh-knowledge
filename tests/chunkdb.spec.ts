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
  it('uses a narrow chunk lookup without SQLite statistics and preserves other documents', () => {
    const db = openSeeded()
    const raw = (db as unknown as { db: DatabaseSync }).db
    const prepare = vi.spyOn(raw, 'prepare')
    const doc = { id: 'd1', baseId: 'b1', title: 'updated', sourceType: 'text' as const, charCount: 7, chunkCount: 1, createdAt: 1, updatedAt: 2 }
    db.publishDocumentGeneration(doc, [{ id: 'replacement', docId: 'd1', baseId: 'b1', index: 0, text: 'updated' }], 1)
    const statement = prepare.mock.calls.map(([sql]) => sql).find(sql => sql.startsWith('DELETE FROM chunk ') && sql.includes('base_id = ?'))
    expect(statement).toBeDefined()
    prepare.mockRestore()
    const plan = raw.prepare('EXPLAIN QUERY PLAN ' + statement).all('c1', 'd1', 'b1') as Array<{ detail: string }>
    expect(plan.map(row => row.detail).join(' ')).toMatch(/chunk_doc_idx|sqlite_autoindex_chunk_1/)
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
   // External mirrors retain a parsed artifact instead of an internal source copy.
   db.putDocumentMetadata({id:'d3',baseId:'b',title:'external',sourceType:'file',sourcePath:'/source/scan.pdf',charCount:50,tokenCount:10,chunkCount:1,createdAt:1,processing:{revision:'r',artifactId:'b/d3/r',sourceHash:'s',provider:'builtin',optionsFingerprint:'f',parsedAt:1,completeness:'complete',warnings:[]}})
   let ticked=false
   const timer=setTimeout(()=>{ticked=true},0)
   const [stats,status]=await Promise.all([db.chunkStatsAsync(['b']),db.docChunkStatusAsync('b','m1')])
   clearTimeout(timer)
   expect(ticked).toBe(true)
   const {documents,...chunkStats}=stats as typeof stats & {documents?:unknown};expect(documents).toEqual({documentCount:3,storedDocCount:2,charCount:350,tokenCount:70});expect(chunkStats).toEqual(db.chunkStats(['b']))
   expect(status).toEqual(db.docChunkStatus('b','m1'))
   expect(await db.chunkStatsAsync([])).toEqual(db.chunkStats([]))
   db.putChunks([{id:'b',baseId:'b',docId:'d2',index:0,text:'two',embedding:[1,0],embeddingModel:'m1'}])
   expect(await db.docChunkStatusAsync('b','m1')).toEqual(db.docChunkStatus('b','m1'))
  }finally{db.close();await rm(root,{recursive:true,force:true})}
 })
})


it('file-backed vector search runs outside the event loop and preserves filters and updates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'knowledge-vector-worker-'));const db=new ChunkDatabase(join(dir,'chunks.sqlite'));
 try{
  db.putChunkBatch([{id:'one',docId:'d1',baseId:'b',index:0,text:'IBM evidence',embedding:[1,0],embeddingModel:'m'},{id:'two',docId:'d2',baseId:'b',index:0,text:'other evidence',embedding:[0,1],embeddingModel:'m'}]);
  let ticked=false;const tick=setTimeout(()=>{ticked=true},0);const result=await db.vector([1,0],['b'],1,{embeddingModel:'m'});clearTimeout(tick);
  expect(ticked).toBe(true);expect(result.total).toBe(2);expect(result.hits[0].id).toBe('one');
  expect((await db.vector([1,0],['b'],2,{excludeDocIds:['d1']})).hits.map(x=>x.id)).toEqual(['two']);
  db.putChunkBatch([{id:'one',docId:'d1',baseId:'b',index:0,text:'updated',embedding:[0,1],embeddingModel:'new'}]);
  expect((await db.vector([1,0],['b'],2,{embeddingModel:'m'})).hits.map(x=>x.id)).toEqual(['two']);
  await expect(db.vector([1,0],['b'],1,undefined,Date.now()-1)).rejects.toThrow(/deadline/);
  const writer=new DatabaseSync(join(dir,'chunks.sqlite'));writer.prepare("UPDATE chunk SET source_spans='[{}]' WHERE chunk_id='two'").run();writer.close();
  await expect(db.vector([1,0],['b'],1,{embeddingModel:'m'})).rejects.toThrow(/invalid persisted source spans/);
 }finally{db.close();await rm(dir,{recursive:true,force:true})}
},15000)

it('batches publications in one WAL transaction and isolates invalid documents with savepoints', async () => {
  const db=open(),raw=(db as unknown as {db:DatabaseSync}).db
  const exec=vi.spyOn(raw,'exec')
  try {
    const doc=(id:string)=>({id,baseId:'b',title:id,sourceType:'text' as const,charCount:10,chunkCount:1,createdAt:1,updatedAt:2})
    const chunks=(id:string)=>[{id:'c-'+id,docId:id,baseId:'b',index:0,text:'source '+id}]
    const errors=db.publishDocumentGenerations([
      {doc:doc('one'),chunks:chunks('one'),previousCreatedAt:1,atomicMetadata:true},
      {doc:doc('bad'),chunks:chunks('wrong-document'),previousCreatedAt:1,atomicMetadata:true},
      {doc:doc('two'),chunks:chunks('two'),previousCreatedAt:1,atomicMetadata:true},
    ])
    expect(errors[0]).toBeUndefined();expect(errors[1]).toBeInstanceOf(Error);expect(errors[2]).toBeUndefined()
    expect(exec.mock.calls.filter(([sql])=>sql==='BEGIN IMMEDIATE')).toHaveLength(1)
    expect(exec.mock.calls.filter(([sql])=>sql==='COMMIT')).toHaveLength(1)
    expect(db.getDocumentMetadata('bad')).toBeUndefined()
    expect((await db.lexical('source',['b'],10)).hits.map(hit=>hit.docId).sort()).toEqual(['one','two'])
  } finally {exec.mockRestore();db.close()}
})

it('preserves full-text rows when rechunking only replaces IDs and evidence', async () => {
  const db=openSeeded(),raw=(db as unknown as {db:DatabaseSync}).db
  try {
    const before=raw.prepare('SELECT fts_rowid FROM chunk WHERE chunk_id=?').get('c1')
    raw.exec("CREATE TRIGGER forbid_text_rebuild BEFORE DELETE ON chunk BEGIN SELECT RAISE(ABORT,'text index rebuild'); END")
    const chunks=db.listChunksByDoc('d1').map(chunk=>({...chunk,id:'regenerated-id',embedding:[1,0],embeddingModel:'new-model',processingRevision:'new-evidence'}))
    db.publishDocumentGeneration({id:'d1',baseId:'b1',title:'doc',sourceType:'text',charCount:24,chunkCount:1,createdAt:1,updatedAt:2,processing:{revision:'new-evidence',artifactId:'b1/d1/new-evidence',sourceHash:'source',provider:'builtin',optionsFingerprint:'same',parsedAt:2,completeness:'complete',warnings:[]}},chunks,1)
    expect(raw.prepare('SELECT fts_rowid FROM chunk WHERE chunk_id=?').get('regenerated-id')).toEqual(before)
    expect(db.getChunk('c1')).toBeUndefined()
    expect((await db.lexical('hello',['b1'],10)).hits[0].id).toBe('regenerated-id')
    expect(db.getChunk('regenerated-id')?.processingRevision).toBe('new-evidence')
  } finally {db.close()}
})

it('keeps unchanged neighbour rows and postings when one passage changes', async () => {
  const db = open(), raw = (db as unknown as {db: DatabaseSync}).db
  try {
    const chunks = [0,1,2].map(index => ({ id: `stable-${index}`, docId: 'doc', baseId: 'base', index, text: `Unchanged evidence passage ${index}`, context: 'title' }))
    db.putChunks(chunks)
    const before = raw.prepare("SELECT fts_rowid FROM chunk WHERE chunk_id='stable-0'").get()
    raw.exec("CREATE TRIGGER protect_neighbours BEFORE DELETE ON chunk WHEN OLD.chunk_id IN ('stable-0','stable-2') BEGIN SELECT RAISE(ABORT,'unchanged neighbour deleted'); END")
    const next = chunks.map(chunk => chunk.index === 1 ? { ...chunk, id: 'replacement', text: 'Revised middle passage' } : chunk)
    db.publishDocumentGeneration({ id: 'doc', baseId: 'base', title: 'title', sourceType: 'text', charCount: 90, chunkCount: 3, createdAt: 1, updatedAt: 2 }, next, 1, true)
    expect(raw.prepare("SELECT fts_rowid FROM chunk WHERE chunk_id='stable-0'").get()).toEqual(before)
    expect((await db.lexical('Revised', ['base'], 10)).hits.map(hit => hit.id)).toEqual(['replacement'])
    expect((await db.lexical('Unchanged', ['base'], 10)).hits.map(hit => hit.id).sort()).toEqual(['stable-0', 'stable-2'])
    expect(db.listChunkIdentitiesByDoc('doc').map(chunk => chunk.id)).toEqual(['stable-0', 'replacement', 'stable-2'])
  } finally { db.close() }
})

it('moves legacy inline text lazily, skips unchanged body writes and rolls back failed metadata changes', () => {
  const db = open(), raw = (db as unknown as {db: DatabaseSync}).db
  const doc = { id: 'legacy', baseId: 'base', title: 'Saved source', sourceType: 'text' as const, charCount: 12000, chunkCount: 0, createdAt: 1, updatedAt: 1 }
  const text = 'source paragraph '.repeat(1000)
  try {
    raw.prepare('INSERT INTO knowledge_document(doc_id,base_id,header,raw_text) VALUES (?,?,?,?)').run(doc.id,doc.baseId,JSON.stringify(doc),text)
    expect(db.getDocumentMetadata(doc.id)?.rawText).toBe(text)
    db.putDocumentMetadata({...doc,rawText:text,incomplete:true})
    expect(raw.prepare('SELECT raw_text FROM knowledge_document WHERE doc_id=?').get(doc.id)).toEqual({raw_text:null})
    expect(db.listDocumentMetadata('base')[0].rawText).toBe(text)
    expect(db.listDocumentMetadata('base',false)[0].rawText).toBeUndefined()
    expect(db.hasDocumentsWithoutSource('base')).toBe(false)
    raw.exec("CREATE TRIGGER forbid_source_rewrite BEFORE UPDATE ON knowledge_document_text BEGIN SELECT RAISE(ABORT,'source rewritten'); END")
    db.putDocumentMetadata({...doc,rawText:text,updatedAt:2})
    expect(db.getDocumentMetadata(doc.id)?.updatedAt).toBe(2)
    raw.exec('DROP TRIGGER forbid_source_rewrite')
    raw.exec("CREATE TRIGGER reject_header BEFORE UPDATE ON knowledge_document BEGIN SELECT RAISE(ABORT,'header failed'); END")
    expect(()=>db.putDocumentMetadata({...doc,rawText:'replacement text',updatedAt:3})).toThrow('header failed')
    expect(db.getDocumentMetadata(doc.id)?.rawText).toBe(text)
    expect(db.getDocumentMetadata(doc.id)?.updatedAt).toBe(2)
    raw.exec('DROP TRIGGER reject_header')
    db.putDocumentMetadata({...doc,updatedAt:4})
    expect(db.getDocumentMetadata(doc.id)?.rawText).toBeUndefined()
    expect(db.hasDocumentsWithoutSource('base')).toBe(true)
    db.putDocumentMetadata({...doc,rawText:text,updatedAt:5})
    db.deleteDocumentMetadata(doc.id)
    expect(raw.prepare('SELECT count(*) AS n FROM knowledge_document_text').get()).toEqual({n:0})
  } finally {db.close()}
})

it('inserts fresh passages in bounded SQL groups without losing text, IDs or rollback isolation', async () => {
  const db = open(), raw = (db as unknown as {db: DatabaseSync}).db
  const prepare = vi.spyOn(raw,'prepare')
  try {
    const chunks = Array.from({length:130},(_,index)=>({id:`bulk-${index}`,docId:'bulk',baseId:'base',index,text:`Unique searchable evidence ${index}`}))
    const doc = {id:'bulk',baseId:'base',title:'Bulk',sourceType:'text' as const,charCount:4000,chunkCount:130,createdAt:1,updatedAt:2}
    db.publishDocumentGeneration(doc,chunks,1,true)
    const inserts = prepare.mock.calls.map(([sql])=>sql).filter(sql=>sql.startsWith('INSERT INTO chunk\n'))
    expect(inserts).toHaveLength(3)
    expect(db.listChunksByDoc('bulk').map(chunk=>chunk.id)).toEqual(chunks.map(chunk=>chunk.id))
    raw.exec("INSERT INTO chunk_fts(chunk_fts,rank) VALUES('integrity-check',1)")
    raw.exec("CREATE TRIGGER reject_chunk BEFORE INSERT ON chunk WHEN NEW.chunk_id='bad-65' BEGIN SELECT RAISE(ABORT,'bad passage'); END")
    const bad = chunks.map((chunk,index)=>({...chunk,id:`bad-${index}`,docId:'bad'}))
    const errors = db.publishDocumentGenerations([
      {doc:{...doc,id:'bad'},chunks:bad,previousCreatedAt:1,atomicMetadata:true},
      {doc:{...doc,id:'good',chunkCount:1},chunks:[{...chunks[0],id:'good-row',docId:'good'}],previousCreatedAt:1,atomicMetadata:true},
    ])
    expect(errors[0]).toBeInstanceOf(Error);expect(errors[1]).toBeUndefined()
    expect(db.listChunksByDoc('bad')).toHaveLength(0)
    expect(db.getDocumentMetadata('bad')).toBeUndefined()
    expect(db.listChunksByDoc('good')).toHaveLength(1)
    raw.exec("INSERT INTO chunk_fts(chunk_fts,rank) VALUES('integrity-check',1)")
  } finally {prepare.mockRestore();db.close()}
})

it('does not rewrite trigram postings for vector-only checkpoints, but still indexes text edits', async () => {
  const db = open(), raw = (db as unknown as {db: DatabaseSync}).db
  try {
    const chunk = {id:'io',docId:'io-doc',baseId:'io-base',index:0,text:'unchanged astronomy evidence',embedding:[1,0],embeddingModel:'m'}
    db.putChunkBatch([chunk])
    const before=raw.prepare('SELECT * FROM chunk_fts_data ORDER BY id').all()
    db.putChunkBatch([{...chunk,embedding:[0,1]}])
    expect(raw.prepare('SELECT * FROM chunk_fts_data ORDER BY id').all()).toEqual(before)
    db.putChunkBatch([{...chunk,text:'replacement oceanography evidence'}])
    expect((await db.lexical('oceanography',['io-base'],10)).hits).toHaveLength(1)
    expect((await db.lexical('astronomy',['io-base'],10)).hits).toHaveLength(0)
    raw.exec("INSERT INTO chunk_fts(chunk_fts,rank) VALUES('integrity-check',1)")
  } finally {db.close()}
})

it('stores checkpoint vectors once, preserves legacy checkpoints, and skips unchanged checkpoint writes', () => {
  const db=open(),raw=(db as unknown as {db:DatabaseSync}).db
  try {
    const doc={id:'compact',baseId:'b',title:'Compact',sourceType:'text' as const,charCount:5,chunkCount:1,createdAt:1,updatedAt:2}
    const chunk={id:'c',docId:doc.id,baseId:'b',index:0,text:'hello',embedding:Array.from({length:1024},(_,i)=>Math.sin(i)),embeddingModel:'m'}
    db.stageDocumentGeneration(doc,[chunk])
    const row=raw.prepare('SELECT chunk_json, length(embedding) AS bytes FROM document_generation_chunk').get() as {chunk_json:string;bytes:number}
    expect(JSON.parse(row.chunk_json).embedding).toBeUndefined();expect(row.bytes).toBe(4096)
    expect(row.chunk_json.length).toBeLessThan(JSON.stringify(chunk).length/10)
    expect(db.getStagedDocumentGeneration(doc.id)?.chunks[0].embedding).toEqual(Array.from(new Float32Array(chunk.embedding)))
    const changes=raw.prepare('SELECT total_changes() AS n').get()
    db.stageDocumentGeneration(doc,[chunk])
    expect(raw.prepare('SELECT total_changes() AS n').get()).toEqual(changes)
    raw.prepare('UPDATE document_generation_chunk SET chunk_json=?').run(JSON.stringify(chunk))
    expect(db.getStagedDocumentGeneration(doc.id)?.chunks[0].embedding).toEqual(chunk.embedding)
  } finally {db.close()}
})

it('groups durable checkpoints in one transaction with per-document rollback', () => {
  const db=open(),raw=(db as unknown as {db:DatabaseSync}).db,exec=vi.spyOn(raw,'exec')
  try {
    const doc={id:'ok',baseId:'b',title:'Checkpoint',sourceType:'text' as const,charCount:5,chunkCount:1,createdAt:1,updatedAt:2}
    const chunk={id:'c',docId:'ok',baseId:'b',index:0,text:'hello'}
    const errors=db.stageDocumentGenerations([{doc,chunks:[chunk]},{doc:{...doc,id:'bad'},chunks:[chunk]}])
    expect(errors[0]).toBeUndefined();expect(errors[1]).toBeInstanceOf(Error)
    expect(exec.mock.calls.filter(([sql])=>sql==='BEGIN IMMEDIATE')).toHaveLength(1)
    expect(db.getStagedDocumentGeneration('ok')?.chunks).toEqual([chunk])
    expect(db.getStagedDocumentGeneration('bad')).toBeUndefined()
  } finally {exec.mockRestore();db.close()}
})
