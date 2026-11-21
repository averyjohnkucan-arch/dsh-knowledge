import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { administration } from '../src/knowledge/ad/administration.js'
import { AdLibrary, type ReaderStore, type SourceRow } from '../src/knowledge/ad/retrieval.js'
import { httpsOrigin, loadAdConfig, type AdConfig, type Mapping } from '../src/knowledge/ad/config.js'
import type { Access } from '../src/knowledge/ad/session.js'
import type { KnowledgeService } from '../src/knowledge/index.js'
import type { SearchHit, SearchRequest } from '../src/knowledge/types.js'

const mapping: Mapping = {baseId:'library',localRoot:'/mounted/share',server:'files.corp.test',share:'Docs',subfolder:[]}
const base = {id:'library',name:'Library',storageMode:'external',externalPath:mapping.localRoot}
const digest = 'a'.repeat(64)
function fixture() {
  const rows = Array.from({length:32},(_,i) => ({
    id:'doc' + i,baseId:base.id,sourceType:'file',sourcePath:mapping.localRoot + '/' + i + '.txt',
    processing:{revision:'current',sourceHash:digest},
  })) as SourceRow[]
  const byId = new Map(rows.map(r => [r.id,r]))
  const rankInputs: string[][] = []
  const adSearch = vi.fn(async (request: SearchRequest, gate?: (hit: SearchHit) => boolean) => {
    let hits = rows.filter(r => request.filter?.docIds?.includes(r.id)).map((r,i) => ({
      docId:r.id,baseId:base.id,chunkId:r.id + '-chunk',documentTitle:r.id,text:r.id,index:0,score:1-i/100,
    }))
    if (gate) { hits = hits.filter(gate); rankInputs.push(hits.map(h => h.docId)) }
    return {hits:hits.slice(0,request.topK),reranked:!!gate}
  })
  const store = {adSourceBases:() => [base],adSourceRows:() => rows,
    adCurrentSource:(id:string) => ({base,row:byId.get(id)}),adSearch,getConfigFor:() => ({topK:4,searchMode:'hybrid'})}
  const library = new AdLibrary(store as unknown as ReaderStore,[mapping])
  const access: Access = {active:() => true,check: async items => items.map(item => !item.parts.length || ['30.txt','31.txt'].includes(item.parts.at(-1)!))}
  return {rows,byId,rankInputs,store,library,access}
}
describe('Windows reader',() => {
  it.each(['lexical','vector','hybrid'] as const)('refills denied candidate pages before %s reranking',async mode => {
    const {library,access,rankInputs,store} = fixture()
    const result = await library.search(access,{query:'test',mode,topK:2})
    expect(result.hits.map(h => h.documentId)).toEqual(['doc30','doc31'])
    expect(rankInputs).toEqual([['doc30','doc31']])
    expect(store.adSearch).toHaveBeenCalledTimes(3)
    expect(result.hits[0].citation).toContain('/knowledge/reader/documents/doc30/' + digest + '/markdown?chunk=')
  })
  it('drops a result revoked during ranking and never exposes a cached hit after denial',async () => {
    const {library,access,rankInputs} = fixture()
    const check = access.check
    access.check = async probes => rankInputs.length ? probes.map(() => false) : check(probes)
    expect((await library.search(access,{query:'example',mode:'hybrid',topK:2})).hits).toEqual([])
    await expect(library.read(access,'doc30',digest,'markdown')).rejects.toMatchObject({status:404})
  })
  it('excludes unmapped, unbound and legacy files and rejects a changed source generation',async () => {
    const {library,rows,access,byId,rankInputs} = fixture()
    rows[30] = {...rows[30],sourcePath:'/mounted/other/30.txt'}
    rows.push({...rows[31],id:'manual',sourceType:'text'}, {...rows[31],id:'legacy',processing:undefined})
    const check = access.check
    access.check = async probes => {
      const current = byId.get('doc31')!
      byId.set('doc31',{...current,sourcePath:'/mounted/share/different.txt'})
      return check(probes)
    }
    expect((await library.search(access,{query:'test',topK:2,mode:'lexical'})).hits).toEqual([])
    expect(rankInputs).toEqual([])
  })
  it('enforces role grants on the server before a management action runs',async () => {
    const {library,access} = fixture(), service = {renameBase:vi.fn(),setConfig:vi.fn(),updateExternalSource:vi.fn(),documentSetup:vi.fn()}
    for (const action of ['settings','sync','models','policy']) {
      await expect(administration(service as unknown as KnowledgeService,library,{} as AdConfig,access,['read'],'/admin/' + action,'POST',{})).rejects.toMatchObject({status:403})
    }
    expect(Object.values(service).every(fn => fn.mock.calls.length === 0)).toBe(true)
  })
  it('persists only the explicitly assigned groups and rejects stale policy writes',async () => {
    const tmp = await mkdtemp(join(tmpdir(),'kb-group-policy-'))
    try {
      const path = join(tmp,'groups.json'), groups = {read:['Readers'],settings:[],sync:[],models:[]}
      await writeFile(path,JSON.stringify(groups))
      const {library,access} = fixture()
      const call = (method:string,body:unknown) => administration({} as KnowledgeService,library,{groupPolicyFile:path} as AdConfig,access,['policy'],'/admin/policy',method,body)
      const old = await call('GET',{}) as {version:string}
      await call('POST',{version:old.version,groups:{...groups,settings:['KB-Admins']}})
      expect(JSON.parse(await readFile(path,'utf8')).settings).toEqual(['KB-Admins'])
      await expect(call('POST',{version:old.version,groups})).rejects.toMatchObject({status:409})
      expect(() => httpsOrigin('http://reader.corp.test')).toThrow()
      await writeFile(join(tmp,'invalid.json'),'{}')
      expect(() => loadAdConfig(join(tmp,'invalid.json'))).toThrow()
    } finally { await rm(tmp,{recursive:true,force:true}) }
  })
})
