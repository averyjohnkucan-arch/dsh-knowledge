import { describe, expect, it } from 'vitest'
import { ProcessingMeter } from '../src/knowledge/processing-meter.js'

describe('document progress and rolling ETA', () => {
  it('counts queued, running, processed, unchanged and failed separately', () => {
    let now = 0
    const meter = new ProcessingMeter(() => now)
    meter.start('root', 'base', true); meter.add('root', 10)
    meter.begin('root'); meter.begin('root')
    now = 10_000; meter.settle('root', 'processed'); meter.settle('root', 'skipped')
    expect(meter.snapshots()[0]).toMatchObject({ total: 10, completed: 2, queued: 8, processed: 1, skipped: 1, etaSeconds: null })
    meter.discovered('root')
    expect(meter.snapshots()[0].etaSeconds).toBeNull() // unchanged checks do not inflate processing speed
    meter.begin('root'); meter.settle('root', 'failed')
    expect(meter.snapshots()[0]).toMatchObject({ completed: 3, failed: 1, running: 0, queued: 7, etaSeconds: 35 })
  })
  it('expires old samples instead of showing a stale ETA after a stall', () => {
    let now = 0
    const meter = new ProcessingMeter(() => now)
    meter.start('root', 'base'); meter.add('root', 100)
    now = 30_000
    meter.settle('root', 'processed'); meter.settle('root', 'processed')
    expect(meter.snapshots()[0].etaSeconds).toBe(1470)
    now = 151_000
    expect(meter.snapshots()[0]).toMatchObject({ etaSeconds: null, perMinute: null })
    meter.settle('root', 'processed'); meter.settle('root', 'processed')
    expect(meter.snapshots()[0].perMinute).toBe(1)
  })
  it('does not report canceled remaining work as completed or queued', () => {
    const meter = new ProcessingMeter(() => 100_000)
    meter.start('root', 'base'); meter.add('root', 20); meter.begin('root')
    meter.settle('root', 'processed'); meter.finish('root')
    expect(meter.snapshots()[0]).toMatchObject({ total: 20, completed: 1, active: false, queued: 0, etaSeconds: null })
    meter.start('root', 'base')
    expect(meter.snapshots()[0]).toMatchObject({ total: 0, completed: 0, active: true })
  })
})
