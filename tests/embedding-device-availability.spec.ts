import { describe, expect, it } from 'vitest'
import { foreignNvidiaGraphics, intelActivityAvailable, parseIntelActivity, nvidiaMemorySufficient } from '../src/knowledge/embedding-device-availability.js'
describe('embedding GPU availability', () => {
  it('requires launch headroom without evicting its own already resident workers', () => {
    expect(nvidiaMemorySufficient(3000,false)).toBe(false)
    expect(nvidiaMemorySufficient(5000,false)).toBe(true)
    expect(nvidiaMemorySufficient(3000,true)).toBe(true)
    expect(nvidiaMemorySufficient(500,true)).toBe(false)
    expect(nvidiaMemorySufficient(Number.NaN,true)).toBe(false)
  })
  it('reads Intel engine usage without counting the same client twice', () => {
    expect(parseIntelActivity('drm-driver: i915\ndrm-client-id: 7\ndrm-engine-render: 100 ns\ndrm-engine-compute: 20 ns\ndrm-engine-video: 30 ns\n')).toEqual({client:'7',nanoseconds:150})
    expect(parseIntelActivity('drm-driver: nvidia\ndrm-client-id: 7\n')).toBeUndefined()
  })
  it('withdraws when another application needs Intel GPU capacity', () => {
    expect(intelActivityAvailable(100,100+4e7,1000)).toBe(true)
    expect(intelActivityAvailable(100,100+6e7,1000)).toBe(false)
    expect(intelActivityAvailable(100,50,1000)).toBe(false)
  })
  it('ignores its own GPU jobs and an idle compositor, but yields to applications', () => {
    const idle='0 2993 G - - - - - - gnome-shell\n0 1234 C 90 40 0 0 0 0 python'
    expect(foreignNvidiaGraphics(idle,new Set([1234]))).toBe(false)
    expect(foreignNvidiaGraphics(idle,new Set())).toBe(true)
    expect(foreignNvidiaGraphics('0 5555 G - - - - - - game',new Set())).toBe(true)
    expect(foreignNvidiaGraphics('0 2993 G 20 - - - - - gnome-shell',new Set())).toBe(true)
  })
})
