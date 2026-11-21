import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { type AdConfig, ReaderError } from './config.js'

import { actions, roleGroups, type AdAction } from './roles.js'

export interface Probe { server: string; share: string; parts: string[]; directory: boolean; digest?: string }
export interface Access { check(items: readonly Probe[]): Promise<boolean[]>; active(): boolean }
const worker = join(dirname(createRequire(import.meta.url).resolve('dsh-knowledge/package.json')), 'src/runtime/ad/check_access.py')

async function run(command: string, args: string[], input: string, cache: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, KRB5CCNAME: 'FILE:' + cache },
      stdio: ['pipe','pipe','ignore'] })
    let output = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout)
    timer.unref()
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.stdout.setEncoding('utf8').on('data', (part: string) => {
      output += part
      if (output.length > 8192) child.kill('SIGKILL')
    })
    child.stdin.on('error', () => {})
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error('Kerberos or SMB check failed'))
    })
    child.stdin.end(input)
  })
}

export class AdSessions {
  private sessions = new Map<string, { dir: string; expires: number; name: string }>()
  private attempts = new Map<string, { count: number; until: number }>()
  private pending = 0
  private checking = 0
  private closed = false
  private timer: NodeJS.Timeout
  constructor(private config: AdConfig) {
    this.timer = setInterval(() => {
      for (const [token, session] of this.sessions) if (session.expires <= Date.now()) void this.logout(token)
      for (const [key, entry] of this.attempts) if (entry.until <= Date.now()) this.attempts.delete(key)
    }, 30_000)
    this.timer.unref()
  }
  async login(name: string, password: string, peer: string) {
    const parts = name.trim().split('@')
    if (parts.length > 2 || (parts[1] !== undefined && parts[1].toUpperCase() !== this.config.realm)
      || !/^[a-z0-9_][a-z0-9_. '\-]{0,63}$/i.test(parts[0]) || !password || password.length > 1024 || /[\r\n\0]/.test(password))
      throw new ReaderError(401, 'Domain sign-in failed.')
    const principal = parts[0] + '@' + this.config.realm
    if (this.closed || this.pending >= 8 || this.pending + this.sessions.size >= this.config.maxSessions)
      throw new ReaderError(503, 'The reader is busy. Try again shortly.')
    const keys = ['user/' + principal.toLowerCase(), 'peer/' + peer]
    for (const [i, key] of keys.entries()) {
      const entry = this.attempts.get(key)
      if (entry && entry.until > Date.now() && entry.count >= (i === 0 ? 5 : 40))
        throw new ReaderError(429, 'Please wait before signing in again.')
    }
    for (const key of keys) {
      const entry = this.attempts.get(key)
      this.attempts.set(key, entry && entry.until > Date.now() ? { ...entry, count: entry.count + 1 } : { count: 1, until: Date.now() + 60_000 })
    }
    this.pending++
    let dir: string | undefined
    try {
      dir = await mkdtemp('/dev/shm/dsh-knowledge-')
      await run('/usr/bin/kinit', ['-F','-P','-l', this.config.sessionMinutes + 'm', principal], password + '\n', join(dir, 'ticket'), 15_000)
      if (this.closed) throw new Error('Reader stopped')
      const token = randomBytes(32).toString('base64url')
      const expires = Date.now() + this.config.sessionMinutes * 60_000
      this.sessions.set(token, { dir, expires, name: principal })
      dir = undefined
      this.attempts.delete(keys[0])
      return { token, expires, name: principal }
    } catch {
      throw new ReaderError(401, 'Domain sign-in failed.')
    } finally { this.pending--; if (dir) await rm(dir, { recursive: true, force: true }) }
  }
  get(token: string) {
    const session = this.sessions.get(token)
    if (!session || session.expires <= Date.now()) throw new ReaderError(401, 'Sign in with your domain account.')
    const active = () => this.sessions.get(token) === session && session.expires > Date.now()
    const check = async (items: readonly Probe[]) => {
      if (!active()) throw new ReaderError(401, 'Sign in again.')
      if (!items.length) return []
      if (this.checking >= 16) throw new ReaderError(503, 'The reader is busy. Try again shortly.')
      this.checking++
      const results: boolean[] = []
      try {
        for (let offset = 0; offset < items.length; offset += 64) {
          if (!active()) throw new ReaderError(401, 'Sign in again.')
          const batch = items.slice(offset, offset + 64)
          const out: unknown = JSON.parse(await run('/usr/bin/python3', ['-I', worker], JSON.stringify(batch), join(session.dir, 'ticket'), 90_000))
          if (!Array.isArray(out) || out.length !== batch.length || out.some(value => typeof value !== 'boolean')) throw new Error('Incomplete SMB response')
          results.push(...out)
        }
        if (!active()) throw new ReaderError(401, 'Sign in again.')
        return results
      } catch (error) {
        if (error instanceof ReaderError) throw error
        throw new ReaderError(503, 'Windows access could not be verified.')
      } finally { this.checking-- }
    }
    const permissions = async (): Promise<AdAction[]> => {
      if (!active()) throw new ReaderError(401,'Sign in again.')
      if (this.checking >= 16) throw new ReaderError(503,'The reader is busy.')
      this.checking++
      try {
        const result = JSON.parse(await run('/usr/bin/python3', ['-I',worker],
          JSON.stringify({dc:this.config.domainController,groups:{...roleGroups.parse(JSON.parse(await readFile(this.config.groupPolicyFile,'utf8'))),policy:this.config.policyAdmins}}), join(session.dir,'ticket'), 15_000))
        if (!active()) throw new ReaderError(401,'Sign in again.')
        if (result?.reauth === true) {
          await this.logout(token)
          throw new ReaderError(401,'Your domain membership changed. Sign in again.')
        }
        if (!Array.isArray(result) || result.some(v => !actions.includes(v))) throw new Error('Invalid AD response')
        return result as AdAction[]
      } catch (error) {
        if (error instanceof ReaderError) throw error
        throw new ReaderError(503,'AD group membership could not be verified.')
      } finally { this.checking-- }
    }
    return { name: session.name, expires: session.expires, active, check, permissions }
  }
  async logout(token: string) {
    const session = this.sessions.get(token)
    this.sessions.delete(token)
    if (session) await rm(session.dir, { recursive: true, force: true })
  }
  async close() {
    this.closed = true
    clearInterval(this.timer)
    await Promise.all([...this.sessions.keys()].map(token => this.logout(token)))
  }
}
