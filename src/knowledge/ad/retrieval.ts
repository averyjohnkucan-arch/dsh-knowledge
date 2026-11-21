import { createHash } from 'node:crypto'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { KnowledgeService } from '../index.js'
import type { KnowledgeBase, KnowledgeDocument, SearchHit, SearchMode } from '../types.js'
import { component, fileDigest, readerPath, unavailable, type Mapping } from './config.js'
import type { Access, Probe } from './session.js'

export type SourceRow = Pick<KnowledgeDocument, 'id' | 'baseId' | 'sourceType' | 'sourcePath' | 'processing' | 'incomplete' | 'markdownRevision'>
export type ReaderStore = Pick<KnowledgeService, 'getConfigFor' | 'adSourceBases' | 'adSourceRows' | 'adCurrentSource' | 'adSearch' | 'getDocument' | 'getRawFile' | 'getMarkdownSnapshot' | 'listChunks'>
type Entry = { id: string; baseId: string; name: string; probe: Probe; sourcePath: string; revision?: string; markdown?: string }
export type ReaderQuery = { query: string; topK?: number; mode?: SearchMode; baseId?: string }
export type ReaderHit = { documentId: string; title: string; text: string; score: number; citation: string }
const matches = (entry: Entry, current?: SourceRow) => !current?.incomplete && current?.sourceType === 'file'
  && current.baseId === entry.baseId && current.sourcePath === entry.sourcePath && current.processing?.sourceHash === entry.probe.digest
  && current.processing?.revision === entry.revision && current.markdownRevision === entry.markdown

export class AdLibrary {
  constructor(private store: ReaderStore, private mappings: readonly Mapping[]) {}
  private bases() {
    const byId = new Map(this.store.adSourceBases().map(b => [b.id,b]))
    return this.mappings.flatMap(mapping => {
      const base = byId.get(mapping.baseId)
      return base?.storageMode === 'external' && base.externalPath === mapping.localRoot ? [{ base, mapping }] : []
    })
  }
  private entries(base: KnowledgeBase, mapping: Mapping): Entry[] {
    return this.store.adSourceRows(base.id).flatMap(doc => {
      if (doc.baseId !== base.id || !doc.sourcePath || !isAbsolute(doc.sourcePath) || resolve(doc.sourcePath) !== doc.sourcePath || doc.incomplete) return []
      const rel = relative(mapping.localRoot, doc.sourcePath)
      const parts = rel ? rel.split(sep) : []
      if (isAbsolute(rel) || parts.some(part => !component(part))) return []
      const directory = doc.sourceType === 'directory'
      const digest = doc.processing?.sourceHash
      if (!directory && (doc.sourceType !== 'file' || !parts.length || !digest || !fileDigest.test(digest))) return []
      return [{ id: doc.id, baseId: base.id, name: basename(doc.sourcePath), sourcePath: doc.sourcePath,
        revision: doc.processing?.revision, markdown: doc.markdownRevision,
        probe: { server: mapping.server, share: mapping.share, parts: [...mapping.subfolder,...parts], directory, ...(directory ? {} : {digest}) } }]
    })
  }
  private current(entry: Entry) {
    const { row, base } = this.store.adCurrentSource(entry.id)
    const mapping = this.mappings.find(m => m.baseId === entry.baseId)
    return base?.storageMode === 'external' && base.externalPath === mapping?.localRoot && matches(entry, row)
  }
  async browse(access: Access, baseId?: string, folderId?: string) {
    const bases = this.bases()
    if (!baseId) {
      const allowed = await access.check(bases.map(({mapping}) => ({ ...mapping, parts: mapping.subfolder, directory: true })))
      return bases.flatMap(({base}, i) => allowed[i] ? [{ id: base.id, name: base.name, kind: 'base' }] : [])
    }
    const selected = bases.find(({base}) => base.id === baseId)
    if (!selected) throw unavailable()
    const {base, mapping} = selected
    const rows = this.entries(base, mapping)
    const root: Probe = { ...mapping, parts: mapping.subfolder, directory: true }
    const parent = folderId ? rows.find(entry => entry.id === folderId && entry.probe.directory)?.probe : root
    if (!parent || !(await access.check([parent]))[0]) throw unavailable()
    const children = rows.filter(({probe}) => probe.parts.length === parent.parts.length + 1
      && parent.parts.every((part, i) => probe.parts[i] === part))
    const allowed = await access.check(children.map(({probe}) => ({ ...probe, digest: undefined })))
    return children.flatMap((entry,i) => allowed[i] ? [{ id: entry.id, name: entry.name,
      kind: entry.probe.directory ? 'folder' : 'file', ...(entry.probe.directory ? {} : { href: this.link(entry) }) }] : [])
  }
  private link(entry: Entry, chunk?: string) {
    return readerPath + '/documents/' + encodeURIComponent(entry.id) + '/' + entry.probe.digest
      + '/markdown' + (chunk ? '?chunk=' + encodeURIComponent(chunk) : '')
  }
  async search(access: Access, query: ReaderQuery) {
    const bases = this.bases().filter(({base}) => !query.baseId || base.id === query.baseId)
    const remaining = new Map(bases.flatMap(({base,mapping}) => this.entries(base,mapping))
      .filter(entry => !entry.probe.directory).map(entry => [entry.id, entry]))
    const approved = new Map<string,Entry>()
    const settings = this.store.getConfigFor(query.baseId ?? (bases.length === 1 ? bases[0].base.id : undefined))
    const topK = query.topK ?? Math.min(25,Math.max(1,settings.topK))
    const pool = Math.min(50, Math.max(20, 4 * topK))
    const request = { query: query.query, mode: query.mode ?? settings.searchMode, baseIds: bases.map(({base}) => base.id) }
    let seats = 0
    while (remaining.size && seats < pool) {
      const result = await this.store.adSearch({ ...request, topK: pool, filter: { docIds: [...remaining.keys()] } })
      const candidates = [...new Set(result.hits.map(h => h.docId))].flatMap(id => remaining.get(id) ?? [])
      if (!candidates.length) break
      const allowed = await access.check(candidates.map(entry => entry.probe))
      for (const [i,entry] of candidates.entries()) {
        remaining.delete(entry.id)
        if (allowed[i] && this.current(entry)) approved.set(entry.id, entry)
      }
      seats += result.hits.filter(hit => approved.has(hit.docId)).length
    }
    if (!approved.size) return { hits: [] as ReaderHit[], reranked: false }
    const eligible = (hit: SearchHit) => {
      const entry = approved.get(hit.docId)
      return access.active() && !!entry && entry.baseId === hit.baseId && this.current(entry)
        && (!hit.processingRevision || hit.processingRevision === entry.revision)
    }
    const ranked = await this.store.adSearch({ ...request, topK, filter: { docIds: [...approved.keys()] } }, eligible)
    const hits = ranked.hits.filter(eligible)
    const winners = [...new Set(hits.map(h => h.docId))].map(id => approved.get(id)!)
    const fresh = await access.check(winners.map(entry => entry.probe))
    const visible = new Set(winners.filter((_,i) => fresh[i]).map(entry => entry.id))
    return { reranked: ranked.reranked, hits: hits.filter(hit => visible.has(hit.docId) && eligible(hit)).map(hit => {
      const entry = approved.get(hit.docId)!
      return { documentId: entry.id, title: entry.name, text: hit.text, score: hit.score, citation: this.link(entry, hit.chunkId) }
    }) }
  }
  async read(access: Access, id: string, digest: string, kind: 'markdown' | 'original', chunk?: string) {
    const {row} = this.store.adCurrentSource(id)
    const selected = this.bases().find(({base}) => base.id === row?.baseId)
    if (!selected || !fileDigest.test(digest)) throw unavailable()
    const entry = this.entries(selected.base, selected.mapping).find(entry => entry.id === id && entry.probe.digest === digest)
    if (!entry || !(await access.check([entry.probe]))[0] || !this.current(entry)) throw unavailable()
    if (kind === 'original') {
      const file = await this.store.getRawFile(id)
      if (!file || createHash('sha256').update(file.bytes).digest('hex') !== digest || !this.current(entry) || !access.active()) throw unavailable()
      return { name: entry.name, bytes: Buffer.from(file.bytes) }
    }
    const doc = this.store.getDocument(id, { includeChunks: false })
    let text = doc.rawText ?? ''
    let passage: string | undefined
    if (entry.markdown) {
      const snapshot = await this.store.getMarkdownSnapshot(id, entry.markdown)
      if (snapshot.documentId !== id || snapshot.processingRevision !== entry.revision) throw unavailable()
      text = snapshot.text
      if (chunk) passage = snapshot.passages.find(p => p.chunkId === chunk)?.text
    } else if (chunk) {
      passage = this.store.listChunks(id).find(c => c.id === chunk)?.text
    }
    if ((chunk && passage === undefined) || !this.current(entry) || !access.active()) throw unavailable()
    return { name: entry.name + '.md', bytes: Buffer.from(passage ?? text, 'utf8') }
  }
}
