import { gzipSync } from 'node:zlib'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { exportArchive, importArchive } from '../src/knowledge/base-archive.js'
import type { KnowledgeDocument } from '../src/knowledge/types.js'

const header = { baseId:'base', createdAt:1, updatedAt:1, charCount:0, chunkCount:0 }
const docs: KnowledgeDocument[] = [
  {...header, id:'note', title:'Measurements', sourceType:'file', fileName:'measurements.md', parentDirectoryId:'folder'},
  {...header, id:'folder', title:'Lab', sourceType:'directory'},
]
it('round trips nested content and original bytes into a fresh base', async () => {
  const source = exportArchive({name:'Lab notes'}, docs, async () => ({text:'# Results\n\n42', original:'NDI='}))
  const writer = {create:vi.fn(async () => 'new'), add:vi.fn(async (_base, item) => 'new-' + item.id), discard:vi.fn()}
  expect(await importArchive(source, writer)).toEqual({id:'new',documents:2})
  expect(writer.add).toHaveBeenLastCalledWith('new', expect.objectContaining({id:'note',text:'# Results\n\n42',original:'NDI='}), 'new-folder')
  expect(writer.discard).not.toHaveBeenCalled()
})
it('removes a partial import if the archive lacks its final record', async () => {
  const data = gzipSync(JSON.stringify({format:'dsh-knowledge',version:1,base:{name:'Incomplete'},count:1})+'\n')
  const writer = {create:vi.fn(async () => 'partial'), add:vi.fn(), discard:vi.fn()}
  await expect(importArchive(Readable.from([data]),writer)).rejects.toThrow('incomplete')
  expect(writer.discard).toHaveBeenCalledWith('partial')
})
