import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const shared = vi.hoisted(() => ({ install: vi.fn(), probe: vi.fn(), ready: false }))
vi.mock('../src/host/ocr.js', () => ({
  platformSupported: true, installedBackend: () => shared.ready ? 'ovis' : undefined,
  installOcr: shared.install, verifyOcr: shared.probe,
  OcrWorker: class { constructor(readonly root: string) {} close() {} },
}))
vi.mock('../src/runtime/assets.js', () => ({ models: Object.fromEntries(['embedding','reranker'].map(key =>
  [key,{files:[{path:'model',bytes:1}]}])) }))
vi.mock('../src/host/engine.js', () => ({
  steps: ['Search'],
  Engine: class {
    state = {status:'ready',step:0}
    constructor(readonly root: string) {}
    start() {}
    close() {}
  },
}))
let home: string
let runtime: typeof import('../src/host/local-search.js')
beforeEach(async () => {
  vi.resetModules()
  shared.install.mockReset(); shared.probe.mockReset(); shared.ready = false
  home = await mkdtemp(join(tmpdir(),'knowledge-setup-test-'))
  vi.stubEnv('DSH_HOME',home)
  for (const kind of ['embedding','reranker']) {
    const folder = join(home,'storages','knowledge-markdown-v1','models',kind)
    await mkdir(folder,{recursive:true}); await writeFile(join(folder,'model'),'x')
  }
  runtime = await import('../src/host/local-search.js')
})
afterEach(async () => {
  runtime.closeSearch(); vi.unstubAllEnvs(); await rm(home,{force:true,recursive:true})
})
it('installs once across concurrent requests and applies only the requested bases', async () => {
  let finish!: () => void
  shared.install.mockImplementation(async () => { await new Promise<void>(resolve => {finish=resolve}); shared.ready=true; return 'ovis' })
  const apply = vi.fn(async (_id:string) => {})
  runtime.startDocumentSetup('one',false,apply); runtime.startDocumentSetup('one',false,apply)
  runtime.startDocumentSetup('two',false,apply)
  await vi.waitFor(() => expect(shared.install).toHaveBeenCalledOnce())
  expect(runtime.documentSetupState('unselected',false).status).toBe('new')
  finish()
  await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2))
  expect(apply.mock.calls.flat().sort()).toEqual(['one','two'])
  expect(shared.probe).toHaveBeenCalledOnce()
  expect(runtime.startDocumentSetup('one',true,apply)).toMatchObject({status:'ready',backend:'ovis'})
  expect(runtime.documentSetupState('one',false).status).toBe('new')
})
it('publishes failures without applying config and can retry after a restart', async () => {
  shared.install.mockRejectedValueOnce(Error('Connection interrupted')).mockImplementation(async () => {shared.ready=true; return 'ovis'})
  const apply = vi.fn(async (_id:string) => {})
  runtime.startDocumentSetup('one',false,apply)
  await vi.waitFor(() => expect(runtime.documentSetupState('one',false)).toMatchObject({status:'error',error:'Connection interrupted'}))
  expect(apply).not.toHaveBeenCalled()
  runtime.closeSearch()
  runtime.startDocumentSetup('one',false,apply)
  await vi.waitFor(() => expect(runtime.documentSetupState('one',true).status).toBe('ready'))
  expect(apply).toHaveBeenCalledOnce()
})
