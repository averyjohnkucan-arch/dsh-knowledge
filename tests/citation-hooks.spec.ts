import { describe, expect, it } from 'vitest'
import { CitationDecoder, citationDefinition, citationHandle, requestCitations, resolveCitationStream, resolvedCitation } from '../src/tool-knowledge/citation-hooks.js'
import { passageUrl } from '../src/knowledge/citation-source.js'
const origin = 'http://localhost:3080'
const path = passageUrl('doc', {id:'chunk',docId:'doc',baseId:'base',index:0,text:'evidence'})
const id = citationHandle(path), hook = `[[cite:${id}]]`
const link = resolvedCitation('Source title',path,origin)
const resolve = (ref:string) => ref === id ? link : undefined

describe('citation hooks', () => {
  it('is stable across origins and does not expose URLs in the emitted hook', () => {
    expect(citationHandle(origin+path)).toBe(id)
    expect(id).toHaveLength(16)
    expect(link).toContain(')\u2060[Original ↗](')
  })
  it('handles every streaming split and never exposes an unfinished valid hook', () => {
    for(let split=0;split<=hook.length;split++) {
      const decoder = new CitationDecoder(resolve)
      const first=decoder.push('Claim '+hook.slice(0,split))
      if(split<hook.length) expect(first).toBe('Claim ')
      expect(first+decoder.push(hook.slice(split)+' done',true)).toBe('Claim '+link+' done')
    }
    const decoder=new CitationDecoder(resolve)
    expect([...hook].map(c=>decoder.push(c)).join('')+decoder.push('',true)).toBe(link)
  })
  it('keeps code, escaped literals and ordinary Markdown unchanged', () => {
    for(const text of [`\`${hook}\``, '```md\n'+hook+'\n```', '~~~\n'+hook+'\n~~~', '\\'+hook, '[normal](https://example.com)', 'math [x]']) {
      const decoder=new CitationDecoder(resolve)
      expect([...text].map(c=>decoder.push(c)).join('')+decoder.push('',true)).toBe(text)
    }
  })
  it('fails closed on unissued or malformed refs; handles multiple hooks', () => {
    expect(new CitationDecoder(resolve).push('[[cite:0000000000000000]]',true)).toBe('[Source unavailable]')
    expect(new CitationDecoder(resolve).push('[[cite:invalid]]',true)).toBe('[Invalid citation]')
    expect(new CitationDecoder(resolve).push(hook+' '+hook,true)).toBe(link+' '+link)
    expect(new CitationDecoder(resolve).push('[[cite:abc',true)).toBe('[[cite:abc')
  })
  it('collects only knowledge-origin evidence and validates hash and origin', () => {
    const message=(kind:string,text:string)=>({role:'user',source:{kind},content:[{type:'text',text}]})
    const collect=(messages:unknown[])=>requestCitations(messages as never,origin)
    expect(collect([message('dsh-knowledge',citationDefinition(origin+path))]).get(id)).toBe(path)
    expect(collect([message('user',citationDefinition(origin+path))]).size).toBe(0)
    expect(collect([message('dsh-knowledge',citationDefinition('https://evil.test'+path))]).size).toBe(0)
    expect(collect([message('dsh-knowledge',citationDefinition(path).replace(id,'0000000000000000'))]).size).toBe(0)
    const call={role:'assistant',content:[{type:'tool-call',id:'call',name:'knowledge_search'}]}
    const result={role:'tool',source:{kind:'tool',callId:'call'},content:[{type:'text',text:citationDefinition(path)}]}
    expect(collect([call,result]).size).toBe(1)
    expect(collect([{...call,content:[{...call.content[0],name:'web_search'}]},result]).size).toBe(0)
  })
  it('preserves stream metadata and makes final saved blocks match live output', async () => {
    const chunks=[{type:'block-start',index:0,blockType:'text'}, {type:'text-delta',index:0,text:'Claim '+hook.slice(0,9)},
      {type:'reasoning-delta',index:1,text:hook}, {type:'text-delta',index:0,text:hook.slice(9)},
      {type:'block-end',index:0,block:{type:'text',text:'Claim '+hook}}, {type:'usage',usage:{outputTokens:25}}, {type:'finish',reason:{kind:'stop'}}]
    async function* source(){yield* chunks}
    const result=[];for await(const row of resolveCitationStream(source() as never,resolve))result.push(row)
    expect(result.filter(r=>r.type==='text-delta').map(r=>r.text).join('')).toBe('Claim '+link)
    expect(result.find(r=>r.type==='block-end')).toMatchObject({block:{text:'Claim '+link}})
    expect(result.find(r=>r.type==='reasoning-delta')).toEqual(chunks[2])
    expect(result.at(-2)).toEqual(chunks.at(-2));expect(result.at(-1)).toEqual(chunks.at(-1))
  })
  it('flushes a truncated stream before aborted finish', async () => {
    async function* source(){yield {type:'text-delta',index:0,text:'x [[cite:'};yield {type:'finish',reason:{kind:'aborted'}}}
    const result=[];for await(const row of resolveCitationStream(source() as never,resolve))result.push(row)
    expect(result.filter(r=>r.type==='text-delta').map(r=>r.text).join('')).toBe('x [[cite:')
    expect(result.at(-1)?.type).toBe('finish')
  })
})
