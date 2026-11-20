import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { createGunzip, createGzip } from 'node:zlib'
import type { KnowledgeDocument } from './types.js'

type Item = Pick<KnowledgeDocument, 'id' | 'title' | 'sourceType' | 'fileName' | 'mimeType' | 'url' | 'parentDirectoryId'> & {
  text?: string
  original?: string
}

interface ArchiveBase { name: string; description?: string; group?: string }

export interface ArchiveWriter {
  create(base: ArchiveBase): Promise<string>
  add(baseId: string, item: Item, parent?: string): Promise<string>
  discard(baseId: string): Promise<void>
}

// Each line carries one document so exporting a large KB never collects its source bytes in RAM.
export function exportArchive(base: ArchiveBase, docs: readonly KnowledgeDocument[],
  load: (id: string) => Promise<{text?: string; original?: string}>) {
  async function* lines() {
    yield JSON.stringify({ format:'dsh-knowledge', version:1, base, count:docs.length }) + '\n'
    const children = new Map<string | undefined, KnowledgeDocument[]>()
    const ids = new Set(docs.map(d => d.id))
    for (const doc of docs) {
      const parent = doc.parentDirectoryId && ids.has(doc.parentDirectoryId) ? doc.parentDirectoryId : undefined
      const list = children.get(parent) ?? []
      list.push(doc)
      children.set(parent, list)
    }
    const queue = [...(children.get(undefined) ?? [])]
    for (let i = 0; i < queue.length; i++) {
      const { id,title,sourceType,fileName,mimeType,url,parentDirectoryId } = queue[i]
      const item: Item = { id,title,sourceType,fileName,mimeType,url,
        parentDirectoryId: parentDirectoryId && ids.has(parentDirectoryId) ? parentDirectoryId : undefined }
      if (sourceType !== 'directory') Object.assign(item, await load(id))
      yield JSON.stringify(item) + '\n'
      for (const child of children.get(id) ?? []) queue.push(child)
    }
    if (queue.length !== docs.length) throw new Error('A folder in this base has a circular parent.')
    yield JSON.stringify({ end:docs.length }) + '\n'
  }
  return Readable.from(lines()).compose(createGzip({ level:1 }))
}

export async function importArchive(source: Readable, writer: ArchiveWriter) {
  const gzip = source.compose(createGunzip())
  const lines = createInterface({ input:gzip, crlfDelay:Infinity })
  let baseId: string | undefined, expected = 0, finished = false
  const ids = new Map<string, string>()
  const folders = new Set<string>()
  try {
    for await (const line of lines) {
      const row = JSON.parse(line)
      if (finished) throw new Error('Unexpected data after end of knowledge base')
      if (!baseId) {
        if (row?.format !== 'dsh-knowledge' || row.version !== 1 || !Number.isSafeInteger(row.count) || row.count < 0 ||
            typeof row.base?.name !== 'string' || !row.base.name.trim()) throw new Error('Choose a Knowledge base export (.dshkb).')
        expected = row.count
        baseId = await writer.create({name:row.base.name, description:typeof row.base.description === 'string' ? row.base.description : '', group:typeof row.base.group === 'string' ? row.base.group : undefined})
        continue
      }
      if (row && Object.hasOwn(row, 'end')) {
        if (row.end !== expected || ids.size !== expected) throw new Error('The export is incomplete.')
        finished = true
        continue
      }
      if (ids.size >= expected || typeof row?.id !== 'string' || ids.has(row.id) || typeof row.title !== 'string' ||
          !['directory','file','url','text'].includes(row.sourceType) || (row.parentDirectoryId !== undefined && !folders.has(row.parentDirectoryId)) ||
          (row.sourceType !== 'directory' && typeof row.text !== 'string') ||
          ['fileName','mimeType','url','original'].some(key => row[key] !== undefined && typeof row[key] !== 'string') ||
          (row.url && !/^https?:\/\//i.test(row.url))) throw new Error('Invalid document in knowledge base export.')
      const id = await writer.add(baseId, row, ids.get(row.parentDirectoryId))
      ids.set(row.id, id)
      if (row.sourceType === 'directory') folders.add(row.id)
    }
    if (!baseId || !finished) throw new Error('The export is incomplete.')
    return { id:baseId, documents:ids.size }
  } catch (error) {
    if (baseId) await writer.discard(baseId)
    throw error
  } finally { lines.close(); gzip.destroy() }
}
