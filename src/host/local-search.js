import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine, steps } from './engine.js';
import { pdfBody } from './pdf.js';
import { askVision, imageMarkdown } from './vision.js';
export { isDocumentVision, visionCatalog } from './vision.js';

export const embeddingId = 'dsh-local/Qwen3-Embedding-0.6B-Portable-FP16';
export const rerankerId = 'Qwen/Qwen3-Reranker-0.6B';
export const defaults = Object.freeze({
  ocrModel: '',
  descriptionModel: '',
  device: 'auto',
  threads: 0,
  unloadSeconds: 120,
  schedule: 'background',
  quietSeconds: 15,
  windowStart: '22:00',
  windowEnd: '07:00',
});

export function settingsPatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Settings must be an object');
  const choices = {
    device: ['auto', 'cpu', 'gpu', 'igpu', 'npu'],
    schedule: ['always', 'background', 'window', 'paused'],
  };
  const limits = { threads: [0, 64], unloadSeconds: [0, 86400], quietSeconds: [0, 3600] };
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key)) throw new Error('Unknown setting ' + key);
    if (choices[key] && !choices[key].includes(value)) throw new Error('Invalid ' + key);
    if (
      limits[key] &&
      (!Number.isInteger(value) || value < limits[key][0] || value > limits[key][1])
    )
      throw new Error('Invalid ' + key);
    if (
      (key === 'windowStart' || key === 'windowEnd') &&
      (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
    )
      throw new Error('Enter a time in HH:MM format');
    if (
      key.endsWith('Model') &&
      (typeof value !== 'string' || value.length > 512 || (value && !/^[^\s/]+\/\S+$/.test(value)))
    )
      throw new Error('Select a registered model');
  }
  return input;
}


// This database holds setup preferences. The original Knowledge service owns every base and document.
const root = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'storages', 'knowledge-markdown-v1');
export function hasSetup() { return existsSync(join(root(), 'library.sqlite')); }
class Preferences {
  constructor() {
    mkdirSync(root(), { recursive: true });
    this.db = new DatabaseSync(join(root(), 'library.sqlite'));
    this.db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  get(key, fallback) {
    const row = this.db.prepare('SELECT value FROM config WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  put(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO config VALUES (?,?)').run(key, JSON.stringify(value));
  }
  settings() {
    return { ...defaults, ...this.get('preferences', {}) };
  }
  configure(patch) {
    this.db
      .prepare(
        "INSERT INTO config(key,value) VALUES('preferences',?) ON CONFLICT(key) DO UPDATE SET value=json_patch(config.value, excluded.value)",
      )
      .run(JSON.stringify(settingsPatch(patch)));
    return this.settings();
  }
}
let current;
function runtime() {
  if (!current) {
    const store = new Preferences();
    current = { store, engine: new Engine(join(root(), 'models'), store) };
  }
  return current;
}
export function setupState() {
  const { engine, store } = runtime();
  return { setup: engine.state, steps, settings: store.settings() };
}
export function startSetup(onReady, force = false) {
  const { engine } = runtime();
  engine.onReady = onReady;
  if (engine.state.status === 'ready' && !force) return Promise.resolve(onReady()).then(setupState);
  engine.start(force);
  return Promise.resolve(setupState());
}
export function resumeSetup(onReady) {
  if (hasSetup() && runtime().engine.state.status === 'running') void startSetup(onReady);
}
export async function configure(ctx, patch, onReady) {
  if (patch.ocrModel || patch.descriptionModel) {
    const { visionCatalog } = await import('./vision.js');
    const { models } = await visionCatalog(ctx);
    for (const id of [patch.ocrModel, patch.descriptionModel].filter(Boolean)) {
      if (!models.some(model => model.id === id)) throw new Error('Select a vision model registered in Harness.');
    }
  }
  const { engine, store } = runtime();
  const before = store.settings();
  const settings = store.configure(patch);
  if (settings.device !== before.device && ['ready','running'].includes(engine.state.status)) await startSetup(onReady, true);
  return setupState();
}
export function closeSearch() {
  if (!current) return;
  const { engine, store } = current;
  current = undefined;
  engine.close();
  if (engine.task) void engine.task.finally(() => store.db.close());
  else store.db.close();
}
export function enterForeground() {
  const engine = current?.engine;
  if (!engine) return () => {};
  engine.foreground++;
  engine.workers.accelerator.stop('Reserved for chat');
  return () => { engine.foreground--; engine.lastChat = Date.now(); };
}
export async function embedPassages(texts, purpose, signal) {
  const { engine } = runtime();
  if (engine.state.status !== 'ready') throw new Error('Finish local search setup in Settings → Local Models.');
  const vectors = [];
  for (const text of texts) {
    while (purpose === 'index' && !engine.canIndex()) {
      if (engine.closed) throw new Error('Knowledge closed');
      await delay(500, undefined, { signal });
    }
    signal?.throwIfAborted();
    vectors.push(await engine.embed(text, purpose === 'query'));
  }
  return vectors;
}
export async function rankPassages(query, texts, signal) {
  const { engine } = runtime();
  const scores = [];
  for (const text of texts) {
    signal.throwIfAborted();
    scores.push(await engine.score(query, text));
  }
  return scores;
}

const imageTypes = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export function markdownTitle(title, text) {
  const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!body.trim() || /^#{1,6}\s/.test(body)) return body;
  return '# ' + title.replace(/[\r\n]+/g, ' ').replace(/([\\*_\[\]#<>])/g, '\\$1') + '\n\n' + body;
}
export function visionFingerprint() {
  if (!hasSetup()) return '';
  const { ocrModel, descriptionModel } = runtime().store.settings();
  return JSON.stringify([ocrModel, descriptionModel]);
}
export async function readVisual(ctx, bytes, name, kind, signal = new AbortController().signal) {
  const settings = runtime().store.settings();
  if (kind === 'pdf' && !settings.ocrModel && !settings.descriptionModel) return;
  const ask = (model, role, image, cancellation) => askVision(ctx, model, role, image, cancellation);
  const imageType = imageTypes[kind];
  if (imageType) return markdownTitle(name, await imageMarkdown({ bytes, name, mime: imageType }, '', true, settings, ask, signal));
  if (kind === 'pdf') return markdownTitle(name, await pdfBody({ source: bytes }, settings, ask, signal, () => {}));
}
