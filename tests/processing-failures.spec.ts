import { describe, expect, it } from 'vitest'
import { ProcessingMeter } from '../src/knowledge/processing-meter.js'
describe('processing failure details', () => {
  it('keeps document identity and reason after completion without retaining content', () => {
    const meter = new ProcessingMeter()
    meter.start('run', 'base'); meter.add('run', 2)
    meter.begin('run'); meter.settle('run', 'failed', { documentId: 'doc', title: 'article.md', code: 'parse_failed', message: 'Invalid document' })
    meter.begin('run'); meter.settle('run', 'skipped'); meter.finish('run')
    const snapshot = meter.snapshots()[0]
    expect(snapshot).toMatchObject({ failed: 1, completed: 2, active: false, failures: [{ documentId: 'doc', title: 'article.md', code: 'parse_failed', message: 'Invalid document' }] })
    snapshot.failures![0].message = 'changed'
    expect(meter.snapshots()[0].failures![0].message).toBe('Invalid document')
  })
  it('bounds failure metadata while preserving the full failure count', () => {
    const meter = new ProcessingMeter(); meter.start('run', 'base')
    for (let i = 0; i < 1005; i++) meter.settle('run', 'failed', { title: 'x'.repeat(2000), message: 'y'.repeat(5000) })
    const snapshot = meter.snapshots()[0]
    expect(snapshot.failed).toBe(1005); expect(snapshot.failures).toHaveLength(1000)
    expect(snapshot.failures![0].title).toHaveLength(1024); expect(snapshot.failures![0].message).toHaveLength(4000)
  })
})
