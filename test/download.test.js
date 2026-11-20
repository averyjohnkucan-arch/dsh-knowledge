import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installModel, models } from '../src/runtime/assets.js';

test('a retry uses verified downloads, discards corrupt bytes and reports the full size', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'knowledge-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = [
    ['a.bin', 'first'],
    ['b.bin', 'second'],
  ];
  models.fixture = {
    repo: 'example/fixture',
    revision: 'test',
    files: fixture.map(([path, body]) => ({
      path,
      bytes: Buffer.byteLength(body),
      sha256: createHash('sha256').update(body).digest('hex'),
    })),
  };
  t.after(() => {
    delete models.fixture;
  });
  const requests = [];
  let corrupt = true;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const [file, body] = fixture.find(([name]) => url.endsWith('/' + name));
    requests.push(file);
    return new Response(file === 'b.bin' && corrupt ? 'broken' : body);
  });
  const signal = new AbortController().signal,
    progress = [];
  const install = () => installModel(directory, 'fixture', (step) => progress.push(step), signal);
  await assert.rejects(install(), /Checksum mismatch/);
  assert.deepEqual(await readdir(join(directory, 'fixture')), ['a.bin']);
  corrupt = false;
  await install();
  await install();
  assert.deepEqual(requests, ['a.bin', 'b.bin', 'b.bin']);
  assert.equal(await readFile(join(directory, 'fixture', 'b.bin'), 'utf8'), 'second');
  assert.deepEqual(progress.at(-1), { file: 'b.bin', received: 11, total: 11 });
});
