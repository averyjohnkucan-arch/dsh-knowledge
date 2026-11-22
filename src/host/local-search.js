import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine, steps } from './engine.js';
import { OcrWorker, installOcr, installedBackend, platformSupported, verifyOcr } from './ocr.js';
import { models } from '../runtime/assets.js';
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
    current = { store, engine: new Engine(join(root(), 'models'), store),
      ocr: new OcrWorker(join(root(), 'ocr')), jobs: new Map(), controller: new AbortController() };
  }
  return current;
}
export function setupState() {
  const { engine, store } = runtime();
  return { setup: engine.state, steps, settings: store.settings() };
}
export function startSetup(onReady, force = false) {
  const { engine } = runtime();
  runtime().store.put('searchScope', 'global');
  engine.onReady = onReady;
  if (engine.state.status === 'ready' && !force) return Promise.resolve(onReady()).then(setupState);
  engine.start(force);
  return Promise.resolve(setupState());
}
export function resumeSetup(onReady) {
  if (hasSetup() && runtime().engine.state.status === 'running' && runtime().store.get('searchScope', 'global') === 'global') void startSetup(onReady);
}
function searchAssetsPresent(engine) {
  return ['embedding', 'reranker'].every(kind => models[kind].files.every(asset => {
    try { return statSync(join(engine.root, kind, asset.path)).size === asset.bytes; }
    catch { return false; }
  }));
}

export function documentSetupState(id, configured) {
  const rt = runtime();
  const saved = rt.store.get('document:' + id, { status: 'new' });
  const { engine } = rt;
  if (saved.status === 'running') {
    const checkingSearch = rt.stage === 'search';
    return { status: 'running', supported: platformSupported, stage: checkingSearch ? steps[engine.state.step] : rt.stage || 'Preparing local models',
      ...(checkingSearch && engine.state.progress ? { progress: engine.state.progress } : {}) };
  }
  if (saved.status === 'ready' && (!configured || !installedBackend(rt.ocr.root) || !searchAssetsPresent(engine)))
    return { status: 'new', supported: platformSupported };
  return { ...saved, supported: platformSupported };
}

async function ensureAssets(rt) {
  const signal = rt.controller.signal;
  const engine = rt.engine;
  const stage = message => { rt.stage = message; };
  stage('Checking local OCR support');
  if (!platformSupported) throw new Error('Local OvisOCR2 currently supports Linux x86-64.');
  stage('search');
  if (!engine.task) { rt.store.put('searchScope', 'base'); engine.onReady = () => {}; }
  engine.start(engine.state.status === 'ready' && !searchAssetsPresent(engine));
  await engine.task;
  signal.throwIfAborted();
  if (engine.state.status !== 'ready') throw new Error(engine.state.error || 'Local search setup failed.');
  const backend = await installOcr(rt.ocr.root, stage, signal);
  stage('Testing OvisOCR2 on a scanned image');
  await verifyOcr(rt.ocr, backend, signal);
  return backend;
}

export function startDocumentSetup(id, configured, apply) {
  const rt = runtime();
  if (!rt.jobs.has(id) && documentSetupState(id, configured).status !== 'ready') {
    const key = 'document:' + id;
    rt.store.put(key, { status: 'running' });
    rt.assets ||= ensureAssets(rt).finally(() => { rt.assets = undefined; });
    const job = rt.assets.then(async backend => {
      rt.controller.signal.throwIfAborted();
      await apply(id);
      rt.store.put(key, { status: 'ready', backend });
    }).catch(error => {
      if (!rt.controller.signal.aborted) rt.store.put(key, { status: 'error', error: String(error.message || error).slice(0, 600) });
    }).finally(() => rt.jobs.delete(id));
    rt.jobs.set(id, job);
  }
  return documentSetupState(id, configured);
}
export function resumeDocumentSetup(apply) {
  if (!hasSetup()) return;
  const rt = runtime();
  for (const { key } of rt.store.db.prepare("SELECT key FROM config WHERE key LIKE 'document:%'").all()) {
    if (rt.store.get(key, {}).status === 'running') startDocumentSetup(key.slice(9), false, apply);
  }
}
export function readOcr(bytes, suffix, signal, timeout) {
  return runtime().ocr.convert(bytes, suffix, signal, timeout);
}
export function ocrIdentity() {
  return 'ovis-ocr2-v1/' + (installedBackend(join(root(), 'ocr')) || 'uninstalled');
}

export async function configure(ctx, patch, onReady) {
  if (patch.ocrModel || patch.descriptionModel) {
    const { visionCatalog } = await import('./vision.js');
    const { models } = await visionCatalog(ctx);
    for (const id of [patch.ocrModel, patch.descriptionModel].filter(Boolean)) {
      if (!models.some(model => model.id === id && model.acceptsImages !== false)) throw new Error('Select a vision model registered in Harness.');
    }
  }
  const { engine, store } = runtime();
  const before = store.settings();
  const settings = store.configure(patch);
  if (settings.device !== before.device && ['ready','running'].includes(engine.state.status)) await startSetup(onReady, true);
  return setupState();
}
export async function closeSearch() {
  if (!current) return;
  const { engine, store, jobs, ocr, controller } = current;
  current = undefined;
  controller.abort();
  ocr.close();
  engine.close();
  if (engine.task || jobs.size) await Promise.allSettled([engine.task, ...jobs.values()]);
  store.db.close();
}
export function enterForeground() {
  const engine = current?.engine;
  if (!engine) return () => {};
  engine.foreground++;
  if (!current.ocr.pending) current.ocr.stop();
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
