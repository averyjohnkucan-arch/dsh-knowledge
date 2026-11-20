// Optional release check. Exercises both pinned exports on CPU using the same
// downloader, validation and inference workers that the setup button uses.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Library } from '../src/host/library.js';

const directory = process.argv[2]
  ? resolve(process.argv[2])
  : await mkdtemp(join(tmpdir(), 'knowledge-smoke-'));
const app = new Library(directory, { get: () => undefined });
try {
  await app.configure({ device: 'cpu', schedule: 'always' });
  app.engine.start();
  await app.engine.task;
  assert.equal(app.engine.state.status, 'ready', app.engine.state.error);
  const { id } = app.add(
    'Verification',
    'txt',
    Buffer.from('The practice telescope was named Sapphire Lantern.'),
  );
  await app.job;
  app.wake();
  await app.job;
  assert.match(app.store.markdown(id).markdown, /# Verification/);
  const hits = await app.search('What was the telescope called?');
  assert.equal(hits[0].document, id);
  console.log('Verified CPU embedding, Qwen reranking, Markdown export and search.');
} finally {
  await app.close();
}
