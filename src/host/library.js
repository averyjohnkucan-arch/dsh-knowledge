import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from './store.js';
import { Engine, steps } from './engine.js';
import { passageRanges, toMarkdown } from './markdown.js';
import { askVision, visionCatalog } from './vision.js';

export class Library {
  constructor(root, ctx) {
    this.store = new Store(root);
    this.ctx = ctx;
    this.searches = new Set();
    this.controller = new AbortController();
    this.engine = new Engine(join(root, 'models'), this.store, () => this.wake());
    this.timer = setInterval(() => this.wake(), 2000);
    this.timer.unref();
    if (this.engine.state.status === 'running') this.engine.start();
    this.wake();
  }
  snapshot() {
    return {
      setup: this.engine.state,
      steps,
      settings: this.store.settings(),
      documents: this.store.list(),
      activity: this.activity,
    };
  }
  async configure(input) {
    if (input.ocrModel || input.descriptionModel) {
      const { models } = await visionCatalog(this.ctx);
      for (const id of [input.ocrModel, input.descriptionModel].filter(Boolean)) {
        if (!models.some((model) => model.id === id))
          throw new Error('Choose a model currently registered in Harness.');
      }
    }
    const old = this.store.settings();
    const next = this.store.configure(input);
    if (next.device !== old.device && ['running', 'ready'].includes(this.engine.state.status))
      this.engine.start(true);
    this.wake();
    return next;
  }
  add(title, kind, data) {
    if (typeof title !== 'string' || !title.trim() || title.length > 240)
      throw new Error('Give the document a title of up to 240 characters.');
    if (!data?.length) throw new Error('This document is empty.');
    const doc = this.store.add(title.trim(), kind, data);
    this.wake();
    return doc;
  }
  retry(id) {
    const row = this.store.db
      .prepare("UPDATE documents SET error=NULL,status='queued' WHERE id=? AND status='error'")
      .run(id);
    if (!row.changes) throw new Error('Only a failed document can be retried.');
    this.wake();
  }
  wake() {
    if (
      this.controller.signal.aborted ||
      this.job ||
      this.engine.state.status !== 'ready' ||
      !this.engine.canIndex()
    )
      return;
    this.job = this.store
      .withIndexer(() => this.drain())
      .catch((error) => this.ctx.logger?.warn('Knowledge import: ' + error.message))
      .finally(() => {
        this.job = undefined;
      });
  }
  async drain() {
    const signal = this.controller.signal;
    while (!signal.aborted && this.engine.canIndex() && this.engine.state.status === 'ready') {
      const doc = this.store.next();
      if (!doc) return;
      try {
        let markdown = doc.markdown;
        if (markdown === null) {
          this.store.mark(doc.id, 'reading');
          markdown = await toMarkdown(
            doc,
            this.store.settings(),
            async (...args) => {
              // A multi-page scan can span a quiet-period or daily-window boundary.
              while (!this.engine.canIndex() || this.engine.state.status !== 'ready')
                await delay(1000, undefined, { signal });
              return askVision(this.ctx, ...args);
            },
            signal,
            (page, total) => {
              this.activity = 'Reading page ' + page + ' of ' + total;
            },
          );
          signal.throwIfAborted();
          this.store.saveMarkdown(doc.id, markdown);
        }
        const ranges = passageRanges(markdown);
        for (let i = this.store.saved(doc.id); i < ranges.length; i++) {
          if (!this.engine.canIndex() || this.engine.state.status !== 'ready') return;
          signal.throwIfAborted();
          this.activity = 'Embedding passage ' + (i + 1) + ' of ' + ranges.length;
          const { start, end } = ranges[i];
          const vector = await this.engine.embed(markdown.slice(start, end));
          signal.throwIfAborted();
          this.store.saveVector(doc.id, i, start, end, vector);
        }
        this.store.finish(doc.id);
      } catch (error) {
        if (signal.aborted) return;
        this.store.mark(doc.id, 'error', error.message.slice(0, 500));
      } finally {
        this.activity = undefined;
      }
    }
  }
  async search(query) {
    this.controller.signal.throwIfAborted();
    const task = this.retrieve(query);
    this.searches.add(task);
    try {
      return await task;
    } finally {
      this.searches.delete(task);
    }
  }
  async retrieve(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 2400)
      throw new Error('Enter a question of up to 2,400 characters.');
    if (this.engine.state.status !== 'ready') throw new Error('Finish Knowledge setup to search.');
    const candidates = this.store.candidates(await this.engine.embed(query, true));
    for (const hit of candidates) hit.relevance = await this.engine.score(query, hit.text);
    return candidates.sort((a, b) => b.relevance - a.relevance).slice(0, 5);
  }
  async close() {
    if (this.closing) return this.closing;
    clearInterval(this.timer);
    this.controller.abort();
    this.engine.close();
    this.closing = Promise.allSettled([this.job, this.engine.task, ...this.searches]).then(() =>
      this.store.close(),
    );
    return this.closing;
  }
}
