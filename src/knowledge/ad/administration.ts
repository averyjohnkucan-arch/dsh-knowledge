import { createHash, randomUUID } from 'node:crypto'
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { z } from 'zod'
import { ReaderError, unavailable, type AdConfig } from './config.js'
import { projectSettings, roleGroups, safeSettings, type AdAction } from './roles.js'
import type { AdLibrary } from './retrieval.js'
import type { Access } from './session.js'
import type { KnowledgeService } from '../index.js'

const scope = z.string().min(1).max(150).optional()
const policyUpdate = z.object({ version: z.string(), groups: roleGroups }).strict()
const settingsUpdate = z.object({ baseId: scope, changes: safeSettings.partial() }).strict()
const baseAction = z.object({baseId:z.string().min(1).max(150)}).strict()
const version = (data: string) => createHash('sha256').update(data).digest('hex')
function policy(path: string) {
  const data = readFileSync(path,'utf8')
  return { groups: roleGroups.parse(JSON.parse(data)), version:version(data) }
}

export async function administration(service: KnowledgeService, library: AdLibrary, config: AdConfig, access: Access,
  permitted: readonly AdAction[], path: string, method: string, body: unknown, baseId?: string) {
  const action = path.slice('/admin/'.length)
  if (!['settings','sync','models','policy','bases'].includes(action) || !['GET','POST'].includes(method)) throw unavailable()
  if (action === 'bases') {
    if (method !== 'GET' || !permitted.some(p => ['settings','sync','models'].includes(p))) throw new ReaderError(403,'An administrative AD group is required.')
    return library.browse(access)
  }
  if (!permitted.includes(action as AdAction)) throw new ReaderError(403,'Your AD groups do not grant this permission.')
  if (action === 'policy') {
    if (method === 'GET') return policy(config.groupPolicyFile)
    const next = policyUpdate.parse(body)
    if (next.version !== policy(config.groupPolicyFile).version) throw new ReaderError(409,'The policy changed. Reload before saving.')
    const tmp = config.groupPolicyFile + '.' + randomUUID()
    const fd = openSync(tmp,'wx',0o600)
    try {
      try { writeFileSync(fd,JSON.stringify(next.groups,null,2) + '\n') } finally { closeSync(fd) }
      renameSync(tmp,config.groupPolicyFile)
    } finally { try { unlinkSync(tmp) } catch { /* renamed */ } }
    return policy(config.groupPolicyFile)
  }
  const change = action === 'settings' && method === 'POST' ? settingsUpdate.parse(body) : undefined
  const id = change ? change.baseId : method === 'POST' ? baseAction.parse(body).baseId : baseId
  if (id && !(await library.browse(access)).some(row => row.id === id)) throw unavailable()
  if (!access.active()) throw new ReaderError(401,'Sign in again.')
  if (action === 'settings') {
    if (change) {
      const effective = { ...service.getConfigFor(id), ...change.changes }
      if (effective.chunkOverlap >= effective.chunkSize) throw new ReaderError(400,'Chunk overlap must be smaller than chunk size.')
      if (id) await service.renameBase(id,{config:change.changes})
      else await service.setConfig(change.changes)
    }
    return projectSettings(service.getConfigFor(id))
  }
  if (!id) throw new ReaderError(400,'Choose a knowledge base.')
  if (action === 'sync' && method === 'POST') {
    await service.updateExternalSource(id,{reconcileNow:true})
    return {queued:true}
  }
  if (action === 'models') {
    const state = await service.documentSetup(id,method === 'POST')
    return {status:state.status}
  }
  throw unavailable()
}
