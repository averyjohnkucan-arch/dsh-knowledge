import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { httpsOrigin, loopback, readerPath, ReaderError, unavailable, type AdConfig } from './config.js'
import { AdSessions } from './session.js'
import { administration } from './administration.js'
import { AdLibrary } from './retrieval.js'
import type { KnowledgeService } from '../index.js'

const cookieName = '__Host-dshKb'
const assets = new Map([['/', ['reader.html','text/html']], ['/app.js',['app.js','text/javascript']], ['/style.css',['style.css','text/css']]])
const assetRoot = join(dirname(createRequire(import.meta.url).resolve('dsh-knowledge/package.json')), 'src/runtime/ad')
const loginBody = z.object({ name: z.string(), password: z.string() }).strict()
const searchBody = z.object({ query: z.string().trim().min(1).max(2000), topK: z.number().int().min(1).max(25).optional(),
  mode: z.enum(['auto','vector','hybrid','lexical']).optional(), baseId: z.string().min(1).max(150).optional() }).strict()

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value))
}
function headers(res: ServerResponse) {
  res.setHeader('cache-control','private, no-store')
  res.setHeader('x-content-type-options','nosniff')
  res.setHeader('referrer-policy','no-referrer')
  res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'")
}
function reject(res: ServerResponse, error: unknown) {
  const status = error instanceof ReaderError ? error.status : error instanceof z.ZodError ? 400 : 503
  json(res, status, {error: error instanceof ReaderError ? error.message : status === 400 ? 'Invalid reader request.' : 'The reader is unavailable.'})
}
async function body(req: IncomingMessage) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new ReaderError(415,'Send a JSON request.')
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) throw new ReaderError(413,'Request too large.')
    chunks.push(Buffer.from(chunk))
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new ReaderError(400,'Invalid JSON.') }
}
export function privateHost(req: IncomingMessage, bind: string) {
  const host = req.headers.host
  return loopback(bind) && loopback(req.socket?.remoteAddress) && !!host
    && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
    && !Object.keys(req.headers).some(key => key === 'forwarded' || key.startsWith('x-forwarded-'))
    && req.headers['sec-fetch-site'] !== 'cross-site'
    && (!req.headers.origin || req.headers.origin === 'http://' + host || req.headers.origin === 'https://' + host)
}
function cookie(token: string, seconds: number) {
  return cookieName + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=' + seconds
}
function tokenOf(value?: string) {
  return value?.split(/;\s*/).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? ''
}
async function staticAsset(res: ServerResponse, path: string) {
  const asset = assets.get(path)
  if (!asset) return false
  const contents = await readFile(join(assetRoot,asset[0]))
  res.writeHead(200,{'content-type':asset[1] + '; charset=utf-8'}); res.end(contents); return true
}
function documentPath(path: string) {
  return /^\/documents\/([a-zA-Z0-9_-]{1,150})\/([a-f0-9]{64})\/(markdown|original)$/.exec(path)
}

export async function startAdServer(service: KnowledgeService, config: AdConfig) {
  if (!loopback(service.managementBindHost)) throw new Error('Bind the indexer Harness to loopback before starting its AD reader')
  const [cert,key] = await Promise.all([readFile(config.certificate),readFile(config.privateKey)])
  const sessions = new AdSessions(config)
  const library = new AdLibrary(service,config.mappings)
  async function handle(req: IncomingMessage, res: ServerResponse) {
    headers(res)
    const origin = config.publicOrigin
    if (req.headers.host?.toLowerCase() !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin))
      throw new ReaderError(403,'Invalid reader origin.')
    const url = new URL(req.url ?? '/',origin)
    if (url.origin !== origin) throw unavailable()
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === readerPath)) {
      res.writeHead(302,{location:readerPath + '/'}); res.end(); return
    }
    if (!url.pathname.startsWith(readerPath + '/')) throw unavailable()
    const path = url.pathname.slice(readerPath.length)
    if (req.method === 'GET' && await staticAsset(res,path)) return
    const token = tokenOf(req.headers.cookie)
    if (req.method === 'POST' && (req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site'))
      throw new ReaderError(403, 'Invalid reader origin.')
    if (req.method === 'POST' && path === '/login') {
      const {name,password} = loginBody.parse(await body(req))
      const result = await sessions.login(name,password,req.socket.remoteAddress ?? '')
      let permissions
      try {
        permissions = await sessions.get(result.token).permissions()
        if (!permissions.length) throw new ReaderError(403,'Your account has no assigned Knowledge permission.')
      } catch (error) { await sessions.logout(result.token); throw error }
      await sessions.logout(token)
      res.setHeader('set-cookie',cookie(result.token,config.sessionMinutes * 60))
      json(res,200,{name:result.name,expires:result.expires,permissions}); return
    }
    if (req.method === 'POST' && path === '/logout') {
      await body(req); await sessions.logout(token); res.setHeader('set-cookie',cookie('',0)); json(res,200,{}); return
    }
    const access = sessions.get(token)
    const permissions = await access.permissions()
    if (path === '/session' && req.method === 'GET') { json(res,200,{name:access.name,expires:access.expires,permissions}); return }
    await service.whenReady()
    let result: unknown
    if (path.startsWith('/admin/')) {
      result = await administration(service,library,config,access,permissions,path,req.method ?? '',
        req.method === 'POST' ? await body(req) : undefined,url.searchParams.get('baseId') ?? undefined)
      json(res,200,result); return
    }
    if (!permissions.includes('read')) throw new ReaderError(403,'Your AD groups do not grant Knowledge reading.')
    if (path === '/browse' && req.method === 'GET') {
      result = await library.browse(access,url.searchParams.get('baseId') ?? undefined,url.searchParams.get('folderId') ?? undefined)
    } else if (path === '/search' && req.method === 'POST') {
      result = await library.search(access,searchBody.parse(await body(req)))
    } else {
      const match = documentPath(path)
      if (!match || req.method !== 'GET') throw unavailable()
      const original = match[3] === 'original'
      const value = await library.read(access, match[1], match[2], original ? 'original' : 'markdown',url.searchParams.get('chunk') ?? undefined)
      if (!access.active()) throw new ReaderError(401,'Sign in again.')
      if (!(await access.permissions()).includes('read')) throw new ReaderError(403,'Your reading permission changed.')
      const attachment = original || url.searchParams.get('download') === '1'
      res.writeHead(200, { 'content-type': original ? 'application/octet-stream' : 'text/plain; charset=utf-8',
        'content-disposition': (attachment ? 'attachment' : 'inline') + "; filename*=UTF-8''" + encodeURIComponent(value.name).replace(/'/g,'%27') })
      res.end(value.bytes); return
    }
    if (!access.active()) throw new ReaderError(401,'Sign in again.')
    if (!(await access.permissions()).includes('read')) throw new ReaderError(403,'Your reading permission changed.')
    json(res,200,result)
  }
  const server = createServer({cert,key,minVersion:'TLSv1.2'},(req,res) => {
    void handle(req,res).catch(error => reject(res,error))
  })
  server.headersTimeout = 15_000; server.requestTimeout = 120_000
  try {
    await new Promise<void>((ok,fail) => { server.once('error',fail); server.listen(config.port,config.listenHost,() => { server.off('error',fail); ok() }) })
  } catch (error) { await sessions.close(); throw error }
  return async () => {
    server.closeAllConnections()
    await Promise.all([new Promise<void>(ok => server.close(() => ok())),sessions.close()])
  }
}

/** One personal, loopback-only Harness process per OS user. Its credential is never sent to a model. */
export class AdClient {
  readonly origin: string
  private cookie = ''
  private epoch = 0
  constructor(origin: string) { this.origin = httpsOrigin(origin) }
  private async fetch(path: string, data?: unknown) {
    const epoch = this.epoch
    const res = await fetch(this.origin + readerPath + path, { redirect:'error', signal: AbortSignal.timeout(120_000),
      headers: { cookie: this.cookie, origin:this.origin, ...(data === undefined ? {} : {'content-type':'application/json'}) },
      method: data === undefined ? 'GET' : 'POST', ...(data === undefined ? {} : {body:JSON.stringify(data)}) })
    if (epoch !== this.epoch) { await res.body?.cancel(); throw new ReaderError(401,'Sign in again.') }
    if (res.ok && path === '/login') {
      const t = tokenOf(res.headers.getSetCookie()[0])
      if (!/^[A-Za-z0-9_-]{43}$/.test(t)) throw new ReaderError(503,'Domain sign-in is unavailable.')
      this.cookie = cookieName + '=' + t; this.epoch++
    } else if ((res.status === 401 && this.cookie) || path === '/logout') { this.cookie = ''; this.epoch++ }
    return res
  }
  async tool(path: string, data?: unknown) {
    const epoch = this.epoch
    const response = await this.fetch(path,data)
    if (!response.ok) throw new Error(response.status === 401 ? 'Open Knowledge and sign in with your domain account.' : 'This Knowledge request is unavailable.')
    const result = await response.text()
    if (epoch !== this.epoch) throw new Error('Sign in again.')
    return result
  }
  async handle(req: IncomingMessage, res: ServerResponse, bind: string) {
    headers(res)
    try {
      if (!privateHost(req,bind)) throw new ReaderError(403,'Use your personal, loopback-bound Harness.')
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname === '/knowledge/reader-mode') { json(res,200,{reader:true}); return }
      if (!url.pathname.startsWith(readerPath + '/')) throw unavailable()
      const path = url.pathname.slice(readerPath.length)
      if (req.method === 'GET' && await staticAsset(res,path)) return
      const allowed = req.method === 'GET' ? ['/session','/browse','/admin/bases','/admin/settings','/admin/policy','/admin/models'].includes(path) || documentPath(path) : req.method === 'POST' && ['/login','/logout','/search','/admin/settings','/admin/policy','/admin/sync','/admin/models'].includes(path)
      if (!allowed) throw unavailable()
      const requestedEpoch = this.epoch
      const upstream = await this.fetch(path + (req.method === 'GET' ? url.search : ''),req.method === 'POST' ? await body(req) : undefined)
      const epoch = this.epoch
      const bytes = Buffer.from(await upstream.arrayBuffer())
      if (this.epoch !== epoch || (upstream.ok && path !== '/login' && path !== '/logout' && requestedEpoch !== this.epoch)) throw new ReaderError(401,'Sign in again.')
      const disposition = upstream.headers.get('content-disposition')
      res.writeHead(upstream.status, { 'content-type':upstream.headers.get('content-type') ?? 'application/json',
        ...(disposition ? {'content-disposition':disposition} : {}) }); res.end(bytes)
    } catch (error) { reject(res,error) }
  }
}
