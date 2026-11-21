import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const exec = promisify(execFile);
const source = fileURLToPath(new URL('../runtime/ocr/', import.meta.url));
const support = join(source, 'runtime-support');
const bootstrap = JSON.parse(readFileSync(join(support, 'bootstrap.json')));
const pythonPath = (root) => join(root, 'python/bin/python3.12');
export const platformSupported = process.platform === 'linux' && process.arch === 'x64';

export function installedBackend(root) {
  try {
    const receipt = JSON.parse(readFileSync(join(root, 'installed.json')));
    const mode = receipt.backend;
    if (!['ovis', 'ovis-bf16'].includes(mode)) return;
    const lock = mode === 'ovis' ? 'requirements-linux-ovis.txt' : 'requirements-linux-cu130.txt';
    const hash = createHash('sha256').update(readFileSync(join(support, lock))).digest('hex');
    if (receipt.package_lock_sha256 !== hash || !existsSync(pythonPath(root)) ||
        !existsSync(join(root, 'environments', hash.slice(0, 20), 'ready.json')) ||
        (mode === 'ovis' && !existsSync(join(root, 'llama/llama-server')))) return;
    const { models } = JSON.parse(readFileSync(join(support, 'models-' + mode + '.json')));
    if (!models.every(model => receipt.models?.some(item => item.repo === model.repo && item.revision === model.revision))) return;
    for (const model of models) for (const file of model.files) {
      if (statSync(join(root, model.directory, file.path)).size !== file.bytes) return;
    }
    return mode;
  } catch { return undefined; }
}

async function chooseBackend() {
  try {
    await exec('cc', ['--version'], { timeout: 3000 });
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=compute_cap,memory.total,driver_version', '--format=csv,noheader,nounits'], { timeout: 3000 });
    const [cap, memory, driver] = stdout.trim().split('\n')[0].split(',').map(parseFloat);
    if (cap >= 8 && memory >= 22_000 && driver >= 580) return 'ovis-bf16';
  } catch { /* The compact runtime also runs on CPU. */ }
  return 'ovis';
}

function run(command, args, env, signal, report = () => {}) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: source, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let detail = '';
    const output = createInterface({ input: child.stdout });
    const errors = createInterface({ input: child.stderr });
    output.on('line', (line) => {
      if (/^(Installing |Downloading and verifying |Verified )/.test(line)) report(line.slice(0, 180));
    });
    errors.on('line', (line) => {
      const text = line.trim();
      if (!text) return;
      detail = text.slice(-500);
      if (/^(Downloading|Downloaded) [a-z][\w.-]*(?: \([0-9.]+ [KMGT]i?B\))?$/i.test(text)) report(text);
    });
    const cancel = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* process exited */ }
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    child.once('error', reject);
    child.once('close', (code) => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (code !== 0) reject(new Error(detail || 'OCR installer exited with code ' + code));
      else resolve();
    });
  });
}

export async function installOcr(root, report, signal) {
  if (!platformSupported) throw new Error('Local OvisOCR2 currently supports Linux x86-64.');
  const existing = installedBackend(root);
  if (existing) return existing;
  const mode = await chooseBackend();
  const env = { ...process.env, OCR2_RUNTIME: root, PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1',
    PYTHONPATH: '', UV_NO_MODIFY_PATH: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' };
  await mkdir(root, { recursive: true, mode: 0o700 });
  const prefix = join(root, 'bootstrap-' + bootstrap.uv_version);
  const uv = join(prefix, 'uv');
  if (!existsSync(uv)) {
    report('Downloading the verified Python installer');
    await mkdir(prefix, { recursive: true });
    const res = await fetch(bootstrap.url, { signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]) });
    if (!res.ok) throw new Error('Python installer download failed (HTTP ' + res.status + ').');
    const wheel = Buffer.from(await res.arrayBuffer());
    if (wheel.length !== bootstrap.bytes || createHash('sha256').update(wheel).digest('hex') !== bootstrap.sha256)
      throw new Error('Python installer checksum mismatch. Retry setup.');
    const archive = await JSZip.loadAsync(wheel);
    const bin = await archive.file('uv-' + bootstrap.uv_version + '.data/scripts/uv').async('nodebuffer');
    const stage = join(prefix, randomUUID() + '.partial');
    try { await writeFile(stage, bin, { mode: 0o700 }); await rename(stage, uv); }
    finally { await rm(stage, { force: true }); }
  }
  env.DSH_OCR_UV = uv;
  const dir = join(root, 'interpreters');
  report('Installing private Python ' + bootstrap.python_version);
  await run(uv, ['--no-config', 'python', 'install', bootstrap.python_version, '--no-bin', '--install-dir', dir], env, signal);
  const entry = (await readdir(dir, { withFileTypes: true })).find(e => e.isDirectory() && e.name.startsWith('cpython-' + bootstrap.python_version + '-'));
  if (!entry) throw new Error('The managed Python installation is missing.');
  report('Installing OvisOCR2 (' + (mode === 'ovis-bf16' ? 'CUDA BF16' : 'compact') + ')');
  await rm(join(root, 'verified-probe-v1-' + mode), { force: true });
  await run(join(dir, entry.name, 'bin/python3.12'), ['-m', 'document_ocr.install', '--mode', mode], env, signal, report);
  if (!installedBackend(root)) throw new Error('OCR setup finished with missing assets. Retry setup.');
  return mode;
}

// One request at a time per profile keeps the model hot between imports. A
// canceled active document stops its worker. The next request gets a fresh one.
export class OcrWorker {
  constructor(root) { this.root = root; this.queue = Promise.resolve(); }
  async convert(bytes, suffix, signal, timeout) {
    const folder = await mkdtemp(join(tmpdir(), 'dsh-knowledge-ocr-'));
    try {
      const input = join(folder, 'source.' + suffix);
      await writeFile(input, bytes, { mode: 0o600, signal });
      const task = this.queue.then(async () => {
        signal?.throwIfAborted();
        if (this.closed) throw new Error('Knowledge closed');
        if (!installedBackend(this.root)) throw new Error('Install PDF OCR and local search in this base’s Settings.');
        await this.stopping;
        const deadline = AbortSignal.timeout(timeout);
        const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
        return this.request(input, cancellation);
      });
      this.queue = task.catch(() => {});
      // Cancel a queued import immediately. Its queue entry checks the same
      // signal before opening the (already removed) temporary input.
      if (!signal) return await task;
      signal.throwIfAborted();
      let cancel;
      const aborted = new Promise((_, reject) => {
        cancel = () => reject(signal.reason);
        signal.addEventListener('abort', cancel, { once: true });
      });
      try { return await Promise.race([task, aborted]); }
      finally { signal.removeEventListener('abort', cancel); }
    } finally { await rm(folder, { recursive: true, force: true }); }
  }
  launch() {
    const child = spawn(pythonPath(this.root), ['-m', 'document_ocr', 'worker'], {
      cwd: source, env: { ...process.env, OCR2_RUNTIME: this.root, PYTHONPATH: '', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.exit = new Promise(resolve => child.once('close', resolve));
    let tail = '';
    child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-1024); });
    const fail = (reason) => { if (this.child === child) { this.child = undefined; this.pending?.(reason); } };
    child.stdin.on('error', fail);
    child.once('error', fail);
    child.once('close', code => fail(new Error('OCR worker exited (' + code + '). ' + tail.trim().slice(-500))));
    createInterface({ input: child.stdout }).on('line', line => {
      if (this.child !== child) return;
      try { this.pending?.(null, JSON.parse(line)); }
      catch { this.pending?.(new Error('Invalid response from local OCR worker')); }
    });
    return child;
  }
  request(input, signal) {
    signal.throwIfAborted();
    clearTimeout(this.idle);
    const child = this.child || this.launch();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => { this.pending?.(signal.reason); this.stop(); };
      this.pending = (error, reply) => {
        this.pending = undefined;
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else if (reply?.id !== id || reply.version !== 1) reject(new Error('Mismatched OCR worker response'));
        else if (reply.status === 'error') reject(new Error(reply.error?.message || 'OCR conversion failed'));
        else resolve(reply);
        this.idle = setTimeout(() => this.stop(), 60_000);
        this.idle.unref();
      };
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin.write(JSON.stringify({ version: 1, id, input }) + '\n', error => { if (error) this.pending?.(error); });
    });
  }
  stop() {
    clearTimeout(this.idle);
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.stopping = this.exit;
    child.stdin.end();
    child.kill('SIGTERM');
  }
  close() { this.closed = true; this.pending?.(new Error('Knowledge closed')); this.stop(); }
}

export async function verifyOcr(worker, backend, signal) {
  const marker = join(worker.root, 'verified-probe-v1-' + backend);
  if (existsSync(marker)) return;
  const image = readFileSync(join(support, 'probe.png'));
  const reply = await worker.convert(image, 'png', signal, 20 * 60_000);
  if (reply.status !== 'complete' || !/4827/.test(reply.markdown))
    throw new Error('OvisOCR2 failed to read the setup test image. Retry setup.');
  await writeFile(marker, '4827\n', { mode: 0o600 });
}
