import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { vectorFormat } from '../runtime/assets.js';

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

export class Store {
  constructor(root) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(join(root, 'library.sqlite'));
    // Independent profiles may share this Harness home. A separate SQLite
    // writer lock reserves OCR and indexing without blocking reads or imports.
    // The OS releases the lock immediately if a host exits mid-document.
    this.indexLock = new DatabaseSync(join(root, 'indexer.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    this.db.exec(
      [
        'CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, source BLOB, digest TEXT NOT NULL UNIQUE, markdown TEXT, status TEXT NOT NULL, error TEXT, created INTEGER NOT NULL)',
        'CREATE TABLE IF NOT EXISTS chunks (document TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL, space TEXT NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(document,ordinal))',
      ].join(';'),
    );
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
  add(title, kind, bytes) {
    const digest = createHash('sha256')
      .update(kind)
      .update('\0')
      .update(title)
      .update('\0')
      .update(bytes)
      .digest('hex');
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO documents(id,title,kind,source,digest,status,created) VALUES(?,?,?,?,?,'queued',?)",
      )
      .run(id, title, kind, bytes, digest, Date.now());
    return this.db.prepare('SELECT id,status FROM documents WHERE digest=?').get(digest);
  }
  list() {
    return this.db
      .prepare(
        'SELECT id,title,status,error,created,markdown IS NOT NULL AS hasMarkdown,(SELECT COUNT(*) FROM chunks WHERE document=d.id) AS passages FROM documents d ORDER BY created DESC',
      )
      .all();
  }
  async withIndexer(run) {
    const queued = this.db
      .prepare("SELECT 1 FROM documents WHERE status IN ('queued','reading','indexing') LIMIT 1")
      .get();
    if (!queued) return;
    try {
      this.indexLock.exec('BEGIN IMMEDIATE');
    } catch (error) {
      if (error.errcode === 5 || error.errcode === 6) return;
      throw error;
    }
    try {
      return await run();
    } finally {
      this.indexLock.exec('ROLLBACK');
    }
  }
  next() {
    return this.db
      .prepare(
        "SELECT * FROM documents WHERE status IN ('queued','reading','indexing') ORDER BY created LIMIT 1",
      )
      .get();
  }
  mark(id, status, error = null) {
    this.db.prepare('UPDATE documents SET status=?,error=? WHERE id=?').run(status, error, id);
  }
  markdown(id) {
    return this.db.prepare('SELECT title,markdown FROM documents WHERE id=?').get(id);
  }
  saveMarkdown(id, text) {
    this.db
      .prepare("UPDATE documents SET markdown=?,status='indexing',error=NULL WHERE id=?")
      .run(text, id);
  }
  saved(id) {
    return this.db
      .prepare('SELECT COUNT(*) AS n FROM chunks WHERE document=? AND space=?')
      .get(id, vectorFormat).n;
  }
  saveVector(id, ordinal, start, end, numbers) {
    if (numbers.length !== 1024 || !numbers.every(Number.isFinite))
      throw new Error('Invalid passage vector');
    this.db
      .prepare('INSERT OR REPLACE INTO chunks VALUES(?,?,?,?,?,?)')
      .run(id, ordinal, start, end, vectorFormat, Buffer.from(Float32Array.from(numbers).buffer));
  }
  finish(id) {
    // Publish only complete documents. Source bytes can now be released because
    // the Markdown is the source of truth for export and future vectorization.
    this.db
      .prepare("UPDATE documents SET status='ready',source=NULL,error=NULL WHERE id=?")
      .run(id);
  }
  candidates(query, limit = 8) {
    const best = [];
    const rows = this.db.prepare(
      "SELECT c.document,c.ordinal,c.start,c.end,c.vector,d.title FROM chunks c JOIN documents d ON d.id=c.document WHERE d.status='ready' AND c.space=?",
    );
    for (const row of rows.iterate(vectorFormat)) {
      const values = new Float32Array(
        row.vector.buffer.slice(
          row.vector.byteOffset,
          row.vector.byteOffset + row.vector.byteLength,
        ),
      );
      let score = 0;
      for (let i = 0; i < values.length; i++) score += values[i] * query[i];
      if (best.length === limit && score <= best.at(-1).score) continue;
      const { vector, ...hit } = row;
      best.push({ ...hit, score });
      best.sort((a, b) => b.score - a.score);
      if (best.length > limit) best.pop();
    }
    return best.map((hit) => ({
      ...hit,
      text: this.markdown(hit.document).markdown.slice(hit.start, hit.end),
    }));
  }
  close() {
    this.indexLock.close();
    this.db.close();
  }
}
