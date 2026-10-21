import { afterEach, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { PdfParserPool } from '../src/knowledge/pdf-parser-pool.js'
const pools: PdfParserPool[] = []
const fixture = fileURLToPath(new URL('./fixtures/pdf-parser-pool.mjs', import.meta.url))
function pool(timeout = 2000) { const value = new PdfParserPool(2, fixture, timeout); pools.push(value); return value }
afterEach(async () => { await Promise.all(pools.splice(0).map(value => value.dispose())) })
describe('independent PDF parser lanes', () => {
  it('parses concurrently without transferring away the caller’s input', async () => {
    const value = pool(), bytes = Buffer.from('slow')
    const slow = value.parse(bytes), fast = value.parse(Buffer.from('fast'))
    expect(await fast).toEqual({text:'fast', pages:undefined, scanned:undefined})
    expect((await slow).text).toBe('slow'); expect(bytes.toString()).toBe('slow')
  })
  it('contains a native failure to its lane and starts a replacement', async () => {
    const value = pool(), slow = value.parse(Buffer.from('slow'))
    await expect(value.parse(Buffer.from('crash'))).rejects.toThrow('exited')
    expect((await slow).text).toBe('slow')
    expect((await value.parse(Buffer.from('recovered'))).text).toBe('recovered')
  })
  it('bounds a stalled request and releases workers on plugin unload', async () => {
    const value = pool(250)
    await expect(value.parse(Buffer.from('hang'))).rejects.toThrow('timed out')
    const active = value.parse(Buffer.from('hang'))
    const rejected = expect(active).rejects.toMatchObject({code:'plugin_stopped'})
    await value.dispose(); await rejected
    await expect(value.parse(Buffer.from('late'))).rejects.toMatchObject({code:'plugin_stopped'})
  })
})
