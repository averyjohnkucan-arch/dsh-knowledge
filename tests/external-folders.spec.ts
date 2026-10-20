import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { knowledgeDomainSpec } from '../src/knowledge/domain.js'
import { externalFile, ExternalFolders } from '../src/knowledge/external-folders.js'

describe('external source boundary and recovery', () => {
  it('rejects originals outside the root, including symlink escapes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kb-root-')), other = await mkdtemp(join(tmpdir(), 'kb-other-'))
    try {
      await writeFile(join(other, 'private.txt'), 'private')
      await expect(externalFile(dir, join(other, 'private.txt'))).rejects.toThrow(/outside/)
      if (process.platform !== 'win32') {
        await symlink(join(other, 'private.txt'), join(dir, 'escape.txt'))
        await expect(externalFile(dir, join(dir, 'escape.txt'))).rejects.toThrow(/outside/)
      }
    } finally { await rm(dir, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }) }
  })
  it('reconciles again when a new coordinator is created over saved sources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kb-restart-')); let calls = 0
    const sources = [{ id: 'persistent', path: dir, intervalMs: 60000, enabled: true }]
    try {
      const first = new ExternalFolders(() => sources, async () => { calls++ })
      await first.tick(); first.stop()
      const reopened = new ExternalFolders(() => sources, async () => { calls++ })
      await reopened.tick(); reopened.stop()
      expect(calls).toBe(2)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})


it('preserves external mode and sync settings through the durable schema boundary', () => {
  const base = { id: 'b', name: 'external', description: '', createdAt: 1, updatedAt: 1,
    storageMode: 'external' as const, externalPath: '/example/source', syncEnabled: false, syncIntervalSeconds: 30 }
  expect(knowledgeDomainSpec.tables.bases.valueSchema.parse(JSON.parse(JSON.stringify(base)))).toEqual(base)
})

it('receives real filesystem notifications before the periodic scan is due', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kb-notify-')); let calls = 0
  const coordinator = new ExternalFolders(() => [{ id: 'watch', path: root, intervalMs: 60000, enabled: true }], async () => { calls++ })
  try {
    await coordinator.tick()
    await writeFile(join(root, 'new.txt'), 'new file event')
    const deadline = Date.now() + 3000
    while (calls < 2 && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 20)); await coordinator.tick() }
    expect(calls).toBeGreaterThanOrEqual(2)
  } finally { coordinator.stop(); await rm(root, { recursive: true, force: true }) }
})
