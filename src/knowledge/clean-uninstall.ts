import { access, lstat, readFile, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { isMap, isSeq, parseDocument, type YAMLSeq } from 'yaml'
import { checkOwnedRoot, DeploymentError, OWNERSHIP_MARKER } from './mineru-deployment-plan.js'

const bundle = 'dsh-knowledge'
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT'
function conflict(message: string): never { throw new DeploymentError('uninstall_conflict', message, 409) }
const present = (file: string) => lstat(file).catch(error => { if (!missing(error)) throw error })

export interface UninstallProfile { home: string; dir: string; name: string }
export interface UninstallManager {
  removeBundle(name: string): Promise<{application: string; packageResult?: {exitCode: number | null; timedOut?: boolean}; error?: {code: string; diagnostic?: string}}>
}

async function profileManifests(profile: UninstallProfile): Promise<string[]> {
  const profiles = join(resolve(profile.home), 'profiles')
  if (resolve(profile.dir) !== join(profiles, basename(profile.name)) || basename(profile.name) !== profile.name) conflict('Cannot identify the active Harness profile.')
  const manifests: string[] = []
  for (const entry of await readdir(profiles, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || !(entry.isDirectory() || entry.isSymbolicLink())) continue
    const file = join(profiles, entry.name, 'package.json')
    if (await present(file)) manifests.push(file)
  }
  return manifests.sort()
}

async function checkOwners(profile: UninstallProfile, manifests: string[], installed: boolean) {
  let active = false
  for (const file of manifests) {
    const p = JSON.parse(await readFile(file, 'utf8'))
    const owns = [p.dependencies, p.optionalDependencies, p.devDependencies].some(map => Object.hasOwn(map ?? {}, bundle)) || p.dsh?.profile?.bundles?.includes(bundle)
    if (dirname(file) === resolve(profile.dir)) active = Boolean(owns)
    else if (owns) conflict(`The ${basename(dirname(file))} profile also uses these KBs. Remove its Knowledge package before deleting the shared library.`)
  }
  if (active !== installed) conflict(installed ? 'Knowledge is no longer installed in this profile.' : 'Knowledge was reinstalled during removal. Its data was preserved.')
}

function contains(parent: string, child: string) {
  const path = relative(parent, child)
  return !path || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
}

// Inspect only loader entries and patch rows. A user may have ordinary keys named
// "knowledge" inside another plugin's configuration.
function pruneKnowledgeRows(rows: YAMLSeq): boolean {
  let changed = false
  for (let index = rows.items.length - 1; index >= 0; index--) {
    const row = rows.items[index]
    if (!isMap(row)) continue
    const name = row.get('name')
    const id = row.get('id')
    const insert = row.get('insert')
    if (isSeq(insert)) {
      if (!pruneKnowledgeRows(insert)) continue
      changed = true
      if (!insert.items.length && row.items.length === 1) rows.items.splice(index, 1)
      continue
    }
    if (row.get('group') === true && isSeq(row.get('config'))) {
      if (pruneKnowledgeRows(row.get('config') as YAMLSeq)) changed = true
    } else if (typeof name === 'string' ? name === bundle || name.startsWith(bundle + '/') :
      typeof id === 'string' && ['knowledge', 'tool-knowledge', 'ui-knowledge'].includes(id)) {
      rows.items.splice(index, 1)
      changed = true
    }
  }
  return changed
}

async function profilePatch(profile: UninstallProfile, save: boolean) {
  const file = join(profile.dir, 'cordis.patch.yml')
  const info = await present(file)
  if (!info) return
  const doc = parseDocument(await readFile(file, 'utf8'))
  if (doc.errors.length) conflict('Harness could not read the profile override file.')
  if (!isSeq(doc.contents) || !pruneKnowledgeRows(doc.contents)) return
  if (info.isSymbolicLink()) conflict('Knowledge overrides are in a shared, linked profile configuration. Remove those overrides before uninstalling.')
  if (save) await writeFileAtomic(file, doc.toString({lineWidth:0}), {mode:info.mode & 0o777})
}

async function ownedPaths(profile: UninstallProfile, database: string, sources: string[]) {
  const storage = join(resolve(profile.home), 'storages')
  const db = resolve(database)
  const roots = new Set([storage, dirname(db)])
  const defaults = join(storage, 'knowledge-chunks.sqlite')
  const managedRoots = new Set<string>()
  const files = new Set([join(storage, 'knowledge.json')])
  const paths = new Set([join(storage, 'knowledge-markdown-v1'), join(resolve(profile.home), 'cache', bundle)])
  for (const name of new Set([defaults, db])) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) files.add(name + suffix)
  }
  for (const root of roots) {
    for (const name of ['knowledge-raw', 'knowledge-markdown', 'knowledge-artifacts']) paths.add(join(root, name))
    const pointer = join(root, 'mineru-management.json')
    files.add(pointer)
    if ((await present(pointer))?.isFile()) {
      const { root: managed } = JSON.parse(await readFile(pointer, 'utf8'))
      if (typeof managed === 'string' && isAbsolute(managed) && (await present(join(managed, OWNERSHIP_MARKER)))?.isFile()) {
        await checkOwnedRoot(managed)
        managedRoots.add(resolve(managed))
        for (const name of ['config.yaml', 'deployment.json', 'envs', 'home', 'models', 'staging', 'tmp', '.operation.lock', OWNERSHIP_MARKER]) paths.add(join(managed, name))
      }
    }
  }
  for (const path of files) {
    const info = await present(path)
    if (info && !(info.isFile() || info.isSymbolicLink())) conflict(`Expected a Knowledge data file at ${path}. Its contents were preserved.`)
    if ((path === db || path === defaults) && info?.isSymbolicLink()) conflict('The Knowledge database is linked to a different location. Use a dedicated local database for clean uninstall.')
    paths.add(path)
  }
  const protectedPaths = [resolve(profile.home), resolve(profile.dir), ...sources.map(s => resolve(s))]
  for (const path of [...protectedPaths]) {
    const canonical = await realpath(path).catch(error => { if (!missing(error)) throw error })
    if (canonical && canonical !== path) protectedPaths.push(canonical)
  }
  for (const path of paths) {
    const info = await present(path)
    if (!info) continue
    if (protectedPaths.some(source => contains(path, source))) conflict('A Knowledge storage location contains a linked source or Harness profile. Move that source before uninstalling.')
    // An owned leaf may be a symlink. rm unlinks it; a symlink in a parent would redirect removal.
    for (let parent = dirname(path); parent !== dirname(parent); parent = dirname(parent)) {
      if ((await lstat(parent)).isSymbolicLink()) conflict(`A storage parent is a symbolic link: ${parent}`)
    }
    await access(dirname(path), constants.W_OK)
  }
  if (db !== defaults && (await present(db))?.isFile()) {
    const connection = new DatabaseSync(db, {readOnly:true})
    try {
      const tables = connection.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(r => String(r.name))
      const known = /^(chunk|chunk_meta|chunk_bundles|chunk_fts(?:_(?:data|idx|docsize|content|config))?|knowledge_document(?:_text)?|document_generation_(?:stage|chunk|commit)|sqlite_.*)$/
      if (!tables.includes('chunk') || tables.some(t => !known.test(t))) conflict('The custom SQLite file also contains unrelated data. A dedicated Knowledge database is required for clean uninstall.')
    } finally { connection.close() }
  }
  return {paths, managedRoots}
}

// The host takes this same lock for every Web/CLI package operation. Never hold it
// while calling removeBundle, which acquires it internally.
async function lockManifests<T>(manifests: string[], operation: () => Promise<T>): Promise<T> {
  const [file, ...rest] = manifests
  return file ? withFileLock(file, () => lockManifests(rest, operation), {waitMs:30_000}) : operation()
}

export async function cleanUninstall(profile: UninstallProfile, manager: UninstallManager, database: string, sources: string[], clearMetadata?: () => Promise<void>) {
  const manifests = await profileManifests(profile)
  await checkOwners(profile, manifests, true)
  await profilePatch(profile, false)
  const before = await ownedPaths(profile, database, sources)
  const result = await manager.removeBundle(bundle)
  if (result.application !== 'applied' || result.packageResult?.exitCode !== 0 || result.packageResult.timedOut) {
    conflict(result.error?.diagnostic || `Harness could not unload and remove Knowledge (${result.error?.code ?? result.application}). Its data was preserved.`)
  }
  await lockManifests(await profileManifests(profile), async () => {
    await checkOwners(profile, await profileManifests(profile), false)
    // Revalidate the paths after callbacks from the host's unload operation.
    const current = await ownedPaths(profile, database, sources)
    await profilePatch(profile, true)
    await clearMetadata?.()
    for (const path of current.paths) {
      if (before.paths.has(path)) await rm(path, {recursive:true, force:true, maxRetries:3, retryDelay:100})
    }
    for (const root of current.managedRoots) {
      if (before.managedRoots.has(root)) await rmdir(root).catch(error => {
        if (!missing(error) && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error
      })
    }
  })
  return {uninstalled:true}
}
