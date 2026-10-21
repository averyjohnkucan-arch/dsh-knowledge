import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarkdownSnapshots, mapMarkdownPassages, renderMarkdownSnapshot } from '../src/knowledge/markdown-snapshots.js'
import type { KnowledgeChunk, KnowledgeDocument } from '../src/knowledge/types.js'
const doc:KnowledgeDocument={id:'doc',baseId:'base',title:'<script>alert(1)</script>',sourceType:'file',charCount:20,chunkCount:1,createdAt:1}
const chunk=(text:string,index=0):KnowledgeChunk=>({id:'chunk'+index,docId:'doc',baseId:'base',index,text})
const paths:string[]=[]
afterEach(async()=>{for(const path of paths.splice(0))await rm(path,{recursive:true,force:true})})
describe('saved indexed Markdown',()=>{
 it('maps repeated, overlapping and Unicode passages to verified source lines',()=>{
  const text='😀 same\r\n\r\n😀 same\n\nNext   paragraph.'
  const rows=mapMarkdownPassages(text,[chunk('😀 same'),chunk('😀 same',1),chunk('Next paragraph.',2)])
  expect(rows[0].ranges[0]).toMatchObject({start:0,lineStart:1})
  expect(rows[1].ranges[0].start).toBeGreaterThan(0)
  expect(rows[2].ranges[0].lineStart).toBe(5)
  expect(mapMarkdownPassages(text,[chunk('invented text')])[0].ranges).toEqual([])
 })
 it('keeps old versions immutable and rejects tampered text and unsafe identities',async()=>{
  const path=await mkdtemp(join(tmpdir(),'markdown-test-'));paths.push(path)
  const store=new MarkdownSnapshots(path)
  const first=await store.save(doc,'old text',[chunk('old text')])
  const second=await store.save(doc,'new text',[chunk('new text')])
  expect((await store.load('base','doc',first))?.text).toBe('old text')
  expect((await store.load('base','doc',second))?.text).toBe('new text')
  await expect(store.load('base','../outside',first)).rejects.toThrow('identifier')
  await writeFile(join(path,'base','doc',first,'indexed.md'),'changed')
  await expect(store.load('base','doc',first)).rejects.toThrow('Invalid')
  expect(await store.load('base','other',second)).toBeUndefined()
 })
 it('deletes retained copies while leaving the original file untouched, including pending saves',async()=>{
  const path=await mkdtemp(join(tmpdir(),'markdown-delete-'));paths.push(path)
  const source=join(path,'original.md');await writeFile(source,'original')
  const store=new MarkdownSnapshots(join(path,'internal'))
  const saving=store.save(doc,'saved copy',[chunk('saved copy')]);await store.removeDocument('base','doc');const revision=await saving
  expect(await store.load('base','doc',revision)).toBeUndefined()
  expect(await readFile(source,'utf8')).toBe('original')
  await expect(store.save(doc,'late copy',[])).rejects.toThrow('deleted')
 })
 it('renders script-free escaped highlighting and never highlights an unmapped passage',async()=>{
  const store=new MarkdownSnapshots();const revision=await store.save(doc,'line one\n<script>unsafe</script>',[chunk('<script>unsafe</script>')])
  const saved=(await store.load('base','doc',revision))!
  const html=renderMarkdownSnapshot(saved,'chunk0')
  expect(html).toContain('<mark id="citation">&lt;script&gt;unsafe&lt;/script&gt;</mark>')
  expect(html).toContain('lines 2–2');expect(html).not.toContain('<script>')
  expect(()=>renderMarkdownSnapshot(saved,'wrong')).toThrow('does not belong')
  const unmapped=await store.save(doc,'source',[chunk('transformed passage')])
  expect(renderMarkdownSnapshot((await store.load('base','doc',unmapped))!,'chunk0')).toContain('No exact source range')
 })
})
