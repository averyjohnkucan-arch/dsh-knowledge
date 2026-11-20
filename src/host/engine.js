import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ModelProcess } from '../runtime/process.js';
import { installModel } from '../runtime/assets.js';

const exec = promisify(execFile);
export const steps = [
  'Check this computer',
  'Download Qwen3 Embedding 0.6B',
  'Test embeddings on CPU',
  'Download Qwen3 Reranker 0.6B',
  'Check search relevance',
  'Select an available device',
  'Enable local search',
];
const probes = [
  'Saturn is a planet with rings.',
  'A violin has four strings.',
  'Rainfall is measured in millimeters.',
];
const queryText = (query) =>
  'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ' +
  query;
const similarity = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);

export class Engine {
  constructor(root, store, onReady = () => {}) {
    this.root = root;
    this.store = store;
    this.onReady = onReady;
    this.workers = {
      cpu: new ModelProcess(),
      accelerator: new ModelProcess(),
      rank: new ModelProcess(),
    };
    this.state = store.get('setup', { status: 'new', step: 0, device: 'CPU' });
    this.selected = this.state.backend || 'cpu';
    this.foreground = 0;
    this.lastChat = 0;
  }
  start(force = false) {
    if (this.closed || (!force && this.state.status === 'ready')) return this.state;
    if (this.task) {
      if (force) this.checkDeviceAgain = true;
      return this.state;
    }
    this.controller = new AbortController();
    this.state = { status: 'running', step: 0, device: 'CPU', notes: [] };
    this.store.put('setup', this.state);
    const signal = this.controller.signal;
    this.task = this.install(signal)
      .catch((error) => {
        if (!signal.aborted) this.update({ status: 'error', error: error.message });
      })
      .finally(() => {
        this.task = undefined;
        if (this.checkDeviceAgain && this.state.status === 'ready') this.start(true);
      });
    return this.state;
  }
  update(patch) {
    Object.assign(this.state, patch);
    this.store.put('setup', this.state);
  }
  stage(step) {
    this.update({ step, progress: null });
  }
  options(kind, backend) {
    const prefs = this.store.settings();
    const threads = Math.min(
      prefs.threads || Math.min(6, Math.ceil(availableParallelism() / 2)),
      availableParallelism(),
    );
    return [this.root, kind, backend, Math.max(1, threads)];
  }
  run(worker, method, args, timeout) {
    this.workers[worker].idleSeconds = this.store.settings().unloadSeconds;
    return this.workers[worker].call(method, args, timeout);
  }
  cpu(text) {
    return this.run('cpu', 'embed', [this.options('embedding', 'cpu'), text]);
  }
  score(query, text) {
    return this.run('rank', 'score', [this.options('reranker', 'cpu'), query, text]);
  }
  async install(signal) {
    this.selected = 'cpu';
    const detect = new ModelProcess();
    let devices;
    try {
      devices = await detect.call('devices', [], 12_000);
    } catch {
      devices = [];
    } finally {
      detect.close();
    }
    signal.throwIfAborted();
    const report = (progress) => {
      this.state.progress = progress;
    };
    this.stage(1);
    await installModel(this.root, 'embedding', report, signal);
    this.stage(2);
    const references = [];
    for (const text of probes) references.push(await this.cpu(text));
    const query = await this.cpu(queryText('Which planet has rings?'));
    if (
      references.some((v) => Math.abs(similarity(v, v) - 1) > 0.001) ||
      similarity(query, references[0]) <= similarity(query, references[1])
    )
      throw new Error('CPU embedding check failed');
    this.stage(3);
    await installModel(this.root, 'reranker', report, signal);
    this.stage(4);
    const relevant = await this.score('Which planet has rings?', probes[0]);
    const unrelated = await this.score('Which planet has rings?', probes[1]);
    if (!(relevant > unrelated)) throw new Error('The reranker failed its relevance check');
    this.stage(5);
    this.checkDeviceAgain = false;
    const candidates = await this.candidates(devices);
    let label = 'CPU';
    for (const device of candidates) {
      signal.throwIfAborted();
      let profile;
      try {
        const config = this.options('embedding', device.backend);
        if (!device.backend.startsWith('ov:')) {
          profile = await mkdtemp(join(tmpdir(), 'dsh-knowledge-device-'));
          config.push(profile);
        }
        if (device.backend.startsWith('ov:'))
          await installModel(this.root, 'intel', report, signal);
        for (let i = 0; i < probes.length; i++) {
          const vector = await this.run('accelerator', 'embed', [config, probes[i]], 150_000);
          if (!(similarity(vector, references[i]) >= 0.995))
            throw new Error('Output differs from the CPU reference');
        }
        // Some runtimes accept a requested GPU but silently schedule the graph on CPU.
        if (profile) await this.run('accelerator', 'verifyProvider', [config]);
        this.selected = device.backend;
        label = device.name;
        break;
      } catch (error) {
        signal.throwIfAborted();
        this.workers.accelerator.stop();
        this.state.notes.push(device.name + ': ' + error.message.slice(0, 200));
      } finally {
        if (profile) await rm(profile, { recursive: true, force: true });
      }
    }
    signal.throwIfAborted();
    this.stage(6);
    this.state.status = 'ready';
    await this.onReady();
    this.update({ status: 'ready', backend: this.selected, device: label, progress: null });
  }
  async candidates(devices) {
    const preference = this.store.settings().device;
    if (preference === 'cpu') return [];
    const choices = [];
    // CUDA is optional in the Node distribution. Skip a busy discrete GPU.
    let nvidiaBusy = false;
    if (['auto', 'gpu'].includes(preference)) {
      try {
        const result = await exec(
          'nvidia-smi',
          ['--query-compute-apps=pid', '--format=csv,noheader,nounits'],
          { timeout: 3000, windowsHide: true },
        );
        nvidiaBusy = result.stdout.trim() !== '';
        if (!nvidiaBusy) choices.push({ backend: 'cuda', name: 'NVIDIA CUDA' });
      } catch {
        /* A machine without NVIDIA can still use its system GPU. */
      }
    }
    for (const device of devices) {
      if (preference !== 'auto' && preference !== device.kind) continue;
      if (nvidiaBusy && /nvidia/i.test(device.name)) continue;
      choices.push({ backend: 'ov:' + device.id, name: device.name });
    }
    if (!nvidiaBusy && ['auto', 'gpu'].includes(preference)) {
      if (process.platform === 'win32')
        choices.push({ backend: 'dml', name: 'System GPU (DirectML)' });
      choices.push({ backend: 'webgpu', name: 'System GPU (WebGPU)' });
    }
    if (!choices.length)
      this.state.notes.push('No available ' + preference + ' accelerator. Using CPU.');
    return choices;
  }
  async embed(text, query = false) {
    const input = query ? queryText(text) : text;
    if (query || this.foreground || this.selected === 'cpu') return this.cpu(input);
    try {
      return await this.run('accelerator', 'embed', [
        this.options('embedding', this.selected),
        input,
      ]);
    } catch (error) {
      if (
        !this.closed &&
        error.message !== 'PASSAGE_TOO_LONG' &&
        error.message !== 'Reserved for chat' &&
        !this.foreground
      ) {
        this.selected = 'cpu';
        this.update({
          backend: 'cpu',
          device: 'CPU',
          notes: ['Accelerator unavailable. ' + error.message.slice(0, 160)],
        });
      }
      return this.cpu(input);
    }
  }
  canIndex(now = new Date()) {
    const p = this.store.settings();
    if (p.schedule === 'paused') return false;
    if (p.schedule === 'always') return true;
    if (this.foreground || now.getTime() - this.lastChat < p.quietSeconds * 1000) return false;
    if (p.schedule !== 'window' || p.windowStart === p.windowEnd) return true;
    const time = [now.getHours(), now.getMinutes()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    // An overnight window crosses midnight. An ending time is always exclusive.
    return p.windowStart < p.windowEnd
      ? time >= p.windowStart && time < p.windowEnd
      : time >= p.windowStart || time < p.windowEnd;
  }
  close() {
    this.closed = true;
    this.controller?.abort();
    for (const worker of Object.values(this.workers)) worker.close();
  }
}
