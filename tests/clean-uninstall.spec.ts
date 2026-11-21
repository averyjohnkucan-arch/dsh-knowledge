import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { cleanUninstall, type UninstallManager, type UninstallProfile } from '../src/knowledge/clean-uninstall.js'

describe('Knowledge clean uninstall', () => {
  let home: string, profile: UninstallProfile, database: string, manifest: string
  const installed = {dependencies:{'dsh-knowledge':'1.3.1', other:'1'},dsh:{profile:{bundles:['dsh-knowledge','other']}}}
  const removed = {dependencies:{other:'1'},dsh:{profile:{bundles:['other']}}}

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'kb-uninstall-test-'))
    profile = {home, dir:join(home, 'profiles', 'web'), name:'web'}
    database = join(home, 'storages', 'knowledge-chunks.sqlite')
    manifest = join(profile.dir, 'package.json')
    await mkdir(dirname(database), {recursive:true})
    await mkdir(profile.dir, {recursive:true})
    await writeFile(manifest, JSON.stringify(installed))
    await writeFile(database, 'old index')
  })
  afterEach(async () => { await rm(home, {recursive:true,force:true}) })

  function manager(): UninstallManager {
    return {removeBundle:vi.fn(async () => {
      await writeFile(manifest, JSON.stringify(removed))
      return {application:'applied',packageResult:{exitCode:0}}
    })}
  }

  it('removes local data and scoped profile overrides while preserving source files and unrelated settings', async () => {
    const raw = join(home, 'storages', 'knowledge-raw'), sources = join(home, 'sources')
    await mkdir(raw); await mkdir(sources)
    await writeFile(join(sources, 'original.txt'), 'original')
    await symlink(sources, join(raw, 'inside'), 'dir')
    const patch = join(profile.dir, 'cordis.patch.yml')
    await writeFile(patch, '- id: knowledge\n  config: {chunkSize: 901}\n- insert:\n  - {id: custom, name: dsh-knowledge/knowledge}\n  - {id: search, name: other}\n- id: another\n  config: {knowledge: keep}\n')
    const backend = manager()
    await cleanUninstall(profile, backend, database, [sources])
    expect(backend.removeBundle).toHaveBeenCalledWith('dsh-knowledge')
    expect(existsSync(database) || existsSync(raw)).toBe(false)
    expect(await readFile(join(sources, 'original.txt'),'utf8')).toBe('original')
    expect(parse(await readFile(patch, 'utf8'))).toEqual([{insert:[{id:'search',name:'other'}]}, {id:'another',config:{knowledge:'keep'}}])
  })

  it('leaves the library on a failed package operation or a concurrent reinstall', async () => {
    const refused = {removeBundle:vi.fn(async () => ({application:'failed',error:{code:'stop-profile'}}))}
    await expect(cleanUninstall(profile, refused, database, [])).rejects.toThrow('stop-profile')
    const raced = {removeBundle:vi.fn(async () => ({application:'applied',packageResult:{exitCode:0}}))}
    await expect(cleanUninstall(profile, raced, database, [])).rejects.toThrow('reinstalled')
    expect(await readFile(database,'utf8')).toBe('old index')
  })

  it('refuses before uninstall when another profile, including a disabled installation, owns the data', async () => {
    const sibling = join(home, 'profiles', 'office')
    await mkdir(sibling); await writeFile(join(sibling,'package.json'), JSON.stringify({dependencies:installed.dependencies}))
    const backend = manager()
    await expect(cleanUninstall(profile, backend, database, [])).rejects.toThrow('office')
    expect(backend.removeBundle).not.toHaveBeenCalled()
  })

  it('protects nested source folders and storage paths with redirected parents', async () => {
    const raw = join(home,'storages','knowledge-raw'), source = join(raw,'originals')
    await mkdir(source,{recursive:true})
    const backend = manager()
    await expect(cleanUninstall(profile, backend, database, [source])).rejects.toThrow('linked source')
    const shared = join(home,'shared'); await mkdir(join(shared,'dsh-knowledge'),{recursive:true}); await symlink(shared,join(home,'cache'),'dir')
    await expect(cleanUninstall(profile, backend, database, [])).rejects.toThrow('symbolic link')
    expect(backend.removeBundle).not.toHaveBeenCalled()
  })

  it('refuses a custom database path that actually names a directory', async () => {
    const unrelated = join(home,'my-documents')
    await mkdir(unrelated)
    await writeFile(join(unrelated,'original'),'keep')
    const backend = manager()
    await expect(cleanUninstall(profile, backend, unrelated, [])).rejects.toThrow('Expected a Knowledge data file')
    expect(backend.removeBundle).not.toHaveBeenCalled()
    expect(await readFile(join(unrelated,'original'),'utf8')).toBe('keep')
  })

  it('cleans verified managed installations while preserving unrelated material alongside them', async () => {
    const root = join(home,'mineru'), options = join(home,'storages','mineru-management.json')
    await mkdir(join(root,'envs'),{recursive:true})
    await writeFile(options, JSON.stringify({root}))
    await writeFile(join(root,'.dsh-mineru-managed.json'),JSON.stringify({owner:'dsh-knowledge/mineru',schemaVersion:1,root}))
    await writeFile(join(root,'keep.txt'),'user file')
    await cleanUninstall(profile, manager(), database, [])
    expect(existsSync(join(root,'envs')) || existsSync(options)).toBe(false)
    expect(await readFile(join(root,'keep.txt'),'utf8')).toBe('user file')
  })
})
