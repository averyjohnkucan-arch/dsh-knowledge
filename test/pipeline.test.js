import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMarkdown, passageRanges } from '../src/host/markdown.js';
import { Store, defaults, settingsPatch } from '../src/host/store.js';
import { visionCatalog, askVision } from '../src/host/vision.js';
import { Library } from '../src/host/library.js';

const signal = new AbortController().signal;
async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const unit = (i) => Array.from({ length: 1024 }, (_, j) => Number(i === j));

test('plain text becomes Markdown and an existing Markdown document preserves its structure', async () => {
  const doc = {
    title: 'Field notes',
    kind: 'txt',
    source: Buffer.from('First line\r\n\r\nSecond line'),
  };
  const noVision = () => assert.fail('Text must not call a vision model');
  const md = await toMarkdown(doc, defaults, noVision, signal);
  assert.equal(md, '# Field notes\n\nFirst line\n\nSecond line\n');
  const original = '# Results\n\n    indented code\n\n- item\n';
  assert.equal(
    await toMarkdown(
      { ...doc, kind: 'md', source: Buffer.from(original) },
      defaults,
      noVision,
      signal,
    ),
    original,
  );
  const long = original + '🪐'.repeat(1700);
  const spans = passageRanges(long);
  assert.equal(spans.map((p) => long.slice(p.start, p.end)).join(''), long);
  for (const p of spans) assert.ok(long.slice(p.start, p.end).isWellFormed());
});

test('a scan uses the two selected routes and both outputs reach the same Markdown', async () => {
  const calls = [];
  const ask = async (model, role, image) => {
    calls.push([model, role, image.mime]);
    return role === 'ocr'
      ? '| Year | Rainfall |\n|---|---|\n| 2025 | 42 mm |'
      : 'The blue bar shows 42 mm of rain.';
  };
  const doc = { title: 'Rainfall.png', kind: 'png', source: Buffer.from([137, 80, 78, 71]) };
  const md = await toMarkdown(
    doc,
    { ...defaults, ocrModel: 'local/ocr', descriptionModel: 'remote/vision' },
    ask,
    signal,
  );
  assert.deepEqual(calls, [
    ['local/ocr', 'ocr', 'image/png'],
    ['remote/vision', 'description', 'image/png'],
  ]);
  assert.match(md, /\| 2025 \| 42 mm \|/);
  assert.match(md, /### Image and chart description\n\nThe blue bar/);
  await assert.rejects(toMarkdown(doc, defaults, ask, signal), /Select one/);
});

test('catalog omits text-only routes and isolates an unavailable provider', async () => {
  const ctx = {
    get: () => ({
      listProviders: () => [{ id: 'a' }, { id: 'b' }],
      listModels: async (id) => {
        if (id === 'b') throw Error('Offline');
        return [
          { id: 'vision/v2', name: 'Vision', inputModalities: ['text', 'image'] },
          { id: 'chat', inputModalities: ['text'] },
          { id: 'legacy' },
        ];
      },
    }),
  };
  const catalog = await visionCatalog(ctx);
  assert.deepEqual(
    catalog.models.map((m) => [m.id, m.verified]),
    [
      ['a/legacy', false],
      ['a/vision/v2', true],
    ],
  );
  assert.deepEqual(catalog.unavailable, ['b']);
});

test('Harness receives the selected provider, full slash-delimited model id, image and task prompt', async () => {
  let sent;
  const ctx = {
    get: (name) =>
      name === 'attachments'
        ? { saveImage: async () => ({ id: 'image' }) }
        : {
            async *stream(args) {
              sent = args;
              yield { type: 'text-delta', text: 'captured text' };
              yield { type: 'finish', reason: { kind: 'stop' } };
            },
          },
  };
  assert.equal(
    await askVision(
      ctx,
      'provider/family/model',
      'ocr',
      { bytes: new Uint8Array(), mime: 'image/png', name: 'scan.png' },
      signal,
    ),
    'captured text',
  );
  assert.equal(sent.provider, 'provider');
  assert.equal(sent.model, 'family/model');
  assert.match(sent.messages[0].content[0].text, /Transcribe/);
  assert.equal(sent.messages[0].content[1].attachment.id, 'image');
});

test('publication hides partial vectors, retains Markdown and safely resumes from a checkpoint', async (t) => {
  const dir = await temporary(t);
  let store = new Store(dir);
  const doc = store.add('Rain', 'txt', Buffer.from('rainfall')),
    md = '# Rain\n\nForty-two mm.\n';
  assert.equal(store.add('Rain', 'txt', Buffer.from('rainfall')).id, doc.id);
  store.saveMarkdown(doc.id, md);
  store.saveVector(doc.id, 0, 0, md.length, unit(0));
  assert.equal(store.candidates(unit(0)).length, 0);
  store.close();
  store = new Store(dir);
  t.after(() => store.close());
  assert.equal(store.saved(doc.id), 1);
  store.finish(doc.id);
  assert.equal(store.candidates(unit(0))[0].text, md);
  assert.equal(store.markdown(doc.id).markdown, md);
});

test('import and retrieval consume the same canonical Markdown and reuse saved chunks after restart', async (t) => {
  const library = new Library(await temporary(t), { get: () => undefined });
  t.after(() => library.close());
  const inputs = [];
  library.engine.state.status = 'ready';
  library.engine.embed = async (text, query) => {
    if (!query) inputs.push(text);
    return unit(0);
  };
  library.engine.score = async () => 0.9;
  library.store.configure({ schedule: 'paused' });
  const { id } = library.add('Notes', 'txt', Buffer.from('Rainfall increased to 42 mm.'));
  assert.equal(library.store.next().status, 'queued');
  await library.configure({ schedule: 'always' });
  await library.job;
  const markdown = library.store.markdown(id).markdown;
  assert.deepEqual(inputs, [markdown]);
  assert.equal(library.store.list()[0].status, 'ready');
  const hits = await library.search('rainfall');
  assert.equal(hits[0].text, markdown);
  assert.equal(hits[0].relevance, 0.9);
});

test('advanced preferences reject invalid numeric limits and unknown devices', () => {
  assert.throws(() => settingsPatch({ device: 'imaginary' }), /Invalid device/);
  assert.throws(() => settingsPatch({ quietSeconds: -1 }), /quietSeconds/);
  assert.throws(() => settingsPatch({ threads: 100 }), /threads/);
  assert.deepEqual(
    settingsPatch({ device: 'npu', threads: 2, unloadSeconds: 0, schedule: 'background' }),
    { device: 'npu', threads: 2, unloadSeconds: 0, schedule: 'background' },
  );
});

test('two profiles can share a library without sending the same document to OCR twice', async (t) => {
  const directory = await temporary(t);
  const first = new Store(directory),
    second = new Store(directory);
  t.after(() => {
    first.close();
    second.close();
  });
  first.add('Queued', 'txt', Buffer.from('Pending work'));
  let done;
  const active = first.withIndexer(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  let visited = 0;
  await second.withIndexer(() => visited++);
  assert.equal(visited, 0);
  done();
  await active;
  await second.withIndexer(() => visited++);
  assert.equal(visited, 1);
});
