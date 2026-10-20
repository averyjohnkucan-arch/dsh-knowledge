import { describe, it, expect } from 'vitest'
import { decideMainGpu, ResourcePolicy } from '../src/knowledge/resource-policy.js'
const idle = { enabled: true, foreground: false, idleSeconds: 600, idleAfterSeconds: 300, externalCompute: false, freeMiB: 20000 }
describe('main GPU is reserved for active use', () => {
  it('permits idle work only with complete positive evidence', () => {
    expect(decideMainGpu(idle).allowed).toBe(true)
    for (const override of [{ enabled: false }, { foreground: true }, { idleSeconds: null }, { idleSeconds: 10 }, { externalCompute: true }, { freeMiB: 1000 }]) expect(decideMainGpu({ ...idle, ...override }).allowed).toBe(false)
  })
  it('waits for owned workers to release before foreground work proceeds', async () => {
    const policy = new ResourcePolicy(); let unblock!: () => void, stopped = false, entered = false
    policy.register({ pid: () => 123, stop: () => new Promise<void>(resolve => { unblock = () => { stopped = true; resolve() } }) })
    const pending = policy.enterForeground().then(release => { entered = true; return release })
    await Promise.resolve(); expect(entered).toBe(false)
    unblock(); const release = await pending
    expect(stopped).toBe(true); expect(entered).toBe(true); release(); release()
  })
})
