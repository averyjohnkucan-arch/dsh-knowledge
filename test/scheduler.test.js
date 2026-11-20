import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/host/engine.js';
import { ModelProcess } from '../src/runtime/process.js';
import { defaults, settingsPatch } from '../src/host/store.js';

test('local-time windows handle midnight and yield to foreground chat', () => {
  const p = { ...defaults, schedule: 'window', windowStart: '22:00', windowEnd: '07:00' };
  const engine = new Engine('', { get: (_, fallback) => fallback, settings: () => p });
  const time = (hours, minutes = 0) => new Date(2026, 6, 1, hours, minutes);
  assert.equal(engine.canIndex(time(21, 59)), false);
  assert.equal(engine.canIndex(time(22)), true);
  assert.equal(engine.canIndex(time(6, 59)), true);
  assert.equal(engine.canIndex(time(7)), false);
  p.windowStart = '09:00';
  p.windowEnd = '18:00';
  assert.equal(engine.canIndex(time(9)), true);
  assert.equal(engine.canIndex(time(18)), false);
  engine.foreground = 1;
  assert.equal(engine.canIndex(time(13)), false);
  engine.foreground = 0;
  engine.lastChat = time(13).getTime();
  assert.equal(engine.canIndex(time(13)), false);
  assert.equal(engine.canIndex(time(13, 1)), true);
  p.schedule = 'paused';
  assert.equal(engine.canIndex(time(13, 1)), false);
  p.schedule = 'always';
  engine.foreground = 1;
  assert.equal(engine.canIndex(time(13)), true);
  assert.throws(() => settingsPatch({ windowStart: '27:15' }), /time/);
  engine.close();
});

test('a worker that closes before a queued request starts never forks a new process', async () => {
  const worker = new ModelProcess();
  const pending = worker.call('devices');
  worker.close();
  await assert.rejects(pending, /shutting down/);
  await assert.rejects(worker.call('devices'), /shutting down/);
});
