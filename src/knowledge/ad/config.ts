import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { groups } from './roles.js'

export const readerPath = '/knowledge/reader'
export const fileDigest = /^[a-f0-9]{64}$/
export const component = (part: string): boolean => part.length > 0 && part.length <= 255
  && !/[\\/:*?"<>|\x00-\x1f\x7f]/.test(part) && !/[. ]$/.test(part)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)

export function httpsOrigin(input: string): string {
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('The AD reader requires an HTTPS origin')
  return url.origin
}
const dnsName = z.string().max(253).regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i)
const absolute = z.string().refine(isAbsolute)
const mapping = z.object({
  baseId: z.string().min(1), localRoot: absolute.transform(value => resolve(value)),
  server: dnsName, share: z.string().refine(component),
  subfolder: z.array(z.string().refine(component)).max(64).default([]),
}).strict()
const settings = z.object({
  domainController: dnsName, groupPolicyFile: absolute, policyAdmins: groups,
  realm: dnsName.transform(value => value.toUpperCase()), publicOrigin: z.string().transform(httpsOrigin),
  listenHost: z.string().min(1), port: z.number().int().min(1).max(65535),
  certificate: absolute, privateKey: absolute, mappings: z.array(mapping).min(1),
  sessionMinutes: z.number().int().min(1).max(15).default(10),
  maxSessions: z.number().int().min(1).max(1024).default(64),
}).strict()
export type AdConfig = z.infer<typeof settings>
export type Mapping = z.infer<typeof mapping>
export function loadAdConfig(path: string): AdConfig {
  const value = settings.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (new Set(value.mappings.map(m => m.baseId)).size !== value.mappings.length)
    throw new Error('Each AD reader base requires exactly one Windows source')
  return value
}
export class ReaderError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
export const unavailable = () => new ReaderError(404, 'This item is unavailable.')
export function loopback(host?: string): boolean {
  return ['localhost','127.0.0.1','::1','::ffff:127.0.0.1','[::1]'].includes(host ?? '')
}
