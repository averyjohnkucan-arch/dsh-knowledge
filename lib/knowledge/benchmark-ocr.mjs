var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/knowledge/ocr-render-client.ts
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { availableParallelism as availableParallelism2 } from "node:os";
async function disposeOcrRenderers() {
  await Promise.all([...children].map((child) => new Promise((resolve2) => {
    child.once("exit", () => resolve2());
    child.kill("SIGKILL");
  })));
}
async function streamOcrRasters(bytes, pages2, limits, consume, modulePath = fileURLToPath2(new URL("./ocr-render-process.mjs", import.meta.url))) {
  if (!existsSync(modulePath)) return false;
  while (running >= capacity) await new Promise((resolve2) => {
    const wake = () => {
      queued.delete(wake);
      resolve2();
    };
    queued.add(wake);
  });
  running++;
  try {
    await new Promise((resolve2, reject) => {
      const child = fork(modulePath, [], { execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, CUDA_VISIBLE_DEVICES: "", ELECTRON_RUN_AS_NODE: "1" } });
      children.add(child);
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill("SIGKILL");
        child.once("exit", () => error ? reject(error) : resolve2());
      };
      const timer = setTimeout(() => finish(Error("OCR page rendering timed out")), limits.timeoutMs);
      child.on("message", (value) => {
        if (settled) return;
        if (value?.type === "page" && Number.isInteger(value.page) && value.png instanceof Uint8Array) {
          void consume(value.page, Buffer.from(value.png)).then(() => {
            if (!settled && child.connected) child.send({ type: "ack" }, (error) => {
              if (error) finish(error);
            });
          }, (error) => finish(error instanceof Error ? error : Error(String(error))));
        } else if (value?.type === "done") finish();
        else if (value?.type === "error") finish(Object.assign(Error(String(value.message)), { code: "ocr_incomplete" }));
        else finish(Error("Invalid OCR renderer response"));
      });
      child.once("error", (error) => {
        if (child.pid === void 0) {
          settled = true;
          clearTimeout(timer);
          children.delete(child);
          reject(error);
        } else finish(error);
      });
      child.once("exit", (code, signal) => {
        children.delete(child);
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(Error(`OCR renderer exited (${signal ?? code})`));
        }
      });
      child.send({ type: "render", bytes, pages: pages2, ...limits, window: Math.max(1, Math.min(16, limits.window)) }, (error) => {
        if (error) finish(error);
      });
    });
    return true;
  } finally {
    running--;
    for (const wake of queued) wake();
  }
}
var running, queued, children, capacity;
var init_ocr_render_client = __esm({
  "src/knowledge/ocr-render-client.ts"() {
    "use strict";
    running = 0;
    queued = /* @__PURE__ */ new Set();
    children = /* @__PURE__ */ new Set();
    capacity = Math.max(1, Math.min(4, Math.floor(availableParallelism2() / 4)));
  }
});

// src/knowledge/net.ts
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
function applyGlobalProxy() {
  if (proxyApplied) return;
  proxyApplied = true;
  const proxy = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (proxy === void 0 || proxy.trim() === "") return;
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch {
  }
}
async function httpFetch(url, options = {}) {
  const { method, headers, body, redirect, signal } = options;
  const timeoutMs = positiveDuration(options.timeoutMs, 3e4);
  const retries = nonNegativeInteger(options.retries, 1);
  const deadlineAt = options.deadlineAt !== void 0 && Number.isFinite(options.deadlineAt) ? options.deadlineAt : void 0;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfExternallyAborted(signal);
    const remainingMs = deadlineAt !== void 0 ? Math.ceil(deadlineAt - Date.now()) : timeoutMs;
    if (remainingMs <= 0) {
      lastError = new DOMException("The operation timed out", "TimeoutError");
      break;
    }
    const attemptTimeoutMs = Math.max(1, Math.min(timeoutMs, remainingMs));
    try {
      return await fetch(url, {
        method,
        headers,
        body,
        signal: signal !== void 0 ? AbortSignal.any([signal, AbortSignal.timeout(attemptTimeoutMs)]) : AbortSignal.timeout(attemptTimeoutMs),
        ...redirect !== void 0 ? { redirect } : {}
      });
    } catch (error) {
      throwIfExternallyAborted(signal);
      lastError = error;
    }
  }
  throw new Error(`network request failed: ${describeNetworkError(lastError)}`);
}
function positiveDuration(value, fallback) {
  if (value === void 0 || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.trunc(value));
}
function nonNegativeInteger(value, fallback) {
  if (value === void 0 || !Number.isFinite(value) || value < 0) return fallback;
  return Math.trunc(value);
}
function throwIfExternallyAborted(signal) {
  if (signal?.aborted !== true) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("The operation was aborted", "AbortError");
}
function describeNetworkError(error) {
  if (!(error instanceof Error)) return String(error);
  const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
  const cause = error.cause;
  if (cause !== void 0) {
    const causeText = cause instanceof Error ? cause.message : String(cause);
    return timedOut ? `timeout (${causeText})` : `${error.message} (${causeText})`;
  }
  return timedOut ? "timeout" : error.message;
}
var proxyApplied;
var init_net = __esm({
  "src/knowledge/net.ts"() {
    "use strict";
    proxyApplied = false;
  }
});

// src/knowledge/embedding-dimensions.ts
var init_embedding_dimensions = __esm({
  "src/knowledge/embedding-dimensions.ts"() {
    "use strict";
  }
});

// src/knowledge/embedding-tuning.ts
function resolveEmbeddingCpuTuning(input, cores, freeBytes) {
  const positive = (value, fallback, max) => typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
  const available = Math.max(1, Math.floor(cores));
  const memoryInstances = Math.max(1, Math.min(4, Math.floor(freeBytes / (2 * 1024 ** 3))));
  const instances = Math.min(positive(input.instances, available >= 16 ? 2 : 1, 4), memoryInstances, available);
  return { instances, threads: Math.min(positive(input.threads, 8, 64), Math.max(1, Math.floor(available / instances))), microBatch: positive(input.microBatch, 1, 8) };
}
var init_embedding_tuning = __esm({
  "src/knowledge/embedding-tuning.ts"() {
    "use strict";
  }
});

// src/knowledge/embed-protocol.ts
function isLocalEmbedResponse(value) {
  if (value === null || typeof value !== "object") return false;
  const response = value;
  return response.protocolVersion === LOCAL_EMBED_PROTOCOL_VERSION && typeof response.id === "number" && Number.isInteger(response.id) && ["download", "load", "embed", "release", "shutdown"].includes(String(response.operation)) && typeof response.ok === "boolean";
}
var LOCAL_EMBED_PROTOCOL_VERSION;
var init_embed_protocol = __esm({
  "src/knowledge/embed-protocol.ts"() {
    "use strict";
    LOCAL_EMBED_PROTOCOL_VERSION = 1;
  }
});

// src/knowledge/local-embedding-pool.ts
import { fork as fork2 } from "node:child_process";
import { availableParallelism as availableParallelism3, freemem as freemem2 } from "node:os";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var LocalEmbeddingPool, localEmbeddingPool;
var init_local_embedding_pool = __esm({
  "src/knowledge/local-embedding-pool.ts"() {
    "use strict";
    init_embedding_tuning();
    init_embed_protocol();
    LocalEmbeddingPool = class {
      desired = {};
      active = "";
      lanes = [];
      generation = 0;
      sequence = 0;
      configuring;
      idle;
      idleMs = 6e4;
      configure(tuning, idleMs = this.idleMs) {
        this.desired = tuning;
        this.idleMs = idleMs;
      }
      async ready() {
        const tuning = resolveEmbeddingCpuTuning(this.desired, availableParallelism3(), freemem2());
        const key = JSON.stringify(tuning);
        if (this.configuring) await this.configuring;
        if (this.active !== key) {
          this.configuring = (async () => {
            await Promise.all(this.lanes.map((l) => l.tail));
            await this.dispose();
            this.active = key;
            this.lanes = Array.from({ length: tuning.instances }, () => ({ tail: Promise.resolve(), pending: 0 }));
          })();
          try {
            await this.configuring;
          } finally {
            this.configuring = void 0;
          }
        }
        return tuning;
      }
      worker(lane) {
        if (lane.child) return lane.child;
        const child = fork2(fileURLToPath3(new URL("./embed-process.mjs", import.meta.url)), [], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", ROCR_VISIBLE_DEVICES: "" }, execArgv: process.execArgv.filter((arg) => !arg.startsWith("--input-type") && !arg.startsWith("--inspect")) });
        lane.child = child;
        child.unref();
        child.on("error", () => {
        });
        return child;
      }
      request(lane, payload) {
        const child = this.worker(lane), id = ++this.sequence;
        return new Promise((resolve2, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            child.off("message", message);
            child.off("exit", exit);
            child.off("error", error);
          };
          const fail = (reason) => {
            cleanup();
            if (lane.child === child) lane.child = void 0;
            child.kill("SIGKILL");
            reject(reason);
          };
          const error = (reason) => fail(reason);
          const exit = () => fail(new Error("local embedding process exited"));
          const message = (raw) => {
            if (!raw || typeof raw !== "object" || raw.id !== id) return;
            if (!isLocalEmbedResponse(raw) || raw.operation !== "embed") {
              fail(Error("Invalid embedding pool response"));
              return;
            }
            if (!raw.ok) {
              fail(Error("local embedding process failed: " + raw.error.message));
              return;
            }
            const vectors = raw.vectors, expected = payload.texts.length;
            if (!Array.isArray(vectors) || vectors.length !== expected || vectors.some((v) => !Array.isArray(v) || !v.length || v.some((x) => !Number.isFinite(x)))) {
              fail(Error("Invalid embedding pool vectors"));
              return;
            }
            cleanup();
            resolve2(vectors);
          };
          const timer = setTimeout(() => fail(Error("local embedding process timed out")), 12e4);
          timer.unref?.();
          child.on("message", message);
          child.once("exit", exit);
          child.once("error", error);
          try {
            child.send({ ...payload, protocolVersion: 1, id, operation: "embed" }, (error2) => {
              if (error2) fail(error2);
            });
          } catch (reason) {
            fail(reason instanceof Error ? reason : Error(String(reason)));
          }
        });
      }
      async embed(modelId, cacheDir, texts, pooling, hfEndpoint) {
        if (this.idle) {
          clearTimeout(this.idle);
          this.idle = void 0;
        }
        const tuning = await this.ready(), generation = this.generation;
        const jobs = [...this.lanes].sort((a, b) => a.pending - b.pending).slice(0, Math.min(this.lanes.length, texts.length)).map((lane, laneIndex, lanes) => {
          const indices = Array.from({ length: texts.length }, (_, i) => i).filter((i) => i % lanes.length === laneIndex);
          lane.pending++;
          const promise = lane.tail.then(async () => {
            if (this.generation !== generation) throw Error("Embedding pool configuration changed");
            const vectors = await this.request(lane, { modelId, cacheDir, texts: indices.map((i) => texts[i]), pooling, hfEndpoint, cpuTuning: { threads: tuning.threads, instances: 1, microBatch: tuning.microBatch } });
            return indices.map((index, i) => ({ index, vector: vectors[i] }));
          }).finally(() => {
            lane.pending--;
          });
          lane.tail = promise.catch(() => {
          });
          return promise;
        });
        try {
          const settled = await Promise.allSettled(jobs);
          const failure = settled.find((r) => r.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
          const result = new Array(texts.length);
          for (const r of settled) if (r.status === "fulfilled") for (const item of r.value) result[item.index] = item.vector;
          if (result.some((v) => v.length !== result[0].length)) throw Error("Inconsistent embedding pool dimensions");
          return result;
        } finally {
          if (this.idleMs > 0 && !this.lanes.some((l) => l.pending)) {
            this.idle = setTimeout(() => {
              void this.dispose();
            }, this.idleMs);
            this.idle.unref?.();
          }
        }
      }
      async dispose() {
        this.generation++;
        if (this.idle) clearTimeout(this.idle);
        this.idle = void 0;
        this.active = "";
        const lanes = this.lanes;
        this.lanes = [];
        await Promise.all(lanes.map(async (lane) => {
          const child = lane.child;
          lane.child = void 0;
          if (!child || child.exitCode !== null || child.signalCode !== null) return;
          await new Promise((resolve2) => {
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
              resolve2();
            }, 1e3);
            child.once("close", () => {
              clearTimeout(timer);
              resolve2();
            });
            child.kill("SIGKILL");
          });
        }));
      }
    };
    localEmbeddingPool = new LocalEmbeddingPool();
  }
});

// src/knowledge/structure-cpu-budget.ts
function embeddingCpuLaneLimit(cores, threads) {
  return Math.max(1, Math.floor((cores - structureWorkers * 8) / Math.max(1, threads)));
}
var structureWorkers;
var init_structure_cpu_budget = __esm({
  "src/knowledge/structure-cpu-budget.ts"() {
    "use strict";
    structureWorkers = 0;
  }
});

// src/knowledge/background-gpu.ts
var BackgroundGpuAdmission, knowledgeGpuAdmission;
var init_background_gpu = __esm({
  "src/knowledge/background-gpu.ts"() {
    "use strict";
    BackgroundGpuAdmission = class {
      scheduler;
      driver;
      demand = /* @__PURE__ */ new Set();
      lease;
      acquiring;
      timer;
      admitted = false;
      generation = 0;
      retryAt = 0;
      get allowed() {
        return !this.scheduler || this.admitted;
      }
      attach(scheduler, stop) {
        this.scheduler = scheduler;
        this.driver = { key: "knowledge:background", name: "Knowledge OCR and embeddings", gpu: 0, priority: "background", fingerprint: "knowledge-background-v1", load: async () => {
          this.admitted = true;
        }, unload: async () => {
          this.admitted = false;
          await stop();
        } };
        this.timer = setInterval(() => this.tick(), 1e3);
        this.timer.unref?.();
        this.tick();
        return async () => {
          this.admitted = false;
          this.generation++;
          clearInterval(this.timer);
          this.timer = void 0;
          this.acquiring?.abort();
          this.acquiring = void 0;
          this.lease?.release();
          this.lease = void 0;
          try {
            await scheduler.unload("knowledge:background");
          } finally {
            this.scheduler = void 0;
            this.driver = void 0;
          }
        };
      }
      hasOtherDemand(owner) {
        return [...this.demand].some((value) => value !== owner);
      }
      request(owner, active) {
        if (active) this.demand.add(owner);
        else this.demand.delete(owner);
        if (!this.lease) this.tick();
      }
      tick() {
        if (!this.scheduler || !this.driver) return;
        this.lease?.release();
        this.lease = void 0;
        if (!this.demand.size) {
          this.acquiring?.abort();
          return;
        }
        if (this.acquiring || Date.now() < this.retryAt) return;
        const controller = new AbortController(), generation = this.generation;
        this.acquiring = controller;
        void this.scheduler.acquire(this.driver, controller.signal).then((lease) => {
          if (generation !== this.generation || controller.signal.aborted || !this.demand.size) lease.release();
          else {
            this.lease = lease;
            lease.signal.addEventListener("abort", () => {
              this.admitted = false;
            }, { once: true });
          }
        }).catch(() => {
          this.retryAt = Date.now() + 2e3;
        }).finally(() => {
          if (this.acquiring === controller) this.acquiring = void 0;
        });
      }
    };
    knowledgeGpuAdmission = new BackgroundGpuAdmission();
  }
});

// src/knowledge/embedding-device-availability.ts
import { readdir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
function registerBackgroundDevices(owner) {
  backgroundOwners.add(owner);
  return () => {
    backgroundOwners.delete(owner);
  };
}
function backgroundDevicePids(local = /* @__PURE__ */ new Set()) {
  return /* @__PURE__ */ new Set([...local, ...[...backgroundOwners].flatMap((owner) => owner()).filter((pid) => pid !== void 0)]);
}
function parseIntelActivity(text, processName = "") {
  if (!/^drm-driver:\s*(?:i915|xe)\s*$/m.test(text)) return void 0;
  const client = /^drm-client-id:\s*(\S+)/m.exec(text)?.[1];
  if (!client) return void 0;
  const display = /^(?:gnome-shell|kwin_wayland|kwin_x11|Xorg|Xwayland|ChatGPT)$/i.test(processName);
  const compute = /^drm-engine-compute:\s*(\d+) ns/m.exec(text);
  if (display && compute) return { client, nanoseconds: Number(compute[1]) };
  let nanoseconds = 0;
  for (const match of text.matchAll(/^drm-engine-(?:render|compute|video(?:-enhance)?):\s*(\d+) ns/gm)) nanoseconds += Number(match[1]);
  return { client, nanoseconds };
}
function intelActivityAvailable(previous, current, elapsedMs) {
  return elapsedMs > 0 && current >= previous && (current - previous) / (elapsedMs * 1e6) < 0.05;
}
function foreignNvidiaGraphics(text, owned) {
  const compositor = /^(?:gnome-shell|kwin_wayland|kwin_x11|Xorg|Xwayland|dwm)$/i;
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!/^\d+$/.test(fields[0] ?? "") || !/^\d+$/.test(fields[1] ?? "")) continue;
    if (owned.has(Number(fields[1]))) continue;
    const command = fields.at(-1) ?? "";
    if (fields[2]?.includes("C") || !compositor.test(command) || Number(fields[3]) > 5) return true;
  }
  return false;
}
function nvidiaMemorySufficient(freeMiB, hasOwnedWorker) {
  return Number.isFinite(freeMiB) && freeMiB >= (hasOwnedWorker ? 1024 : 4096);
}
async function nvidiaEmbeddingAvailability(owned) {
  const currentOwned = () => backgroundDevicePids(typeof owned === "function" ? owned() : owned);
  try {
    const { apps, memory, graphics } = await nvidiaActivity.sample();
    const owners = currentOwned();
    if (apps.split(/\s+/).filter(Boolean).some((pid) => !/^\d+$/.test(pid) || !owners.has(Number(pid)))) return { available: false, reason: "Another inference process reserves the main GPU" };
    const freeMiB = Number(memory.trim().split("\n")[0]), ownGpu = apps.split(/\s+/).some((pid) => owners.has(Number(pid)));
    if (!nvidiaMemorySufficient(freeMiB, ownGpu)) return { available: false, reason: "Not enough free VRAM for background embeddings" };
    if (process.platform === "linux" && foreignNvidiaGraphics(graphics, currentOwned())) return { available: false, reason: "Another graphics application is using the main GPU" };
    return { available: true, reason: "Main GPU is available for background embedding", freeMiB };
  } catch {
    return { available: false, reason: "Main GPU availability could not be verified" };
  }
}
var exec, backgroundOwners, IntelEmbeddingAvailability, NvidiaActivityProbe, nvidiaActivity;
var init_embedding_device_availability = __esm({
  "src/knowledge/embedding-device-availability.ts"() {
    "use strict";
    exec = promisify(execFile);
    backgroundOwners = /* @__PURE__ */ new Set();
    IntelEmbeddingAvailability = class {
      files = [];
      scanned = 0;
      previous = /* @__PURE__ */ new Map();
      pending = /* @__PURE__ */ new Map();
      sample(owned) {
        const owners = backgroundDevicePids(owned);
        const key = [...owners].sort((a, b) => a - b).join(",");
        const pending = this.pending.get(key);
        if (pending) return pending;
        const sample = this.sampleNow(owners).finally(() => {
          this.pending.delete(key);
        });
        this.pending.set(key, sample);
        return sample;
      }
      async sampleNow(owned) {
        if (process.platform !== "linux") return { available: false, reason: "Device activity monitoring is unavailable; desktop idle is required" };
        owned = backgroundDevicePids(owned);
        const now = Date.now();
        try {
          if (now - this.scanned > 2e3) {
            const files2 = [];
            const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
            let next3 = 0;
            await Promise.all(Array.from({ length: 8 }, async () => {
              while (next3 < pids.length) {
                const pid = Number(pids[next3++]);
                if (owned.has(pid)) continue;
                try {
                  if ((await stat(`/proc/${pid}`)).uid !== process.getuid?.()) continue;
                  const name = (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
                  for (const fd of await readdir(`/proc/${pid}/fdinfo`)) {
                    const path = `/proc/${pid}/fdinfo/${fd}`;
                    try {
                      if (parseIntelActivity(await readFile(path, "utf8"))) files2.push({ pid, path, name });
                    } catch {
                    }
                  }
                } catch {
                }
              }
            }));
            this.files = files2;
            this.scanned = now;
          }
          const samples = /* @__PURE__ */ new Map();
          for (const file of this.files) {
            if (owned.has(file.pid)) continue;
            try {
              const activity = parseIntelActivity(await readFile(file.path, "utf8"), file.name);
              if (activity) samples.set(`${file.pid}:${activity.client}`, activity.nanoseconds);
            } catch {
            }
          }
          let known = true, busy = false;
          const next2 = /* @__PURE__ */ new Map();
          for (const [client, ns] of samples) {
            const previous = this.previous.get(client);
            if (!previous) known = false;
            else if (!intelActivityAvailable(previous.ns, ns, now - previous.at)) busy = true;
            next2.set(client, { ns, at: now });
          }
          this.previous = next2;
          return { available: known && !busy, reason: busy ? "Another application is using Intel GPU engines" : known ? "Intel GPU engines are available" : "Measuring Intel GPU activity" };
        } catch {
          return { available: false, reason: "Intel GPU availability could not be verified" };
        }
      }
    };
    NvidiaActivityProbe = class {
      constructor(query = async (args) => (await exec("nvidia-smi", args, { timeout: 2500, windowsHide: true })).stdout) {
        this.query = query;
      }
      pending;
      sample() {
        if (this.pending) return this.pending;
        this.pending = Promise.all([
          this.query(["--query-compute-apps=pid", "--format=csv,noheader,nounits"]),
          this.query(["--query-gpu=memory.free", "--format=csv,noheader,nounits"]),
          process.platform === "linux" ? this.query(["pmon", "-s", "u", "-c", "1"]) : Promise.resolve("")
        ]).then(([apps, memory, graphics]) => ({ apps, memory, graphics })).finally(() => {
          this.pending = void 0;
        });
        return this.pending;
      }
    };
    nvidiaActivity = new NvidiaActivityProbe();
  }
});

// src/knowledge/embedding-batcher.ts
var EmbeddingQueueTimeout, EmbeddingBatcher;
var init_embedding_batcher = __esm({
  "src/knowledge/embedding-batcher.ts"() {
    "use strict";
    EmbeddingQueueTimeout = class extends Error {
      constructor() {
        super("Embedding query exceeded its queue wait budget");
        this.name = "EmbeddingQueueTimeout";
      }
    };
    EmbeddingBatcher = class {
      constructor(execute, maxBatch = 16) {
        this.execute = execute;
        this.maxBatch = maxBatch;
      }
      queue = [];
      timer;
      running = false;
      enabled = true;
      request(text, priority = "index", maxQueueWaitMs) {
        if (!this.enabled) return Promise.reject(new Error("Embedding device yielded"));
        return new Promise((resolve2, reject) => {
          const job = { text, priority, resolve: resolve2, reject };
          if (maxQueueWaitMs !== void 0) job.timer = setTimeout(() => {
            const index = this.queue.indexOf(job);
            if (index < 0) return;
            this.queue.splice(index, 1);
            reject(new EmbeddingQueueTimeout());
          }, maxQueueWaitMs);
          const firstBulk = priority === "query" ? this.queue.findIndex((item) => item.priority === "index") : -1;
          if (firstBulk < 0) this.queue.push(job);
          else this.queue.splice(firstBulk, 0, job);
          this.arm();
        });
      }
      resume() {
        this.enabled = true;
      }
      pause() {
        this.enabled = false;
        if (this.timer) clearTimeout(this.timer);
        this.timer = void 0;
        for (const job of this.queue.splice(0)) {
          clearTimeout(job.timer);
          job.reject(new Error("Embedding device yielded"));
        }
      }
      arm() {
        if (this.timer || this.running || !this.enabled || !this.queue.length) return;
        this.timer = setTimeout(() => {
          this.timer = void 0;
          void this.flush();
        }, 3);
      }
      async flush() {
        if (!this.enabled || this.running) return;
        this.running = true;
        const batch = [];
        const firstLength = this.queue[0]?.text.length ?? 0;
        const bucket = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(1, firstLength))));
        let longest = 0;
        for (let i = 0; i < this.queue.length && batch.length < this.maxBatch; ) {
          const job = this.queue[i], length = job.text.length;
          const compatible = !batch.length || length <= bucket && (bucket === 256 || length > bucket / 2);
          if (compatible && (!batch.length || Math.max(longest, length) * (batch.length + 1) <= 32768)) {
            this.queue.splice(i, 1);
            clearTimeout(job.timer);
            batch.push(job);
            longest = Math.max(longest, length);
          } else i++;
        }
        try {
          const result = await this.execute(batch.map((job) => job.text));
          if (result.vectors.length !== batch.length) throw new Error("GPU embedding count mismatch");
          batch.forEach((job, i) => job.resolve({ vector: result.vectors[i], elapsedMs: result.elapsedMs / batch.length }));
        } catch (error) {
          batch.forEach((job) => job.reject(error instanceof Error ? error : new Error(String(error))));
        } finally {
          this.running = false;
          this.arm();
        }
      }
    };
  }
});

// src/knowledge/owned-process.ts
import { execFile as execFile2 } from "node:child_process";
function stopOwnedProcess(child, signal = "SIGKILL") {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    execFile2("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
    });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}
var init_owned_process = __esm({
  "src/knowledge/owned-process.ts"() {
    "use strict";
  }
});

// src/knowledge/private-python.ts
import { access, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import JSZip from "jszip";
async function ensurePrivatePython(root2, run) {
  if (process.arch !== "x64" || !["linux", "win32"].includes(process.platform)) throw Error("Optional accelerator setup supports Linux and Windows x64");
  const python = join(root2, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  try {
    await access(python);
    return python;
  } catch {
  }
  const uv = join(root2, "bootstrap", "uv-0.13.3.data", "scripts", process.platform === "win32" ? "uv.exe" : "uv");
  try {
    await access(uv);
  } catch {
    const response = await httpFetch("https://pypi.org/pypi/uv/0.13.3/json", { signal: AbortSignal.timeout(6e4) });
    if (!response.ok) throw Error("Cannot retrieve the pinned Python bootstrap metadata");
    const data = await response.json();
    const tag = process.platform === "win32" ? "win_amd64" : "manylinux_2_17_x86_64";
    const item = data.urls.find((f) => f.filename.endsWith(".whl") && f.filename.includes(tag));
    if (!item || item.size > 64 * 1024 * 1024 || !/^https:\/\/files\.pythonhosted\.org\//.test(item.url)) throw Error("Unsupported Python bootstrap wheel");
    const download = await httpFetch(item.url, { signal: AbortSignal.timeout(18e4) });
    if (!download.ok) throw Error("Python bootstrap download failed");
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length !== item.size || createHash("sha256").update(bytes).digest("hex") !== item.digests.sha256) throw Error("Python bootstrap checksum mismatch");
    const zip = await JSZip.loadAsync(bytes), entry = zip.file(`uv-0.13.3.data/scripts/${process.platform === "win32" ? "uv.exe" : "uv"}`);
    if (!entry) throw Error("Python bootstrap binary missing from verified wheel");
    await mkdir(dirname(uv), { recursive: true });
    await writeFile(uv + ".part", await entry.async("nodebuffer"));
    await chmod(uv + ".part", 493);
    await rename(uv + ".part", uv);
  }
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(root2, "python"), UV_CACHE_DIR: join(root2, "uv-cache"), CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", ROCR_VISIBLE_DEVICES: "" };
  await run(uv, ["python", "install", "3.12.15", "--no-bin"], env);
  await run(uv, ["venv", "--python", "3.12.15", join(root2, "venv")], env);
  await access(python);
  return python;
}
var init_private_python = __esm({
  "src/knowledge/private-python.ts"() {
    "use strict";
    init_net();
  }
});

// src/knowledge/structure-process.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
var StructureProcess;
var init_structure_process = __esm({
  "src/knowledge/structure-process.ts"() {
    "use strict";
    StructureProcess = class {
      constructor(command, args, env, prefix = "DSH_STRUCTURE_RESULT ") {
        this.command = command;
        this.args = args;
        this.env = env;
        this.prefix = prefix;
      }
      child;
      closing = /* @__PURE__ */ new Set();
      pending;
      get label() {
        return this.prefix === "DSH_EMBED_RESULT " ? "Embedding" : this.prefix === "DSH_OCR_RESULT " ? "OCR" : "PP-StructureV3";
      }
      sequence = 0;
      log = "";
      stop(error) {
        const child = this.child;
        this.child = void 0;
        const pending = this.pending;
        this.pending = void 0;
        pending?.reject(error);
        if (child) {
          this.closing.add(child);
          child.once("exit", () => this.closing.delete(child));
          child.kill("SIGKILL");
        }
      }
      start() {
        if (this.child) return this.child;
        const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"], env: this.env, windowsHide: true });
        this.child = child;
        this.log = "";
        child.unref();
        child.stderr.on("data", (data) => {
          this.log = (this.log + data.toString()).slice(-6e3);
        });
        child.stdin.on("error", (error) => {
          if (this.child === child) this.stop(error);
        });
        const lines = createInterface({ input: child.stdout });
        lines.on("line", (line) => {
          if (this.child !== child || !line.startsWith(this.prefix)) return;
          try {
            const result = JSON.parse(line.slice(this.prefix.length));
            const pending = this.pending;
            if (!pending || result.id !== pending.id) return;
            this.pending = void 0;
            if (result.ok === true) pending.resolve(result);
            else pending.reject(new Error(`${this.label} inference failed: ${String(result.error ?? "unknown error").slice(0, 1e3)}`));
          } catch {
            this.stop(new Error(`Invalid ${this.label} worker response`));
          }
        });
        child.once("error", (error) => {
          if (this.child === child) this.stop(error);
        });
        child.once("close", () => {
          lines.close();
          if (this.child === child) this.stop(new Error(`${this.label} worker exited: ${this.log}`));
        });
        return child;
      }
      async run(input, output2, charts, timeout, signal) {
        await this.request({ input, output: output2, charts }, timeout, signal);
      }
      request(payload, timeout, signal) {
        signal?.throwIfAborted();
        if (this.pending) return Promise.reject(new Error(`${this.label} worker is busy`));
        return new Promise((resolve2, reject) => {
          const id = ++this.sequence;
          const timer = setTimeout(() => this.stop(new Error(`${this.label} timed out`)), timeout);
          const abort = () => this.stop(new Error(`${this.label} request canceled`));
          const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
          };
          this.pending = { id, resolve: (result) => {
            cleanup();
            resolve2(result);
          }, reject: (error) => {
            cleanup();
            reject(error);
          } };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            this.start().stdin.write(JSON.stringify({ ...payload, id }) + "\n", (error) => {
              if (error) this.stop(error);
            });
          } catch (error) {
            this.stop(error instanceof Error ? error : new Error(String(error)));
          }
        });
      }
      get pid() {
        return this.child?.pid;
      }
      async stopAndWait() {
        const children2 = new Set(this.closing);
        if (this.child) children2.add(this.child);
        const closed = [...children2].map((child) => new Promise((resolve2, reject) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve2();
            return;
          }
          const done = () => {
            clearTimeout(timer);
            resolve2();
          };
          const timer = setTimeout(() => {
            child.removeListener("exit", done);
            reject(new Error("Inference worker did not release its device"));
          }, 1e4);
          child.once("exit", done);
        }));
        this.stop(new Error("Background inference yielded to foreground work"));
        await Promise.all(closed);
      }
      dispose() {
        this.stop(new Error("Knowledge plugin stopped"));
      }
    };
  }
});

// src/knowledge/resource-policy.ts
import { execFile as execFile3 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
import { uptime } from "node:os";
async function desktopIdle() {
  try {
    if (process.platform === "linux") {
      const { stdout } = await exec2("loginctl", ["list-sessions", "--no-legend", "--no-pager"], { timeout: 2e3 });
      const sessions = stdout.split("\n").map((row) => row.trim().split(/\s+/)).filter((row) => row[1] === String(process.getuid?.()));
      const idle = [];
      for (const session of sessions) {
        const { stdout: detail } = await exec2("loginctl", ["show-session", session[0], "-p", "Type", "-p", "Remote", "-p", "State", "-p", "IdleHint", "-p", "IdleSinceHintMonotonic"], { timeout: 2e3 });
        const fields = Object.fromEntries(detail.trim().split("\n").map((line) => line.split("=")));
        if (!["wayland", "x11"].includes(fields.Type) || fields.Remote !== "no" || fields.State === "closing") continue;
        if (fields.IdleHint !== "yes") return { idleSeconds: 0, reason: "An interactive desktop is active" };
        const since = Number(fields.IdleSinceHintMonotonic);
        if (!Number.isFinite(since) || since <= 0) return { idleSeconds: null, reason: "Idle timestamp unavailable" };
        idle.push(Math.max(0, uptime() - since / 1e6));
      }
      return { idleSeconds: idle.length ? Math.min(...idle) : null, reason: idle.length ? "All local graphical sessions are idle" : "No verifiable graphical session" };
    }
    if (process.platform === "win32") {
      const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class DshIdle { [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; } [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO p); public static double Seconds() { var p=new LASTINPUTINFO(); p.cbSize=(uint)Marshal.SizeOf(p); if(!GetLastInputInfo(ref p)) throw new Exception("Idle probe failed"); return unchecked((uint)Environment.TickCount-p.dwTime)/1000.0; } }'; [DshIdle]::Seconds()`;
      const { stdout } = await exec2("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { timeout: 4e3, windowsHide: true });
      const seconds = Number(stdout.trim());
      return { idleSeconds: Number.isFinite(seconds) && seconds >= 0 ? seconds : null, reason: "Windows last-input timestamp" };
    }
  } catch {
  }
  return { idleSeconds: null, reason: "Idle detection is unavailable; using CPU/Intel devices" };
}
var exec2;
var init_resource_policy = __esm({
  "src/knowledge/resource-policy.ts"() {
    "use strict";
    exec2 = promisify2(execFile3);
  }
});

// src/knowledge/embedding-acceleration.ts
import { availableParallelism as availableParallelism4, freemem as freemem3 } from "node:os";
import { readFile as readFile2 } from "node:fs/promises";
import { join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
import { spawn as spawn2, execFile as execFile4 } from "node:child_process";
import { promisify as promisify3 } from "node:util";
var FP16_EMBEDDING_MODEL, OPENVINO_EMBEDDING_MODEL, script, exec3, pause, EmbeddingAcceleration, embeddingAcceleration, embeddingFp16Acceleration;
var init_embedding_acceleration = __esm({
  "src/knowledge/embedding-acceleration.ts"() {
    "use strict";
    init_structure_cpu_budget();
    init_background_gpu();
    init_embedding_device_availability();
    init_embedding_batcher();
    init_embedding_tuning();
    init_owned_process();
    init_private_python();
    init_structure_process();
    init_resource_policy();
    FP16_EMBEDDING_MODEL = "dsh-local/Qwen3-Embedding-0.6B-FP16-Accelerated";
    OPENVINO_EMBEDDING_MODEL = "OpenVINO/Qwen3-Embedding-0.6B-int8-ov";
    script = (name) => fileURLToPath4(new URL(`../../scripts/${name}`, import.meta.url));
    exec3 = promisify3(execFile4);
    pause = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
    EmbeddingAcceleration = class {
      constructor(fp16 = false) {
        this.fp16 = fp16;
        this.registerDevices();
      }
      unregisterDevices;
      registerDevices() {
        this.unregisterDevices ??= registerBackgroundDevices(() => this.lanes.flatMap((lane) => [lane.worker.pid, ...(lane.extraWorkers ?? []).map((worker) => worker.pid)]));
      }
      activeIndexBatches = 0;
      indexCpuAvailable = () => true;
      setIndexCpuAvailability(available) {
        this.indexCpuAvailable = available;
      }
      cache = "";
      lanes = [];
      ready;
      setup;
      setupChild;
      intelAvailability = new IntelEmbeddingAvailability();
      lastIndexUse = 0;
      used = false;
      foreground = 0;
      igpuReservations = 0;
      timer;
      checking = false;
      polling = false;
      stopped = false;
      npuRevalidation;
      npuRecoveryLane;
      warming;
      warmed = false;
      reference;
      gpuRetryAt = /* @__PURE__ */ new Map();
      igpuAllowed = true;
      mainGpuAllowed = true;
      mainGpuCopies = 1;
      gpuTried = /* @__PURE__ */ new Set();
      threads = 8;
      cpuInstances = 1;
      tuningKey = "";
      needsReload = false;
      configure(cache, options = {}) {
        if (this.cache && this.cache !== cache) {
          this.release();
          this.gpuTried.clear();
          this.ready = void 0;
        }
        this.cache = cache;
        this.stopped = false;
        this.registerDevices();
        const tuning = resolveEmbeddingCpuTuning({ threads: options.localEmbeddingThreads, instances: options.localEmbeddingInstances }, availableParallelism4(), freemem3());
        const key = JSON.stringify([tuning.threads, tuning.instances]);
        if (this.tuningKey && key !== this.tuningKey) this.needsReload = true;
        this.tuningKey = key;
        this.threads = tuning.threads;
        this.cpuInstances = tuning.instances;
        this.igpuAllowed = options.localEmbeddingIgpuIdle !== false;
        this.mainGpuAllowed = options.localEmbeddingMainGpuIdle !== false;
      }
      get snapshot() {
        return this.ready ?? { status: "not_installed", message: "OpenVINO embedding is not installed", devices: [] };
      }
      root() {
        return join2(this.cache, this.fp16 ? "embedding-fp16-accelerators" : "embedding-accelerators");
      }
      models() {
        return this.fp16 ? join2(this.root(), "models") : join2(this.root(), "models", "qwen3-openvino-int8");
      }
      runtime() {
        return join2(this.cache, "ocr-accelerators");
      }
      python() {
        return join2(this.runtime(), "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      }
      environment(main = false) {
        const root2 = this.runtime(), libraries = join2(root2, "intel/usr/lib/x86_64-linux-gnu");
        const env = { ...process.env, CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", ROCR_VISIBLE_DEVICES: "", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
        if (main && this.fp16) delete env.CUDA_VISIBLE_DEVICES;
        if (process.platform === "linux") {
          env.LD_LIBRARY_PATH = [libraries, join2(libraries, "intel-opencl"), join2(root2, "intel/usr/local/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
          env.ZE_ENABLE_ALT_DRIVERS = join2(libraries, "libze_intel_npu.so.1");
          if (main && this.fp16) delete env.CUDA_VISIBLE_DEVICES;
          if (main && this.fp16) env.LD_LIBRARY_PATH = [join2(this.cache, "embedding-gpu-runtime", "venv", "lib", "python3.12", "site-packages", "nvidia", "cublas", "lib"), join2(this.cache, "embedding-gpu-runtime", "venv", "lib", "python3.12", "site-packages", "nvidia", "cu13", "lib"), join2(this.cache, "embedding-gpu-runtime", "venv", "lib", "python3.12", "site-packages", "nvidia", "cudnn", "lib"), env.LD_LIBRARY_PATH].join(":");
          if (!main) env.OCL_ICD_VENDORS = join2(root2, "icd");
          else delete env.OCL_ICD_VENDORS;
        }
        return env;
      }
      lane(device, ms, main = false, threadLimit = this.threads) {
        const cpuThreads = device === "CPU" && this.foreground ? Math.min(8, threadLimit) : threadLimit;
        const python = this.fp16 && main ? join2(this.cache, "embedding-gpu-runtime", "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python") : this.python();
        const makeWorker = () => new StructureProcess(python, [script(this.fp16 ? "embedding-fp16-worker.py" : "embedding-accelerator-worker.py"), "--models", this.models(), "--device", this.fp16 && main ? "CUDA" : device, "--threads", String(cpuThreads), ...device.startsWith("GPU") ? ["--vendor", main ? "nvidia" : "intel"] : []], this.environment(main), "DSH_EMBED_RESULT ");
        const worker = makeWorker();
        const lane = { cpuThreads, device, pending: 0, enabled: true, milliseconds: ms, tail: Promise.resolve(), worker };
        lane.extraWorkers = this.fp16 && main ? Array.from({ length: this.mainGpuCopies - 1 }, makeWorker) : [];
        const workers = [worker, ...lane.extraWorkers];
        lane.jobs = /* @__PURE__ */ new Set();
        lane.batcher = new EmbeddingBatcher(async (texts) => {
          const rowsPerWorker = Math.ceil(texts.length / workers.length);
          const results = await Promise.all(workers.slice(0, texts.length).map((current, index) => current.request(this.fp16 && main ? { texts: texts.slice(index * rowsPerWorker, (index + 1) * rowsPerWorker) } : { text: texts[0] }, 12e4)));
          const vectors = results.flatMap((result) => this.fp16 && main ? result.vectors : [result.vector]);
          if (!Array.isArray(vectors)) throw new Error("Invalid embedding vectors");
          return { vectors, elapsedMs: Math.max(...results.map((result) => typeof result.elapsedMs === "number" ? result.elapsedMs : 100)) };
        }, this.fp16 && main ? 16 * workers.length : 1);
        return lane;
      }
      runtimeDevices() {
        return ["CPU", "NPU", "GPU:intel", "GPU:main"].map((device) => {
          const lanes = this.lanes.filter((lane) => lane.device === device), record = this.ready?.devices.find((row) => row.device === device);
          const activeTasks = lanes.reduce((sum, lane) => sum + lane.pending, 0), enabled = lanes.some((lane) => lane.enabled && lane.qualified !== false);
          const state = activeTasks > 0 ? "running" : enabled ? "ready" : record?.qualified === false ? "unavailable" : "waiting";
          return { device, activeTasks, state, reason: activeTasks > 0 ? "Processing queued embedding inputs" : this.foreground && device.startsWith("GPU:") ? "Reserved for foreground inference" : record?.error ?? record?.blockedReason ?? (enabled ? `Waiting for compatible embedding inputs${record?.maxTokens ? ` (up to ${record.maxTokens} tokens)` : ""}` : "Waiting for model qualification or device admission") };
        });
      }
      async status() {
        if (this.stopped) return { status: "not_installed", message: "Embedding workers are stopped", devices: [] };
        if (this.needsReload && !this.lanes.some((l) => l.pending)) {
          this.release();
          this.ready = void 0;
          this.needsReload = false;
        }
        if (this.ready) return this.ready;
        try {
          const root2 = this.root();
          const receipt = JSON.parse(await readFile2(join2(root2, "ready.json"), "utf8"));
          if (receipt.schema !== 1 || this.fp16 && receipt.format !== "canonical-fp16-v1" || receipt.modelId !== (this.fp16 ? FP16_EMBEDDING_MODEL : OPENVINO_EMBEDDING_MODEL) || !receipt.devices.some((d) => d.device === "CPU" && d.qualified)) throw Error("Missing qualified CPU fallback");
          if (this.ready) return this.ready;
          if (this.stopped || root2 !== this.root()) return { status: "not_installed", message: "Embedding configuration changed", devices: [] };
          this.lanes = receipt.devices.filter((d) => d.qualified && ["CPU", "NPU"].includes(d.device)).flatMap((d) => Array.from({ length: d.device === "CPU" ? this.cpuInstances : 1 }, () => this.lane(d.device, d.medianMs ?? 150)));
          if (this.foreground) {
            for (const lane of [...this.lanes.filter((lane2) => lane2.device === "CPU").slice(1), ...this.lanes.filter((lane2) => lane2.device === "NPU")]) {
              lane.enabled = false;
              lane.batcher?.pause();
            }
          }
          this.ready = { status: "ready", message: this.fp16 ? "One FP16 vector space across CPU, NPU, Intel iGPU and optional NVIDIA CUDA. GPU workers yield for foreground inference." : "OpenVINO CPU/NPU model; separate vector space from the ONNX model. GPU workers require verified idle state and matching vectors.", devices: receipt.devices };
          return this.ready;
        } catch {
          return { status: "not_installed", message: "Download and validate the separate OpenVINO embedding model to enable NPU execution.", devices: [] };
        }
      }
      async command(args, command = this.python(), env = this.environment()) {
        await new Promise((resolve2, reject) => {
          const child = spawn2(command, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
          this.setupChild = child;
          let log = "";
          const timer = setTimeout(() => stopOwnedProcess(child), 72e5);
          timer.unref?.();
          child.stdout.on("data", (data) => {
            log = (log + String(data)).slice(-2e3);
          });
          child.stderr.on("data", (data) => {
            log = (log + String(data)).slice(-2e3);
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("close", (code) => {
            clearTimeout(timer);
            this.setupChild = void 0;
            code === 0 ? resolve2() : reject(Error(log || "Embedding setup failed"));
          });
        });
      }
      async prepare() {
        if (this.setup) return this.ready;
        this.ready = { status: "installing", message: "Installing private runtime, pinned weights, and CPU/NPU validation. No global packages are changed.", devices: [] };
        this.setup = (async () => {
          const python = await ensurePrivatePython(this.runtime(), (command, args, env) => this.command(args, command, env));
          await this.command([script(this.fp16 ? "setup-embedding-fp16.py" : "setup-embedding-accelerators.py"), this.cache], python);
          await this.command([script(this.fp16 ? "embedding-fp16-worker.py" : "embedding-accelerator-worker.py"), "--models", this.models(), "--calibrate", "--threads", String(this.threads)]);
          this.release();
          this.gpuTried.clear();
          this.ready = void 0;
          await this.status();
        })().catch((error) => {
          this.ready = { status: "error", message: String(error), devices: [] };
        }).finally(() => {
          this.setup = void 0;
        });
        return this.ready;
      }
      async run(lane, text, purpose = "index") {
        lane.pending++;
        if (lane.batcher) {
          if (!lane.enabled) {
            lane.pending--;
            throw Error("Embedding device yielded");
          }
          const job2 = lane.batcher.request(text, purpose, purpose === "query" && lane.device === "NPU" ? 250 : void 0).then((result) => {
            if (result.vector.length !== 1024 || result.vector.some((v) => !Number.isFinite(v)) || Math.abs(Math.hypot(...result.vector) - 1) > 1e-3) throw Error("Invalid embedding vector");
            lane.milliseconds = Math.max(1, result.elapsedMs);
            return result.vector;
          }).catch((error) => {
            if (!lane.enabled) throw Error("Embedding device yielded");
            throw error;
          });
          lane.jobs.add(job2);
          lane.current = Promise.allSettled([...lane.jobs]);
          try {
            return await job2;
          } finally {
            lane.pending--;
            lane.jobs.delete(job2);
          }
        }
        const job = lane.tail.then(async () => {
          if (this.stopped || !lane.enabled) throw Error("Embedding device yielded");
          const promise = lane.worker.request({ text }, 12e4);
          lane.current = promise;
          try {
            const result = await promise;
            const vector = result.vector;
            if (!Array.isArray(vector) || vector.length !== 1024 || vector.some((v) => typeof v !== "number" || !Number.isFinite(v)) || Math.abs(Math.hypot(...vector) - 1) > 1e-3) throw Error("Invalid OpenVINO vector");
            if (typeof result.elapsedMs === "number") lane.milliseconds = Math.max(1, result.elapsedMs);
            return vector;
          } finally {
            lane.current = void 0;
          }
        });
        lane.tail = job.catch(() => {
        });
        try {
          return await job;
        } finally {
          lane.pending--;
        }
      }
      async warm() {
        if (this.warmed) return;
        if (this.warming) return this.warming;
        this.warming = (async () => {
          if ((await this.status()).status !== "ready") throw Error("Embedding model is not installed and validated");
          const text = "A telescope collects light from distant stars and records scientific observations. ".repeat(10);
          await Promise.all(this.lanes.filter((l) => l.enabled && !l.device.startsWith("GPU")).map(async (lane) => {
            try {
              await this.run(lane, text);
              await this.run(lane, text);
            } catch (error) {
              if (lane.device === "CPU") throw error;
              lane.enabled = false;
              lane.qualified = false;
              lane.batcher?.pause();
              lane.worker.dispose();
              this.gpuRetryAt.set(lane.device, Date.now() + 6e4);
              const state = this.ready?.devices.find((d) => d.device === lane.device);
              if (state) {
                state.qualified = false;
                state.error = `Device warmup failed; CPU fallback active: ${String(error).slice(-1500)}`;
              }
            }
          }));
          this.warmed = true;
        })().finally(() => {
          this.warming = void 0;
        });
        return this.warming;
      }
      async yieldMainGpu() {
        await Promise.all(this.lanes.filter((lane) => lane.device === "GPU:main").map((lane) => this.stopGpu(lane)));
      }
      async embed(texts, purpose = "index") {
        if ((await this.status()).status !== "ready") throw Error("OpenVINO embedding model is not installed and validated");
        this.used = true;
        if (!this.timer) {
          this.timer = setInterval(() => {
            void this.updateGpus();
          }, 1e3);
          this.timer.unref?.();
        }
        if (purpose === "index") {
          this.activeIndexBatches++;
          this.lastIndexUse = Date.now();
        }
        try {
          if (purpose === "index") {
            void this.updateGpus();
            await this.warm();
          }
          return await Promise.all(texts.map(async (text) => {
            let chosen;
            while (!chosen) {
              if (this.stopped) throw Error("Embedding worker stopped");
              const cpuLanes = this.lanes.filter((l) => l.device === "CPU" && l.enabled && l.qualified !== false).slice(0, embeddingCpuLaneLimit(availableParallelism4(), this.threads));
              const eligible = this.lanes.filter((l) => (l.device !== "CPU" || cpuLanes.includes(l) && (purpose === "query" || this.indexCpuAvailable())) && l.enabled && l.qualified !== false && (!l.device.startsWith("GPU") || purpose === "index" && !this.foreground && !this.igpuReservations));
              if (!eligible.length) {
                if (purpose === "index" && !this.indexCpuAvailable()) {
                  await pause(20);
                  continue;
                }
                throw Error("No embedding device is available");
              }
              const choices = eligible.filter((l) => purpose === "query" || l.pending < (l.device === "GPU:main" && this.fp16 ? 32 * (1 + (l.extraWorkers?.length ?? 0)) : 1)).sort((a, b) => {
                if (purpose === "query" && a.pending === 0 !== (b.pending === 0)) return a.pending === 0 ? -1 : 1;
                const ap = purpose === "query" && a.device === "NPU", bp = purpose === "query" && b.device === "NPU";
                return ap !== bp ? ap ? -1 : 1 : (a.pending + 1) * a.milliseconds - (b.pending + 1) * b.milliseconds;
              });
              chosen = choices[0];
              if (!chosen) await Promise.race(eligible.map((l) => l.current ?? l.tail)).catch(() => {
              });
            }
            try {
              return await this.run(chosen, text, purpose);
            } catch (error) {
              if (chosen.device === "CPU" && !String(error).includes("yield")) throw error;
              if (chosen.device !== "CPU" && !(error instanceof EmbeddingQueueTimeout) && !String(error).includes("NPU_LONG_INPUT") && !String(error).includes("IGPU_LONG_INPUT") && !String(error).includes("yield")) {
                chosen.enabled = false;
                chosen.qualified = false;
                chosen.batcher?.pause();
                chosen.worker.dispose();
                chosen.extraWorkers?.forEach((worker) => worker.dispose());
                this.gpuRetryAt.set(chosen.device.startsWith("GPU:") ? chosen.device.slice(4) : chosen.device, Date.now() + 6e4);
                const state = this.ready?.devices.find((d) => d.device === chosen.device);
                if (state) {
                  state.qualified = false;
                  state.error = `Device failed at runtime; CPU fallback active: ${String(error).slice(-1500)}`;
                }
                if (chosen.device.startsWith("GPU")) {
                  this.lanes = this.lanes.filter((lane) => lane !== chosen);
                  this.gpuTried.delete(chosen.device.slice(4));
                }
              }
              const lengthFallback = /(?:NPU|IGPU)_LONG_INPUT/.test(String(error));
              while (!this.stopped) {
                if (lengthFallback && purpose === "index" && !this.foreground && !this.igpuReservations) {
                  const gpu = this.lanes.find((l) => l.device === "GPU:main" && l.enabled && l.qualified !== false && l.pending < (this.fp16 ? 32 * (1 + (l.extraWorkers?.length ?? 0)) : 1));
                  if (gpu) {
                    try {
                      return await this.run(gpu, text, purpose);
                    } catch (failure) {
                      if (!String(failure).includes("yield")) {
                        gpu.enabled = false;
                        gpu.qualified = false;
                        gpu.batcher?.pause();
                        gpu.worker.dispose();
                        gpu.extraWorkers?.forEach((worker) => worker.dispose());
                        this.lanes = this.lanes.filter((lane) => lane !== gpu);
                        this.gpuTried.delete("main");
                        this.gpuRetryAt.set("main", Date.now() + 6e4);
                        const state = this.ready?.devices.find((device) => device.device === "GPU:main");
                        if (state) {
                          state.qualified = false;
                          state.error = `CUDA length fallback failed; CPU recovery active: ${String(failure).slice(-1500)}`;
                        }
                      }
                    }
                  }
                }
                if (purpose === "index" && !this.indexCpuAvailable()) {
                  const gpu = this.lanes.find((l) => l.device === "GPU:main" && l.enabled && l.qualified !== false && !this.foreground && l.pending < 32);
                  if (gpu) return await this.run(gpu, text, purpose);
                  await pause(20);
                  continue;
                }
                const cpu = this.lanes.filter((l) => l.device === "CPU" && l.enabled && l.qualified !== false).slice(0, embeddingCpuLaneLimit(availableParallelism4(), this.threads)).find((l) => l.enabled && l.qualified !== false && l.pending < 1);
                if (!cpu) {
                  await pause(5);
                  continue;
                }
                try {
                  return await this.run(cpu, text, purpose);
                } catch (fallback) {
                  if (!String(fallback).includes("yield")) throw fallback;
                }
              }
              throw Error("Embedding worker stopped");
            }
          }));
        } finally {
          if (purpose === "index") {
            this.activeIndexBatches--;
            this.lastIndexUse = Date.now();
          }
        }
      }
      async revalidateNpu() {
        if (this.npuRevalidation || this.stopped || this.foreground) return;
        const failed = this.lanes.find((lane) => lane.device === "NPU" && !lane.enabled);
        const cpu = this.lanes.find((lane) => lane.device === "CPU" && lane.enabled);
        if (!failed || !cpu || (this.gpuRetryAt.get("NPU") ?? 0) > Date.now()) return;
        this.npuRevalidation = (async () => {
          const candidate = this.lane("NPU", failed.milliseconds);
          this.npuRecoveryLane = candidate;
          const text = "A telescope collects light from distant stars.";
          try {
            const [reference, vector] = await Promise.all([this.run(cpu, text, "query"), this.run(candidate, text, "query")]);
            const cosine = reference.reduce((sum, value, index) => sum + value * vector[index], 0);
            if (cosine < 0.995) throw Error("NPU recovery vectors did not match CPU reference");
            if (this.stopped || this.foreground || !this.lanes.includes(failed)) throw Error("NPU recovery yielded during plugin disposal");
            candidate.qualified = true;
            this.lanes[this.lanes.indexOf(failed)] = candidate;
            const state = this.ready?.devices.find((device) => device.device === "NPU");
            if (state) {
              state.qualified = true;
              state.minimumCosine = cosine;
              state.medianMs = candidate.milliseconds;
              delete state.error;
            }
            this.gpuRetryAt.delete("NPU");
          } catch (error) {
            candidate.batcher?.pause();
            candidate.worker.dispose();
            this.gpuRetryAt.set("NPU", Date.now() + 3e5);
            const state = this.ready?.devices.find((device) => device.device === "NPU");
            if (state) state.error = `NPU revalidation failed; CPU fallback active: ${String(error).slice(-1500)}`;
          }
        })().finally(() => {
          this.npuRevalidation = void 0;
          this.npuRecoveryLane = void 0;
        });
        await this.npuRevalidation;
      }
      async stopGpu(lane) {
        lane.enabled = false;
        lane.batcher?.pause();
        let timer;
        try {
          await Promise.race([lane.current ?? Promise.resolve(), new Promise((resolve2) => {
            timer = setTimeout(resolve2, 1e4);
          })]).catch(() => {
          });
        } finally {
          if (timer) clearTimeout(timer);
          await Promise.all([lane.worker, ...lane.extraWorkers ?? []].map((worker) => worker.stopAndWait()));
        }
      }
      async enterForeground(yieldIgpu = false) {
        this.foreground++;
        if (yieldIgpu) this.igpuReservations++;
        const cpus = this.lanes.filter((lane) => lane.device === "CPU"), first = cpus[0];
        try {
          await Promise.all(this.lanes.filter((lane) => lane.device.startsWith("GPU:") || lane.device === "CPU" && lane !== first).map((lane) => this.stopGpu(lane)));
          if (first && (first.cpuThreads ?? this.threads) > 8) {
            await this.stopGpu(first);
            const replacement = this.lane("CPU", first.milliseconds, false, 8);
            this.lanes[this.lanes.indexOf(first)] = replacement;
          }
        } catch (error) {
          this.foreground--;
          if (yieldIgpu) this.igpuReservations--;
          throw error;
        }
        let done = false;
        return () => {
          if (!done) {
            done = true;
            this.foreground--;
            if (yieldIgpu) this.igpuReservations--;
            if (!this.foreground) for (const lane of this.lanes.filter((lane2) => ["CPU", "NPU"].includes(lane2.device) && lane2.qualified !== false)) {
              lane.enabled = true;
              lane.batcher?.resume();
            }
          }
        };
      }
      async updateGpus() {
        if (this.stopped || !this.used || this.ready?.status !== "ready") return;
        if (this.activeIndexBatches > 0) void this.revalidateNpu();
        knowledgeGpuAdmission.request(this, this.mainGpuAllowed && !this.foreground && (this.activeIndexBatches > 0 || this.lanes.some((lane) => lane.pending > 0)));
        if (this.polling) return;
        this.polling = true;
        const decisions = /* @__PURE__ */ new Map();
        try {
          const idle = await desktopIdle();
          const desktopAvailable = idle.idleSeconds !== null && Number.isFinite(idle.idleSeconds) && idle.idleSeconds >= 300;
          const owned = () => new Set(this.lanes.flatMap((l) => [l.worker, ...l.extraWorkers ?? []]).map((worker) => worker.pid).filter((pid) => pid !== void 0));
          for (const main of [false, true]) {
            let decision = { available: desktopAvailable, reason: desktopAvailable ? "Desktop is idle" : "Waiting for desktop idle" };
            if (this.fp16) {
              if (main) {
                decision = knowledgeGpuAdmission.allowed ? await nvidiaEmbeddingAvailability(owned) : { available: false, reason: "Waiting for shared GPU admission" };
                if (process.platform !== "linux" && !desktopAvailable) decision = { available: false, reason: "Waiting for verified desktop idle" };
              } else if (process.platform === "linux") decision = await this.intelAvailability.sample(owned());
            }
            if (main ? !this.mainGpuAllowed : !this.igpuAllowed) decision = { available: false, reason: "Disabled in embedding settings" };
            if (this.stopped || (this.foreground || !main && this.igpuReservations)) decision.available = false;
            if (!this.activeIndexBatches && !this.lanes.some((l) => l.device.startsWith("GPU") && l.pending > 0) && Date.now() - this.lastIndexUse >= 1e4 && knowledgeGpuAdmission.hasOtherDemand(this)) decision = { available: false, reason: "Yielding idle embedding memory to another Knowledge stage" };
            decisions.set(main, decision);
            const current = this.lanes.find((l) => l.device === `GPU:${main ? "main" : "intel"}`);
            if (!decision.available && current?.enabled) await this.stopGpu(current);
          }
        } finally {
          this.polling = false;
        }
        if (this.checking || this.stopped) return;
        this.checking = true;
        try {
          for (const main of [true, false]) {
            const key = main ? "main" : "intel", device = `GPU:${key}`;
            const existing = this.lanes.find((l) => l.device === device);
            const decision = decisions.get(main);
            let available = decision.available, reason = decision.reason;
            if (this.stopped || (this.foreground || !main && this.igpuReservations)) available = false;
            let state = this.ready?.devices.find((d) => d.device === device || !main && d.device === "GPU");
            if (!state) {
              state = { device, name: main ? "NVIDIA GPU" : "Intel iGPU", qualified: false };
              this.ready.devices.push(state);
            }
            state.blockedReason = available ? void 0 : reason;
            if (!available) {
              if (existing?.enabled) await this.stopGpu(existing);
              continue;
            }
            if (main && !this.fp16) {
              try {
                const { stdout } = await exec3("nvidia-smi", ["--query-compute-apps=pid", "--format=csv,noheader,nounits"], { timeout: 2e3 });
                if (stdout.split(/\s+/).filter(Boolean).some((pid) => Number(pid) !== existing?.worker.pid)) {
                  if (existing?.enabled) await this.stopGpu(existing);
                  continue;
                }
              } catch {
                continue;
              }
            }
            if (existing) {
              existing.enabled = true;
              existing.batcher?.resume();
              continue;
            }
            if (!this.activeIndexBatches) {
              state.blockedReason = "Waiting for embedding work";
              continue;
            }
            if (this.gpuTried.has(key) || (this.gpuRetryAt.get(key) ?? 0) > Date.now()) continue;
            this.gpuTried.add(key);
            if (main && this.fp16) this.mainGpuCopies = (decision.freeMiB ?? 0) >= 8192 ? 2 : 1;
            const candidate = this.lane("GPU", main ? 50 : 200, main);
            candidate.device = device;
            candidate.qualified = false;
            this.lanes.push(candidate);
            try {
              const texts = ["A telescope collects light from distant stars.", "An invoice is required before expense reimbursement. ".repeat(12), "Ocean temperatures influence weather and climate. ".repeat(40)];
              const cpu = this.lanes.find((l) => l.device === "CPU");
              this.reference ??= Promise.all(texts.map((text) => this.run(cpu, text, "query")));
              const [references, vectors] = await Promise.all([this.reference, Promise.all(texts.map((text) => this.run(candidate, text)))]);
              if (this.stopped || (this.foreground || !main && this.igpuReservations) || !candidate.enabled) throw Error("Embedding device yielded during validation");
              let cosine = Math.min(...references.map((a, index) => a.reduce((sum, v, i) => sum + v * vectors[index][i], 0)));
              if (main && this.fp16) {
                const warmInputs = texts.flatMap((text) => Array.from({ length: 32 }, () => text));
                const warm = await Promise.all(warmInputs.map((text) => this.run(candidate, text)));
                cosine = Math.min(cosine, ...warm.map((b, index) => references[Math.floor(index / 32)].reduce((sum, v, i) => sum + v * b[i], 0)));
              }
              if (state) state.minimumCosine = cosine;
              if (cosine < 0.995) throw Error(`GPU embedding vectors did not match CPU reference (minimum cosine ${cosine.toFixed(8)})`);
              candidate.qualified = true;
              const result = { device, name: main ? `NVIDIA GPU (${this.mainGpuCopies} worker${this.mainGpuCopies > 1 ? "s" : ""}, available only)` : "Intel iGPU (available only)", qualified: true, minimumCosine: cosine, medianMs: candidate.milliseconds };
              if (state) {
                Object.assign(state, result);
                delete state.error;
                delete state.blockedReason;
              } else this.ready.devices.push(result);
            } catch (error) {
              await this.stopGpu(candidate);
              this.lanes = this.lanes.filter((l) => l !== candidate);
              if (String(error).includes("yield")) {
                this.gpuTried.delete(key);
                this.gpuRetryAt.set(key, Date.now() + 15e3);
              } else {
                this.gpuTried.delete(key);
                this.gpuRetryAt.set(key, Date.now() + 3e5);
                if (state) Object.assign(state, { qualified: false, error: String(error) });
                else this.ready?.devices.push({ device, qualified: false, error: String(error) });
              }
            }
          }
        } finally {
          this.checking = false;
        }
      }
      async remove() {
        this.dispose();
        const { rm: rm2 } = await import("node:fs/promises");
        await rm2(this.root(), { recursive: true, force: true });
        this.ready = void 0;
        this.stopped = false;
      }
      release() {
        this.ready = void 0;
        this.npuRecoveryLane?.batcher?.pause();
        this.npuRecoveryLane?.worker.dispose();
        this.warmed = false;
        this.reference = void 0;
        for (const lane of this.lanes) {
          lane.batcher?.pause();
          lane.worker.dispose();
          lane.extraWorkers?.forEach((worker) => worker.dispose());
        }
        this.lanes = [];
      }
      dispose() {
        knowledgeGpuAdmission.request(this, false);
        this.unregisterDevices?.();
        this.unregisterDevices = void 0;
        this.stopped = true;
        if (this.timer) clearInterval(this.timer);
        this.timer = void 0;
        this.setupChild && stopOwnedProcess(this.setupChild);
        this.release();
      }
    };
    embeddingAcceleration = new EmbeddingAcceleration();
    embeddingFp16Acceleration = new EmbeddingAcceleration(true);
  }
});

// src/knowledge/local-model-runtime.ts
var LOCAL_MODEL_RUNTIME;
var init_local_model_runtime = __esm({
  "src/knowledge/local-model-runtime.ts"() {
    "use strict";
    LOCAL_MODEL_RUNTIME = Object.freeze({
      transformers: "4.3.1",
      onnxruntime: "1.30.0"
    });
  }
});

// src/knowledge/rerank-protocol.ts
var init_rerank_protocol = __esm({
  "src/knowledge/rerank-protocol.ts"() {
    "use strict";
  }
});

// src/knowledge/local-rerank.ts
var CIRCUIT_COOLDOWN_MS;
var init_local_rerank = __esm({
  "src/knowledge/local-rerank.ts"() {
    "use strict";
    init_rerank_protocol();
    CIRCUIT_COOLDOWN_MS = 5 * 6e4;
  }
});

// src/knowledge/text-safety.ts
var init_text_safety = __esm({
  "src/knowledge/text-safety.ts"() {
    "use strict";
  }
});

// src/knowledge/embed.ts
import { homedir } from "node:os";
import { dirname as dirname2, join as join3, resolve } from "node:path";
function setLocalModelCacheDir(dir) {
  cacheDirOverride = dir !== void 0 && dir.trim() !== "" ? resolve(expandHomePath(dir.trim())) : void 0;
}
function expandHomePath(input) {
  if (input === "~") return homedir();
  if (input.startsWith("~/") || input.startsWith("~\\")) return join3(homedir(), input.slice(2));
  return input;
}
function localModelCacheDir() {
  if (cacheDirOverride !== void 0) return cacheDirOverride;
  const envHome = typeof process !== "undefined" ? process.env.DSH_HOME : void 0;
  const home = envHome !== void 0 && envHome.trim() !== "" ? resolve(expandHomePath(envHome.trim())) : join3(homedir(), ".dsh");
  return join3(home, "cache", "dsh-knowledge", "local-models");
}
var cacheDirOverride, LOCAL_WORKER_REQUEST_TIMEOUT_MS;
var init_embed = __esm({
  "src/knowledge/embed.ts"() {
    "use strict";
    init_embedding_dimensions();
    init_local_embedding_pool();
    init_embedding_acceleration();
    init_local_model_runtime();
    init_net();
    init_embed_protocol();
    init_local_rerank();
    init_text_safety();
    applyGlobalProxy();
    LOCAL_WORKER_REQUEST_TIMEOUT_MS = 30 * 6e4;
  }
});

// src/knowledge/ocr-protocol.ts
function ocrError(code, message) {
  return Object.assign(new Error(message), { code });
}
var OCR_PROTOCOL_VERSION;
var init_ocr_protocol = __esm({
  "src/knowledge/ocr-protocol.ts"() {
    "use strict";
    OCR_PROTOCOL_VERSION = 1;
  }
});

// src/knowledge/ocr-process-client.ts
import { fork as fork3 } from "node:child_process";
import { fileURLToPath as fileURLToPath5 } from "node:url";
var MAX_PENDING, EXIT_TIMEOUT_MS, OcrProcessClient;
var init_ocr_process_client = __esm({
  "src/knowledge/ocr-process-client.ts"() {
    "use strict";
    init_ocr_protocol();
    MAX_PENDING = 16;
    EXIT_TIMEOUT_MS = 1e4;
    OcrProcessClient = class {
      constructor(modulePath = fileURLToPath5(new URL("./ocr-process.mjs", import.meta.url)), timeoutMs = 5 * 6e4) {
        this.modulePath = modulePath;
        this.timeoutMs = timeoutMs;
      }
      child = null;
      children = /* @__PURE__ */ new Set();
      sequence = 0;
      disposing;
      pending = /* @__PURE__ */ new Map();
      get pendingCount() {
        return this.pending.size;
      }
      failPending(error) {
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
      }
      spawn() {
        if (this.child !== null) return this.child;
        const options = {
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          serialization: "advanced",
          execArgv: [],
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", ROCR_VISIBLE_DEVICES: "" }
        };
        const child = fork3(this.modulePath, [], options);
        this.child = child;
        this.children.add(child);
        child.unref();
        child.on("message", (value) => {
          if (this.child !== child) return;
          const message = value;
          if (message === null || typeof message !== "object" || typeof message.id !== "number") return;
          const entry = this.pending.get(message.id);
          if (entry === void 0) return;
          this.pending.delete(message.id);
          if (message.protocolVersion !== OCR_PROTOCOL_VERSION || message.operation !== "recognize") {
            entry.reject(ocrError("ocr_failed", "OCR process returned an invalid response"));
          } else if (message.ok === true && typeof message.text === "string") {
            entry.resolve(message.text);
          } else {
            entry.reject(ocrError("ocr_failed", message.ok === false && typeof message.error === "string" ? message.error : "OCR process failed"));
          }
          if (this.pending.size === 0) child.channel?.unref();
        });
        const fail = (error) => {
          if (this.child !== child) return;
          this.child = null;
          this.failPending(error);
          child.kill("SIGKILL");
        };
        child.on("error", (error) => {
          if (child.pid === void 0) this.children.delete(child);
          fail(ocrError("ocr_process_crash", `OCR process failed: ${error.message}`));
        });
        child.on("disconnect", () => fail(ocrError("ocr_process_crash", "OCR process disconnected")));
        child.on("exit", (code, signal) => {
          this.children.delete(child);
          fail(ocrError("ocr_process_crash", `OCR process exited (${signal ?? code ?? "unknown"})`));
        });
        return child;
      }
      recognize(png, modelDir) {
        if (this.disposing !== void 0) return Promise.reject(ocrError("ocr_failed", "OCR process is shutting down"));
        if (this.pending.size >= MAX_PENDING) return Promise.reject(ocrError("ocr_busy", "OCR queue is full; retry the document later"));
        return new Promise((resolve2, reject) => {
          const id = ++this.sequence;
          const timer = setTimeout(() => {
            const child = this.child;
            this.child = null;
            this.failPending(ocrError("ocr_timeout", "OCR request timed out; the isolated process was stopped"));
            child?.kill("SIGKILL");
          }, this.timeoutMs);
          this.pending.set(id, {
            resolve: (text) => {
              clearTimeout(timer);
              resolve2(text);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            }
          });
          try {
            const child = this.spawn();
            child.channel?.ref();
            child.send({ protocolVersion: OCR_PROTOCOL_VERSION, id, operation: "recognize", png, modelDir }, (error) => {
              if (error === null || this.child !== child || !this.pending.has(id)) return;
              this.child = null;
              this.failPending(ocrError("ocr_process_crash", `OCR request could not be sent: ${error.message}`));
              child.kill("SIGKILL");
            });
          } catch (error) {
            const child = this.child;
            this.child = null;
            this.failPending(ocrError("ocr_process_crash", error instanceof Error ? error.message : String(error)));
            child?.kill("SIGKILL");
          }
        });
      }
      /** Observe every owned child's exit before model files may be removed. */
      dispose() {
        if (this.disposing !== void 0) return this.disposing;
        this.child = null;
        this.failPending(ocrError("ocr_failed", "OCR process disposed"));
        this.disposing = Promise.all([...this.children].map((child) => new Promise((resolve2, reject) => {
          if (child.exitCode !== null || child.signalCode !== null || child.pid === void 0) {
            resolve2();
            return;
          }
          const timer = setTimeout(() => {
            child.off("exit", done);
            reject(new Error("OCR process did not exit; model files were not removed"));
          }, EXIT_TIMEOUT_MS);
          const done = () => {
            clearTimeout(timer);
            resolve2();
          };
          child.once("exit", done);
          child.kill("SIGKILL");
        }))).then(() => {
        }).finally(() => {
          this.disposing = void 0;
        });
        return this.disposing;
      }
    };
  }
});

// src/knowledge/ocr-pool.ts
import { availableParallelism as availableParallelism5, freemem as freemem4 } from "node:os";
function useOcrAcceleration(value) {
  acceleration = value;
}
var foreground, cpuRunning, waiters, idleCpuWorkers, pools, acceleration, OcrPool;
var init_ocr_pool = __esm({
  "src/knowledge/ocr-pool.ts"() {
    "use strict";
    init_ocr_process_client();
    foreground = 0;
    cpuRunning = 0;
    waiters = /* @__PURE__ */ new Set();
    idleCpuWorkers = Math.max(1, Math.min(4, Math.floor(availableParallelism5() / 8), Math.floor(freemem4() / 1024 ** 3)));
    pools = /* @__PURE__ */ new Set();
    OcrPool = class {
      constructor() {
        pools.add(this);
      }
      stopped = false;
      clients = [];
      cpuConcurrency = idleCpuWorkers;
      get concurrency() {
        return Math.max(this.cpuConcurrency, acceleration?.concurrency ?? 1);
      }
      async recognize(png, modelDir) {
        if (this.stopped) throw new Error("OCR pool stopped");
        const text = await acceleration?.recognize(png);
        if (this.stopped) throw new Error("OCR pool stopped");
        if (text !== void 0) return text;
        while (cpuRunning >= (foreground ? 1 : idleCpuWorkers)) {
          if (this.stopped) throw new Error("OCR pool stopped");
          await new Promise((resolve2) => {
            const wake = () => {
              waiters.delete(wake);
              resolve2();
            };
            waiters.add(wake);
          });
        }
        if (this.stopped) throw new Error("OCR pool stopped");
        cpuRunning++;
        try {
          let client = this.clients.reduce((best, next2) => !best || next2.pendingCount < best.pendingCount ? next2 : best, void 0);
          if (!client || client.pendingCount > 0 && this.clients.length < this.cpuConcurrency) {
            client = new OcrProcessClient();
            this.clients.push(client);
          }
          return await client.recognize(png, modelDir);
        } finally {
          cpuRunning--;
          for (const wake of waiters) wake();
        }
      }
      async stopFallbackWorkers() {
        const clients = this.clients;
        this.clients = [];
        await Promise.all(clients.map((client) => client.dispose()));
      }
      async dispose() {
        this.stopped = true;
        for (const wake of waiters) wake();
        pools.delete(this);
        acceleration?.releaseWorkers();
        const clients = this.clients;
        this.clients = [];
        await Promise.all(clients.map((client) => client.dispose()));
      }
    };
  }
});

// src/knowledge/ocr.ts
var ocr_exports = {};
__export(ocr_exports, {
  DEFAULT_OCR_MIRROR: () => DEFAULT_OCR_MIRROR,
  MAX_PAGE_RASTER_BYTES: () => MAX_PAGE_RASTER_BYTES,
  buildOcrUrl: () => buildOcrUrl,
  disposeOcrWorker: () => disposeOcrWorker,
  downloadOcrModels: () => downloadOcrModels,
  extractPdfImages: () => extractPdfImages,
  getOcrModelStatus: () => getOcrModelStatus,
  isOcrReady: () => isOcrReady,
  listOcrLanguages: () => listOcrLanguages,
  normalizeRgba: () => normalizeRgba,
  ocrPdfPages: () => ocrPdfPages,
  ocrPdfText: () => ocrPdfText,
  ocrRenderScale: () => ocrRenderScale,
  parseCharacterDict: () => parseCharacterDict,
  postprocessOcrText: () => postprocessOcrText,
  prepareForOcr: () => prepareForOcr,
  removeOcrModels: () => removeOcrModels,
  renderPdfPages: () => renderPdfPages,
  rgbaToPng: () => rgbaToPng
});
import { deflateSync } from "node:zlib";
import { mkdir as mkdir2, readdir as readdir2, rename as rename2, rm, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3, join as join4 } from "node:path";
import { existsSync as existsSync2 } from "node:fs";
import { createRequire } from "node:module";
function buildOcrUrl(mirror, repoPath) {
  const base = (mirror === void 0 || mirror.trim() === "" ? DEFAULT_OCR_MIRROR : mirror).trim().replace(/\/+$/, "");
  return `${base}${repoPath}`;
}
function ocrCacheDir() {
  return join4(localModelCacheDir(), "ocr");
}
function ppocrPath(fileName) {
  return join4(ocrCacheDir(), fileName);
}
function parseCharacterDict(yml) {
  const lines = yml.split("\n");
  const idx = lines.findIndex((line) => line.trim() === "character_dict:");
  if (idx < 0) return [];
  const chars = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const stripped = lines[i].replace(/^\s+/, "");
    if (!stripped.startsWith("- ")) break;
    let value = stripped.slice(2);
    if (value.length >= 2) {
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    }
    chars.push(value);
  }
  return chars;
}
function getOcrModelStatus() {
  return ocrStatus;
}
function isOcrReady() {
  return PPOCR_FILES.every((file) => existsSync2(ppocrPath(file.fileName)));
}
function setOcrStatus(status) {
  ocrStatus = status;
}
async function downloadOcrModels(mirror) {
  if (ocrDownloadInFlight !== null) return ocrDownloadInFlight;
  const run = (async () => {
    await mkdir2(ocrCacheDir(), { recursive: true });
    const missing = PPOCR_FILES.filter((file) => !existsSync2(ppocrPath(file.fileName)));
    if (missing.length === 0) {
      setOcrStatus({ status: "ready", progress: 100, message: "" });
      return getOcrModelStatus();
    }
    setOcrStatus({ status: "downloading", progress: 0, message: "" });
    let done = 0;
    try {
      for (const file of missing) {
        await downloadModelFile(file, buildOcrUrl(mirror, file.repoPath), (fraction) => {
          setOcrStatus({
            status: "downloading",
            progress: Math.round((done + fraction) / PPOCR_FILES.length * 100),
            message: ""
          });
        });
        done += 1;
      }
      setOcrStatus({ status: "ready", progress: 100, message: "" });
    } catch (error) {
      setOcrStatus({
        status: "error",
        progress: Math.round(done / PPOCR_FILES.length * 100),
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    return getOcrModelStatus();
  })();
  ocrDownloadInFlight = run.finally(() => {
    ocrDownloadInFlight = null;
  });
  return ocrDownloadInFlight;
}
async function removeOcrModels() {
  await disposeOcrWorker();
  setOcrStatus({ status: "idle", progress: 0, message: "" });
  await rm(ocrCacheDir(), { recursive: true, force: true });
}
async function downloadModelFile(file, url, onProgress) {
  const response = await httpFetch(url, { timeoutMs: 24e4 });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < file.minBytes) {
    throw new Error(`${url} too small (${bytes.length} bytes) \u2014 mirror error page?`);
  }
  const dest = ppocrPath(file.fileName);
  if (file.fileName.endsWith(".txt")) {
    const chars = parseCharacterDict(new TextDecoder("utf-8").decode(bytes));
    if (chars.length < 1e3 || !chars.some((ch) => /[\u4e00-\u9fff]/.test(ch))) {
      throw new Error(`character_dict in inference.yml looks incomplete (${chars.length} entries, no CJK)`);
    }
    await writeFile2(`${dest}.tmp`, `
${chars.join("\n")}
`);
  } else {
    await writeFile2(`${dest}.tmp`, Buffer.from(bytes));
  }
  await rename2(`${dest}.tmp`, dest);
  onProgress(1);
}
function ocrRenderScale(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw ocrError("ocr_incomplete", "OCR page dimensions are invalid");
  }
  const area = width * height;
  if (!Number.isFinite(area) || area <= 0) throw ocrError("ocr_incomplete", "OCR page dimensions are out of range");
  const preferred = area * 9 * 4 <= MAX_PAGE_RASTER_BYTES ? 3 : 1;
  return Math.min(
    preferred,
    Math.sqrt(MAX_PAGE_RASTER_BYTES / (4 * area)) * 0.999,
    MAX_RASTER_DIMENSION / width,
    MAX_RASTER_DIMENSION / height
  );
}
async function loadMupdf() {
  if (mupdfModule !== void 0) return mupdfModule;
  try {
    mupdfModule = await import("mupdf");
  } catch {
    mupdfModule = null;
  }
  return mupdfModule;
}
async function renderPdfPages(bytes, maxPages, selectedPages) {
  const mupdf = await loadMupdf();
  if (mupdf === null) return null;
  let document = null;
  try {
    document = mupdf.Document.openDocument(Uint8Array.from(bytes), "application/pdf");
    const out = [];
    const pageCount = document.countPages();
    const selection = selectedPages ? new Set(selectedPages) : void 0;
    if (selection && [...selection].some((page) => !Number.isInteger(page) || page < 1 || page > pageCount)) throw ocrError("ocr_incomplete", "OCR selected page is outside the document");
    if ((selection?.size ?? pageCount) > maxPages) throw ocrError("ocr_incomplete", `OCR page limit exceeded (${pageCount} pages, limit ${maxPages}); split the PDF or use MinerU`);
    let totalBytes = 0;
    for (let index = 0; index < pageCount; index += 1) {
      if (selection && !selection.has(index + 1)) continue;
      let page = null;
      try {
        page = document.loadPage(index);
        const bounds = page.getBounds();
        let scale = ocrRenderScale(bounds[2] - bounds[0], bounds[3] - bounds[1]);
        let png;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          let pixmap;
          try {
            pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
            png = Buffer.from(pixmap.asPNG());
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === 3 || !/malloc|memory|allocat/i.test(message)) throw error;
            scale /= 2;
            console.warn(`[dsh-knowledge] page ${index + 1} raster allocation failed; retrying at ${scale}x`);
          } finally {
            pixmap?.destroy();
          }
        }
        if (png === void 0 || png.length === 0) throw new Error("empty page raster");
        if (totalBytes + png.length > MAX_TOTAL_RASTER_BYTES) {
          throw new Error(`raster byte budget exceeded after ${out.length}/${pageCount} pages; split the PDF or use MinerU`);
        }
        out.push({ page: index + 1, png });
        totalBytes += png.length;
      } catch (error) {
        throw ocrError("ocr_incomplete", `OCR page ${index + 1}/${pageCount} render failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        page?.destroy();
      }
    }
    return out;
  } catch (error) {
    if (document !== null) throw error;
    console.warn(`[dsh-knowledge] mupdf render failed, falling back to embedded rasters: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    document?.destroy();
  }
}
async function disposeOcrWorker() {
  await disposeOcrRenderers();
  const previous = ocrProcess;
  await previous.dispose();
  if (ocrProcess === previous) ocrProcess = new OcrPool();
}
async function extractPdfImages(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    // pdfjs 6 rejects Buffer-typed input — always hand it a plain Uint8Array.
    data: Uint8Array.from(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    // Fake-worker mode cannot derive the image-decoder wasm path by itself on
    // some hosts — point it at pdfjs-dist/wasm explicitly (trailing slash).
    ...pdfjsWasmUrl !== void 0 ? { wasmUrl: pdfjsWasmUrl } : {},
    // CID-font cmaps for CJK PDFs (SimSun etc.) — see pdfjsCMapUrl above.
    ...pdfjsCMapUrl !== void 0 ? { cMapUrl: pdfjsCMapUrl, cMapPacked: true } : {}
  });
  try {
    const doc = await loadingTask.promise;
    const out = [];
    if (doc.numPages > MAX_OCR_PAGES) throw ocrError("ocr_incomplete", `OCR page limit exceeded (${doc.numPages} pages); split the PDF or use MinerU`);
    const pageCount = doc.numPages;
    let totalRasterBytes = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i += 1) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        if (out.length >= MAX_OCR_IMAGES) throw ocrError("ocr_incomplete", `OCR image limit exceeded at page ${pageNumber}; split the PDF or use MinerU`);
        const name = ops.argsArray[i][0];
        const image = await waitForImage(page, name, 5e3);
        if (image === null || image.width <= 0 || image.height <= 0 || !image.data) {
          throw ocrError("ocr_incomplete", `OCR image decoding failed at page ${pageNumber}`);
        }
        const pixels = image.width * image.height;
        if (pixels > MAX_IMAGE_PIXELS) throw ocrError("ocr_incomplete", `OCR image at page ${pageNumber} exceeds the pixel budget`);
        const bytes2 = pixels * 4;
        if (totalRasterBytes + bytes2 > MAX_TOTAL_RASTER_BYTES) throw ocrError("ocr_incomplete", `OCR raster budget exceeded at page ${pageNumber}; split the PDF or use MinerU`);
        totalRasterBytes += bytes2;
        out.push({ width: image.width, height: image.height, data: normalizeRgba(image), page: pageNumber });
      }
    }
    return out;
  } finally {
    await loadingTask.destroy().catch(() => {
    });
  }
}
async function waitForImage(page, name, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.objs.has(name)) {
      const resolved = page.objs.get(name);
      if (resolved !== null) return resolved;
    }
    await new Promise((resolve2) => setTimeout(resolve2, 20));
  }
  return null;
}
function normalizeRgba(image) {
  const { width, height, data } = image;
  const expected = width * height;
  if (expected <= 0 || expected > MAX_IMAGE_PIXELS || expected * 4 > 4294967295) {
    throw new Error(`image dimensions out of range: ${width}\xD7${height}`);
  }
  if (data.length >= expected * 4) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    rgba2.set(data.subarray(0, expected * 4));
    for (let i = 3; i < rgba2.length; i += 4) rgba2[i] = 255;
    return rgba2;
  }
  if (data.length >= expected * 3) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    for (let i = 0; i < expected; i += 1) {
      rgba2[i * 4] = data[i * 3];
      rgba2[i * 4 + 1] = data[i * 3 + 1];
      rgba2[i * 4 + 2] = data[i * 3 + 2];
      rgba2[i * 4 + 3] = 255;
    }
    return rgba2;
  }
  if (data.length >= expected) {
    const rgba2 = new Uint8ClampedArray(expected * 4);
    for (let i = 0; i < expected; i += 1) {
      const v = data[i] ?? 0;
      rgba2[i * 4] = v;
      rgba2[i * 4 + 1] = v;
      rgba2[i * 4 + 2] = v;
      rgba2[i * 4 + 3] = 255;
    }
    return rgba2;
  }
  const rgba = new Uint8ClampedArray(expected * 4);
  for (let i = 0; i < expected; i += 1) {
    const bit = data[i >> 3] >> 7 - (i & 7) & 1;
    const v = bit === 1 ? 255 : 0;
    rgba[i * 4] = v;
    rgba[i * 4 + 1] = v;
    rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
function rgbaToPng(width, height, rgba) {
  const rowBytes = 1 + width * 4;
  const raw = Buffer.alloc(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * rowBytes + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function crc32(buffer) {
  crcTable ??= (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  let crc = 4294967295;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
async function ocrPdfPages(bytes, selectedPages) {
  if (!isOcrReady()) return /* @__PURE__ */ new Map();
  const pool = ocrProcess;
  const deadline = Date.now() + MAX_OCR_TOTAL_MS;
  const pageTexts = /* @__PURE__ */ new Map();
  try {
    const recognize2 = async (page, png) => {
      try {
        const text = postprocessOcrText(await pool.recognize(png, ocrCacheDir()));
        if (text.length > 0) {
          const bucket = pageTexts.get(page) ?? [];
          bucket.push(text);
          pageTexts.set(page, bucket);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw ocrError(error.code ?? "ocr_failed", `OCR failed for page ${page}: ${message}`);
      }
    };
    const streamed = await streamOcrRasters(bytes, selectedPages, { maxPages: MAX_OCR_PAGES, pageBytes: MAX_PAGE_RASTER_BYTES, totalBytes: MAX_TOTAL_RASTER_BYTES, maxDimension: MAX_RASTER_DIMENSION, timeoutMs: Math.max(1, deadline - Date.now()), window: Math.max(2, Math.min(8, pool.concurrency * 2)) }, recognize2);
    const rendered = streamed ? [] : await renderPdfPages(bytes, MAX_OCR_PAGES, selectedPages);
    if (rendered !== null) {
      let next2 = 0;
      await Promise.all(Array.from({ length: Math.min(pool.concurrency, rendered.length) }, async () => {
        for (; ; ) {
          const item = rendered[next2++];
          if (!item) return;
          if (Date.now() >= deadline) throw ocrError("ocr_incomplete", "OCR document time budget exceeded");
          await recognize2(item.page, item.png);
        }
      }));
    } else {
      const images = await extractPdfImages(bytes);
      for (const image of images) {
        if (selectedPages && !selectedPages.includes(image.page)) continue;
        if (Date.now() >= deadline) {
          throw ocrError("ocr_incomplete", `OCR time budget reached after ${pageTexts.size} pages; split the PDF or use MinerU`);
        }
        const { width, height, data } = prepareForOcr(image.width, image.height, image.data);
        const png = rgbaToPng(width, height, data);
        await recognize2(image.page, png);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dsh-knowledge] OCR failed for scanned PDF: ${message}`);
    throw ocrError(error.code ?? "ocr_incomplete", `OCR could not process this document completely: ${message}`);
  }
  return new Map([...pageTexts.entries()].sort((a, b) => a[0] - b[0]).map(([page, texts]) => [page, texts.join("\n")]));
}
async function ocrPdfText(bytes) {
  return [...(await ocrPdfPages(bytes)).values()].join("\n\n");
}
function upscale2x(width, height, rgba) {
  const out = new Uint8ClampedArray(width * height * 4 * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const r = rgba[src], g = rgba[src + 1], b = rgba[src + 2], a = rgba[src + 3];
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const dst = ((y * 2 + dy) * width * 2 + (x * 2 + dx)) * 4;
          out[dst] = r;
          out[dst + 1] = g;
          out[dst + 2] = b;
          out[dst + 3] = a;
        }
      }
    }
  }
  return { width: width * 2, height: height * 2, data: out };
}
function prepareForOcr(width, height, rgba) {
  let w = width, h = height, data = rgba;
  if (w < 1200 && h < 800) {
    const up = upscale2x(w, h, data);
    w = up.width;
    h = up.height;
    data = up.data;
  }
  const gray = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i += 1) {
    gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
  }
  let min = 255, max = 0;
  for (let i = 0; i < gray.length; i += 1) {
    if (gray[i] < min) min = gray[i];
    if (gray[i] > max) max = gray[i];
  }
  const range = max - min;
  const stretched = new Uint8ClampedArray(w * h);
  if (range > 0) {
    for (let i = 0; i < gray.length; i += 1) {
      stretched[i] = Math.round((gray[i] - min) / range * 255);
    }
  } else {
    stretched.set(gray);
  }
  const sharpened = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        for (let kx = -1; kx <= 1; kx += 1) {
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const py = Math.min(h - 1, Math.max(0, y + ky));
          sum += stretched[py * w + px] * SHARPEN_KERNEL[(ky + 1) * 3 + (kx + 1)];
        }
      }
      sharpened[y * w + x] = Math.min(255, Math.max(0, sum));
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    const v = sharpened[i];
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data: out };
}
function postprocessOcrText(text) {
  return text.replace(/([\u4e00-\u9fff\u3400-\u4dbf])[ \t\u3000\u00a0]+(?=[\u4e00-\u9fff\u3400-\u4dbf])/g, "$1");
}
async function listOcrLanguages() {
  let files2 = [];
  try {
    files2 = await readdir2(ocrCacheDir());
  } catch {
  }
  const onDisk = new Set(files2);
  return PPOCR_FILES.map((file) => ({ lang: file.fileName, ready: onDisk.has(file.fileName) }));
}
var MAX_OCR_PAGES, MAX_OCR_IMAGES, MAX_IMAGE_PIXELS, MAX_TOTAL_RASTER_BYTES, MAX_PAGE_RASTER_BYTES, MAX_RASTER_DIMENSION, MAX_OCR_TOTAL_MS, DEFAULT_OCR_MIRROR, PPOCR_FILES, ocrStatus, ocrDownloadInFlight, ocrProcess, pdfjsWasmUrl, pdfjsCMapUrl, mupdfModule, crcTable, SHARPEN_KERNEL;
var init_ocr = __esm({
  "src/knowledge/ocr.ts"() {
    "use strict";
    init_ocr_render_client();
    init_net();
    init_embed();
    init_ocr_pool();
    init_ocr_protocol();
    MAX_OCR_PAGES = 100;
    MAX_OCR_IMAGES = 200;
    MAX_IMAGE_PIXELS = 32e6;
    MAX_TOTAL_RASTER_BYTES = 512 * 1024 * 1024;
    MAX_PAGE_RASTER_BYTES = 64 * 1024 * 1024;
    MAX_RASTER_DIMENSION = 8192;
    MAX_OCR_TOTAL_MS = 15 * 6e4;
    DEFAULT_OCR_MIRROR = "https://hf-mirror.com";
    PPOCR_FILES = [
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/main/inference.onnx",
        fileName: "ppocrv5_det.onnx",
        minBytes: 1e6
      },
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.onnx",
        fileName: "ppocrv5_rec.onnx",
        minBytes: 1e6
      },
      {
        repoPath: "/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/main/inference.yml",
        fileName: "ppocrv5_dict.txt",
        minBytes: 1e4
      }
    ];
    ocrStatus = { status: "idle", progress: 0, message: "" };
    ocrDownloadInFlight = null;
    ocrProcess = new OcrPool();
    pdfjsWasmUrl = (() => {
      try {
        const require2 = createRequire(import.meta.url);
        const pkg = require2.resolve("pdfjs-dist/package.json");
        return `${dirname3(pkg).replace(/\\/g, "/")}/wasm/`;
      } catch {
        return void 0;
      }
    })();
    pdfjsCMapUrl = (() => {
      try {
        const require2 = createRequire(import.meta.url);
        const pkg = require2.resolve("pdfjs-dist/package.json");
        return `${dirname3(pkg).replace(/\\/g, "/")}/cmaps/`;
      } catch {
        return void 0;
      }
    })();
    crcTable = null;
    SHARPEN_KERNEL = [
      0,
      -0.4,
      0,
      -0.4,
      2.6,
      -0.4,
      0,
      -0.4,
      0
    ];
  }
});

// benchmarks/ocr/replay.ts
import { readFile as readFile4, writeFile as writeFile3, readdir as readdir3, mkdir as mkdir4, rename as rename3 } from "node:fs/promises";
import { join as join6, relative, dirname as dirname4 } from "node:path";
import { createHash as createHash3 } from "node:crypto";
import { performance } from "node:perf_hooks";
import { homedir as homedir2 } from "node:os";

// src/knowledge/parse.ts
import { existsSync as existsSync3 } from "node:fs";

// src/knowledge/pdf-parser-pool.ts
import { Worker } from "node:worker_threads";
import { availableParallelism, freemem } from "node:os";
import { fileURLToPath } from "node:url";
var PdfParserPool = class {
  constructor(capacity2 = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4), Math.floor(freemem() / 1024 ** 3))), modulePath = fileURLToPath(new URL("./pdf-parse-worker.mjs", import.meta.url)), timeoutMs = 12e4) {
    this.capacity = capacity2;
    this.modulePath = modulePath;
    this.timeoutMs = timeoutMs;
  }
  lanes = [];
  sequence = 0;
  stopped = false;
  fail(lane, error) {
    this.lanes = this.lanes.filter((other) => other !== lane);
    for (const pending of lane.pending.values()) pending.reject(error);
    lane.pending.clear();
    void lane.worker.terminate();
  }
  createLane() {
    const worker = new Worker(this.modulePath);
    const lane = { worker, pending: /* @__PURE__ */ new Map() };
    worker.on("message", (message) => {
      const pending = message.id === void 0 ? void 0 : lane.pending.get(message.id);
      if (!pending) return;
      lane.pending.delete(message.id);
      if (message.ok) pending.resolve({ text: message.text ?? "", pages: message.pages, scanned: message.scanned });
      else pending.reject(Error(message.error ?? "pdf-parse worker failed"));
      if (!lane.pending.size) worker.unref();
    });
    worker.on("error", (error) => this.fail(lane, error));
    worker.on("exit", () => this.fail(lane, Error("pdf-parse worker exited")));
    worker.unref();
    this.lanes.push(lane);
    return lane;
  }
  parse(bytes) {
    if (this.stopped) return Promise.reject(Object.assign(Error("PDF parser stopped"), { code: "plugin_stopped" }));
    let lane = this.lanes.reduce((best, next2) => !best || next2.pending.size < best.pending.size ? next2 : best, void 0);
    if (!lane || lane.pending.size > 0 && this.lanes.length < this.capacity) lane = this.createLane();
    const selected = lane;
    return new Promise((resolve2, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.fail(selected, Error("PDF parsing failed: pdf-parse timed out")), this.timeoutMs);
      timer.unref?.();
      selected.pending.set(id, { resolve: (value) => {
        clearTimeout(timer);
        resolve2(value);
      }, reject: (error) => {
        clearTimeout(timer);
        reject(error);
      } });
      try {
        const data = Uint8Array.from(bytes);
        selected.worker.ref();
        selected.worker.postMessage({ id, data }, [data.buffer]);
      } catch (error) {
        selected.pending.delete(id);
        clearTimeout(timer);
        if (!selected.pending.size) selected.worker.unref();
        reject(error instanceof Error ? error : Error(String(error)));
      }
    });
  }
  async dispose() {
    this.stopped = true;
    const lanes = this.lanes;
    this.lanes = [];
    for (const lane of lanes) {
      for (const pending of lane.pending.values()) pending.reject(Object.assign(Error("PDF parser stopped"), { code: "plugin_stopped" }));
      lane.pending.clear();
    }
    await Promise.all(lanes.map((lane) => lane.worker.terminate()));
  }
};

// src/knowledge/parse.ts
import { fileURLToPath as fileURLToPath6 } from "node:url";
function extensionOf(fileName) {
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}
async function parseDocumentBuffer(buffer, fileName, mimeType, options = {}) {
  const ext = extensionOf(fileName);
  if (mimeType === "application/pdf" || ext === "pdf") return parsePdf(buffer, options.ocrEnabled !== false);
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx") {
    return parseDocx(buffer);
  }
  if (ext === "html" || ext === "htm") return extractHtmlToMarkdown(decodeText(buffer));
  if (ext === "pptx") return parsePptx(buffer);
  if (ext === "xlsx") return parseXlsx(buffer);
  if (ext === "epub") return parseEpub(buffer);
  if (ext === "doc") return parseDoc(buffer);
  if (ext === "ppt") return parseLegacyOffice(buffer, "ppt");
  if (ext === "xls") return parseLegacyOffice(buffer, "xlsx");
  return decodeText(buffer);
}
function decodeText(buffer) {
  if (buffer.length >= 3 && buffer[0] === 239 && buffer[1] === 187 && buffer[2] === 191) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  let replacements = 0;
  for (let i = 0; i < utf8.length; i += 1) {
    if (utf8.charCodeAt(i) === 65533) {
      replacements += 1;
      if (replacements > 8) break;
    }
  }
  if (replacements <= 8) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8;
  }
}
function extractFromHtml(html) {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch !== null ? decodeEntities(titleMatch[1].trim()) : "";
  const withoutBlocks = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const withBreaks = withoutBlocks.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote)>/gi, "\n").replace(/<(br|hr)\s*\/?>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const text = decodeEntities(withoutTags).split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter((line) => line.length > 0).join("\n");
  return { title, text };
}
var turndownCtor = null;
async function loadTurndown() {
  if (turndownCtor === null) {
    const mod = await import("turndown");
    turndownCtor = mod.default ?? mod;
  }
  return turndownCtor;
}
async function extractHtmlToMarkdown(html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<head[\s\S]*?<\/head>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<(nav|footer|aside|form|iframe|svg|canvas|template)[\s\S]*?<\/\1>/gi, " ");
  try {
    const Turndown = await loadTurndown();
    const converter = new Turndown({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*"
    });
    const markdown = converter.turndown(cleaned);
    if (markdown.trim().length === 0) return extractFromHtml(html).text;
    return markdown.replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return extractFromHtml(html).text;
  }
}
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  middot: "\xB7",
  bull: "\u2022",
  times: "\xD7",
  divide: "\xF7",
  deg: "\xB0",
  plusmn: "\xB1"
};
function decodeEntities(text) {
  return text.replace(/&#x([0-9a-f]+);/gi, (_match, hex) => codePointFrom(parseInt(hex, 16))).replace(/&#(\d+);/g, (_match, dec) => codePointFrom(Number(dec))).replace(/&([a-z][a-z0-9]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}
function codePointFrom(value) {
  if (!Number.isInteger(value) || value < 0 || value > 1114111 || value >= 55296 && value <= 57343) return "\uFFFD";
  return String.fromCodePoint(value);
}
function averageLineLength(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
}
async function extractTextWithLayout(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let cMapUrl;
  try {
    const { createRequire: createRequire2 } = await import("node:module");
    const { dirname: dirname5 } = await import("node:path");
    const require2 = createRequire2(import.meta.url);
    const pkg = require2.resolve("pdfjs-dist/package.json");
    cMapUrl = `${dirname5(pkg).replace(/\\/g, "/")}/cmaps/`;
  } catch {
  }
  const loadingTask = pdfjs.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    ...cMapUrl !== void 0 ? { cMapUrl, cMapPacked: true } : {}
  });
  try {
    const doc = await loadingTask.promise;
    const pages2 = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items ?? []).map((item) => ({
        str: item.str ?? "",
        x: item.transform?.[4] ?? 0,
        y: item.transform?.[5] ?? 0,
        height: Math.abs(item.transform?.[3] ?? 0) || 10
      })).filter((item) => item.str.length > 0);
      if (items.length === 0) continue;
      const heights = items.map((item) => item.height).sort((a, b) => a - b);
      const tolerance = (heights[Math.floor(heights.length / 2)] ?? 10) * 0.6;
      const bands = /* @__PURE__ */ new Map();
      for (const item of items) {
        const band = Math.round(item.y / tolerance);
        const list = bands.get(band) ?? [];
        list.push({ x: item.x, str: item.str });
        bands.set(band, list);
      }
      const lines = [...bands.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list.sort((a, b) => a.x - b.x).map((entry) => entry.str).join("")).filter((line) => line.trim().length > 0);
      if (lines.length > 0) pages2.push(lines.join("\n"));
    }
    return pages2.join("\n\n");
  } finally {
    await loadingTask.destroy().catch(() => {
    });
  }
}
async function ocrFallback(bytes) {
  const { isOcrReady: isOcrReady2, ocrPdfText: ocrPdfText2 } = await Promise.resolve().then(() => (init_ocr(), ocr_exports));
  if (!isOcrReady2()) return "";
  return await ocrPdfText2(bytes);
}
async function parsePdf(buffer, ocrEnabled = true) {
  if (!Buffer.from(buffer.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) throw new Error("PDF parsing failed: invalid PDF header");
  let primaryError = null;
  let text = "";
  let native;
  try {
    native = await parsePdfInWorker(buffer);
    text = native.text;
  } catch (error) {
    if (error?.code === "plugin_stopped") throw error;
    primaryError = error instanceof Error ? error : new Error(String(error));
  }
  if (text.trim().length > 0) {
    const avgLine = averageLineLength(text);
    if (avgLine >= 5) {
      if (ocrEnabled && native?.scanned?.length && native.pages) {
        const { isOcrReady: isOcrReady2, ocrPdfPages: ocrPdfPages2 } = await Promise.resolve().then(() => (init_ocr(), ocr_exports));
        if (!isOcrReady2()) throw new Error("This PDF mixes text and scanned pages. Download PaddleOCR in Settings \u2192 Local Models to index every page");
        const recognized2 = await ocrPdfPages2(buffer, native.scanned);
        return native.pages.map((page, index) => recognized2.get(index + 1) ?? page).join("\n\n");
      }
      return text;
    }
    let reassembled = "";
    try {
      reassembled = await extractTextWithLayout(buffer);
    } catch {
    }
    if (averageLineLength(reassembled) >= 12 && reassembled.trim().length > 0) return reassembled;
    const recognized = ocrEnabled ? await ocrFallback(buffer) : "";
    if (recognized.trim().length > 0) return recognized;
    try {
      const anydoc = await loadAnydoc();
      const markdown = (await anydoc.toMarkdownBytes(Buffer.from(buffer))).trim();
      if (markdown.length > 0) return markdown;
    } catch {
    }
    return text;
  }
  if (ocrEnabled && native?.scanned?.length) {
    const recognized = await ocrFallback(buffer);
    if (recognized.trim()) return recognized;
  }
  try {
    const anydoc = await loadAnydoc();
    const markdown = (await anydoc.toMarkdownBytes(Buffer.from(buffer))).trim();
    if (markdown.length > 0) return markdown;
  } catch {
  }
  let ocrReady = false;
  let ocrFailure;
  try {
    const { isOcrReady: isOcrReady2, ocrPdfText: ocrPdfText2 } = await Promise.resolve().then(() => (init_ocr(), ocr_exports));
    ocrReady = ocrEnabled && isOcrReady2();
    if (ocrReady) {
      const recognized = await ocrPdfText2(buffer);
      if (recognized.trim().length > 0) return recognized;
    }
  } catch (error) {
    ocrFailure = error instanceof Error ? error : new Error(String(error));
    console.warn(`[dsh-knowledge] OCR failed for a scanned PDF: ${ocrFailure.message}`);
  }
  if (ocrFailure !== void 0) {
    throw Object.assign(
      new Error(`PDF contains no extractable text and OCR failed: ${ocrFailure.message}`),
      { code: ocrFailure.code ?? "ocr_failed" }
    );
  }
  if (primaryError !== null) {
    throw new Error(`PDF parsing failed: ${primaryError.message}${ocrEnabled ? "" : "; PaddleOCR is disabled for this base"}`);
  }
  throw new Error(
    !ocrEnabled ? "PDF contains no extractable text and PaddleOCR is disabled for this base" : ocrReady ? "PDF contains no extractable text (it may be scanned)" : "PDF contains no extractable text (it may be scanned) \u2014 download the local OCR models in Settings \u2192 Local Models to auto-recognize scans"
  );
}
async function parseDocx(buffer) {
  try {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) });
    const text = result?.value ?? "";
    if (text.trim().length === 0) throw new Error("DOCX contains no extractable text");
    return text;
  } catch (error) {
    throw new Error(`DOCX parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parseDoc(buffer) {
  try {
    const WordExtractor = await loadWordExtractor();
    const extractor = new WordExtractor();
    const doc = await extractor.extract(Buffer.from(buffer));
    const text = doc.getBody() ?? "";
    if (text.trim().length === 0) throw new Error("DOC contains no extractable text");
    return text;
  } catch (error) {
    throw new Error(`DOC parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parseLegacyOffice(buffer, format) {
  try {
    const anydoc = await loadAnydoc();
    const markdown = await anydoc.toMarkdownBytes(buffer, format);
    const text = markdown.trim();
    if (text.length === 0) throw new Error("document contains no extractable content");
    return text;
  } catch (error) {
    throw new Error(`document parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function parsePptx(buffer) {
  const zip = await loadZip(buffer);
  const slides = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    const xml = await zip.files[name].async("string");
    slides.push(stripXmlText(xml, "a:t"));
  }
  if (slides.length === 0) throw new Error("PPTX contains no extractable slides");
  return slides.join("\n\n");
}
async function parseXlsx(buffer) {
  const zip = await loadZip(buffer);
  const shared = zip.files["xl/sharedStrings.xml"];
  const sharedStrings = [];
  if (shared !== void 0) {
    const xml = await shared.async("string");
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const inner = si[1] ?? "";
      const text = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
      sharedStrings.push(text);
    }
  }
  const lines = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = await zip.files[name].async("string");
    const rows = xml.split(/<row\b/);
    for (const row of rows) {
      const cells = [];
      for (const cell of row.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
        const tag = cell[0] ?? "";
        const type = /<c\b[^>]*\bt="([^"]*)"/.exec(tag)?.[1];
        const content = cell[1] ?? "";
        const inline = /<is>([\s\S]*?)<\/is>/.exec(content);
        if (inline !== null) {
          const text = [...(inline[1] ?? "").matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeEntities(m[1] ?? "")).join("");
          cells.push(text);
          continue;
        }
        const ref = /<v>([\s\S]*?)<\/v>/.exec(content);
        const raw = ref?.[1] ?? "";
        if (type === "s") {
          const sharedIdx = Number(raw);
          if (Number.isInteger(sharedIdx) && sharedIdx >= 0 && sharedIdx < sharedStrings.length) {
            cells.push(sharedStrings[sharedIdx]);
          }
        } else if (type === "b") {
          cells.push(raw === "1" ? "1" : "0");
        } else if (raw.trim().length > 0) {
          cells.push(decodeEntities(raw));
        }
      }
      if (cells.some((cell) => cell.trim().length > 0)) lines.push(cells.join("	"));
    }
  }
  if (lines.length === 0) throw new Error("XLSX contains no extractable cells");
  return lines.join("\n");
}
async function parseEpub(buffer) {
  const zip = await loadZip(buffer);
  const pages2 = [];
  for (const name of Object.keys(zip.files).sort()) {
    if (!/\.(xhtml|html|htm)$/.test(name)) continue;
    if (/nav|toc|cover/i.test(name)) continue;
    const html = await zip.files[name].async("string");
    const text = await extractHtmlToMarkdown(html);
    if (text.trim().length > 0) pages2.push(text);
  }
  if (pages2.length === 0) throw new Error("EPUB contains no extractable pages");
  return pages2.join("\n\n");
}
function stripXmlText(xml, tag) {
  const parts = [];
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g");
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== void 0) parts.push(decodeEntities(match[1]));
  }
  return parts.join("");
}
var pdfParseWorkerMissing = false;
var pdfParserPool = new PdfParserPool();
async function disposePdfParsers() {
  const previous = pdfParserPool;
  pdfParserPool = new PdfParserPool();
  await previous.dispose();
}
async function parsePdfInProcess(bytes) {
  const mod = await import("pdf-parse");
  const result = await mod.default(Buffer.from(bytes));
  return { text: typeof result?.text === "string" ? result.text : "" };
}
async function parsePdfInWorker(bytes) {
  if (!pdfParseWorkerMissing && !existsSync3(fileURLToPath6(new URL("./pdf-parse-worker.mjs", import.meta.url)))) {
    pdfParseWorkerMissing = true;
    console.warn("[dsh-knowledge] pdf-parse worker bundle is missing; parsing PDFs in-process");
  }
  return pdfParseWorkerMissing ? parsePdfInProcess(bytes) : pdfParserPool.parse(bytes);
}
async function loadMammoth() {
  const mod = await import("mammoth");
  return mod.default ?? mod;
}
async function loadWordExtractor() {
  const mod = await import("word-extractor");
  return mod.default ?? mod;
}
async function loadAnydoc() {
  const mod = await import("@firecrawl/anydoc");
  return mod;
}
var MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
async function loadZip(buffer) {
  const mod = await import("jszip");
  const JSZip2 = mod.default ?? mod;
  let zip;
  try {
    zip = await new JSZip2().loadAsync(buffer);
  } catch (error) {
    throw new Error(`archive parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const total = Object.values(zip.files).reduce((sum, entry) => {
    const size = entry._data?.uncompressedSize;
    return sum + (typeof size === "number" && Number.isFinite(size) ? size : 0);
  }, 0);
  if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error(`archive too large to unpack (${Math.round(total / 1024 / 1024)} MB uncompressed)`);
  }
  return zip;
}

// benchmarks/ocr/replay.ts
init_embed();

// src/knowledge/ocr-acceleration.ts
init_background_gpu();

// src/knowledge/ocr-quality.ts
function ocrTextAgreement(reference, candidate) {
  const numbers = (text) => (text.normalize("NFKC").match(/[+\-−]?\s*\d+(?:[.,]\d+)*(?:\s*[%‰])?/gu) ?? []).map((value) => value.replace(/\s/gu, "").replace("\u2212", "-"));
  if (JSON.stringify(numbers(reference)) !== JSON.stringify(numbers(candidate))) return 0;
  const clean = (text) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const a = Array.from(clean(reference)), b = Array.from(clean(candidate));
  if (a.join("") === b.join("")) return 1;
  if (a.length < 32 || b.length < 32) return 0;
  const grams = (text) => {
    const counts = /* @__PURE__ */ new Map();
    for (let i = 0; i + 2 < text.length; i++) {
      const key = text.slice(i, i + 3).join("");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const left = grams(a), right = grams(b);
  let common = 0;
  for (const [key, count] of left) common += Math.min(count, right.get(key) ?? 0);
  return Math.min(2 * common / (a.length + b.length - 4), Math.min(a.length, b.length) / Math.max(a.length, b.length));
}
var MIN_OCR_AGREEMENT = 0.95;

// src/knowledge/ocr-acceleration.ts
init_owned_process();
init_private_python();
init_resource_policy();
init_embedding_device_availability();
init_embed();
init_structure_process();
import { spawn as spawn3 } from "node:child_process";
import { readFile as readFile3, mkdir as mkdir3 } from "node:fs/promises";
import { join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath7 } from "node:url";
import { availableParallelism as availableParallelism6, freemem as freemem5 } from "node:os";
import { createHash as createHash2 } from "node:crypto";
var script2 = (name) => fileURLToPath7(new URL(`../../scripts/${name}`, import.meta.url));
function ocrDeviceWorkActive(foreground2, usedAt, pending, now = Date.now()) {
  return foreground2 === 0 && (now - usedAt < 3e5 || pending > 0);
}
function acceleratorEnvironment(root2) {
  const env = { ...process.env, CUDA_VISIBLE_DEVICES: "", HIP_VISIBLE_DEVICES: "", ROCR_VISIBLE_DEVICES: "", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
  if (process.platform === "linux") {
    const libraries = join5(root2, "intel/usr/lib/x86_64-linux-gnu");
    return {
      ...env,
      LD_LIBRARY_PATH: [libraries, join5(libraries, "intel-opencl"), join5(root2, "intel/usr/local/lib"), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
      OCL_ICD_VENDORS: join5(root2, "icd"),
      ZE_ENABLE_ALT_DRIVERS: join5(libraries, "libze_intel_npu.so.1")
    };
  }
  return env;
}
var OcrAcceleration = class {
  lanes = [];
  excludedDevices = [];
  loadedRoot;
  modelHash;
  cudaQualifiedHash;
  cudaQualification;
  state;
  preparation;
  setupChild;
  stopped = false;
  igpuReservations = 0;
  foreground = 0;
  usedAt = 0;
  polling = false;
  timer;
  intelAvailability = new IntelEmbeddingAvailability();
  unregisterDevices = registerBackgroundDevices(() => this.lanes.map((lane) => lane.process.pid));
  gpuRetryAt = 0;
  gpuWorkers = 8;
  configure(options = {}) {
    this.gpuWorkers = Math.max(1, Math.min(8, options.localOcrGpuWorkers ?? 8));
  }
  gpuPython() {
    return join5(localModelCacheDir(), "embedding-gpu-runtime", "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  }
  makeLane(device) {
    const cuda = device.device.startsWith("CUDA");
    const env = acceleratorEnvironment(this.root());
    if (cuda) {
      delete env.CUDA_VISIBLE_DEVICES;
      delete env.OCL_ICD_VENDORS;
    }
    env.OMP_NUM_THREADS = "8";
    env.OPENBLAS_NUM_THREADS = "1";
    return { device: { ...device }, process: new StructureProcess(
      cuda ? this.gpuPython() : this.python(),
      cuda ? [script2("ocr-cuda-worker.py"), "--models", join5(localModelCacheDir(), "ocr"), "--cache", join5(this.root(), "compiled")] : [script2("ocr-accelerator-worker.py"), "--worker", "--models", join5(localModelCacheDir(), "ocr"), "--cache", join5(this.root(), "compiled"), "--device", device.device, "--threads", "8"],
      env,
      "DSH_OCR_RESULT "
    ), pending: 0, tail: Promise.resolve(), samples: [], runs: 0, failed: false, enabled: !device.device.startsWith("GPU") && (!this.foreground || device.device === "CPU" && !this.lanes.some((lane) => lane.device.device === "CPU")) };
  }
  async stopLane(lane) {
    lane.enabled = false;
    let timer;
    try {
      await Promise.race([lane.current ?? Promise.resolve(), new Promise((resolve2) => {
        timer = setTimeout(resolve2, 1e4);
      })]).catch(() => {
      });
    } finally {
      if (timer) clearTimeout(timer);
      await lane.process.stopAndWait();
    }
  }
  async enterForeground(yieldIgpu = false) {
    this.foreground++;
    if (yieldIgpu) this.igpuReservations++;
    const cpu = this.lanes.filter((lane) => lane.device.device === "CPU");
    try {
      await Promise.all(this.lanes.filter((lane) => lane.device.device !== "CPU" || cpu.includes(lane) && lane !== cpu[0]).map((lane) => this.stopLane(lane)));
    } catch (error) {
      this.foreground--;
      if (yieldIgpu) this.igpuReservations--;
      throw error;
    }
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.foreground--;
        if (yieldIgpu) this.igpuReservations--;
        if (!this.foreground) for (const lane of this.lanes.filter((lane2) => !lane2.failed && (lane2.device.device === "CPU" || lane2.device.device.startsWith("NPU")))) lane.enabled = true;
      }
    };
  }
  async balanceCpu() {
    const cpu = this.lanes.filter((lane) => lane.device.device === "CPU");
    const gpuHeavy = this.lanes.filter((lane) => lane.device.device.startsWith("CUDA") && lane.enabled && !lane.failed).length >= 4;
    await Promise.all(cpu.slice(1).map(async (lane) => {
      if (this.foreground || gpuHeavy) {
        if (lane.enabled) await this.stopLane(lane);
      } else if (!lane.failed) lane.enabled = true;
    }));
  }
  async yieldMainGpu() {
    await Promise.all(this.lanes.filter((lane) => lane.device.device.startsWith("CUDA")).map((lane) => this.stopLane(lane)));
  }
  async updateDevices() {
    if (this.stopped || this.polling || !this.loadedRoot) return;
    this.polling = true;
    try {
      const pending = this.lanes.reduce((sum, lane) => sum + lane.pending, 0);
      const active = ocrDeviceWorkActive(0, this.usedAt, pending);
      const yieldIdleAccelerators = () => this.lanes.every((lane) => lane.pending === 0) && Date.now() - this.usedAt >= 1e4 && knowledgeGpuAdmission.hasOtherDemand(this);
      const idle = process.platform === "linux" ? true : (await desktopIdle()).idleSeconds >= 300;
      const owned = () => backgroundDevicePids(new Set(this.lanes.flatMap((lane) => lane.process.pid ? [lane.process.pid] : [])));
      const intel = active && idle ? await this.intelAvailability.sample(owned()) : { available: false };
      knowledgeGpuAdmission.request(this, !this.foreground && active && this.lanes.some((lane) => lane.pending > 0));
      const nvidia = active && idle && knowledgeGpuAdmission.allowed ? await nvidiaEmbeddingAvailability(owned) : { available: false, reason: "OCR is idle or foreground inference is active" };
      if (this.stopped || this.foreground || this.igpuReservations || yieldIdleAccelerators()) intel.available = false;
      if (this.stopped || this.foreground || yieldIdleAccelerators()) nvidia.available = false;
      const resident = this.lanes.filter((lane) => lane.device.device.startsWith("CUDA") && lane.process.pid !== void 0).length;
      const target = Math.min(this.gpuWorkers, resident + Math.floor(Math.max(0, (nvidia.freeMiB ?? 0) - 2048) / 2048));
      for (const lane of this.lanes.filter((lane2) => /^GPU|^CUDA/.test(lane2.device.device))) {
        if (lane.device.device.startsWith("CUDA") && lane.failed && (lane.retryAt ?? Infinity) <= Date.now()) {
          lane.failed = false;
          lane.device.qualified = false;
        }
        const available = lane.device.device.startsWith("CUDA") ? nvidia.available && Number(lane.device.device.split(":")[1]) < this.gpuWorkers : intel.available;
        if (!available && lane.enabled) await this.stopLane(lane);
        else if (available && !lane.failed) lane.enabled = true;
      }
      if (nvidia.available && target > 0 && Date.now() >= this.gpuRetryAt && !this.lanes.some((lane) => lane.device.device === `CUDA:${target - 1}`)) {
        try {
          await readFile3(join5(localModelCacheDir(), "embedding-gpu-runtime", "venv", process.platform === "win32" ? "pyvenv.cfg" : "pyvenv.cfg"));
        } catch {
          this.gpuRetryAt = Date.now() + 6e4;
          return;
        }
        if (this.stopped || this.foreground) return;
        for (let i = 0; i < target; i++) {
          if (!this.lanes.some((lane) => lane.device.device === `CUDA:${i}`)) this.lanes.push(this.makeLane({ device: `CUDA:${i}`, name: `NVIDIA OCR worker ${i + 1}`, qualified: false, medianMs: 100 }));
        }
        for (const lane of this.lanes.filter((lane2) => lane2.device.device.startsWith("CUDA"))) lane.enabled = Number(lane.device.device.split(":")[1]) < this.gpuWorkers;
      }
      await this.balanceCpu();
    } finally {
      this.polling = false;
    }
  }
  root() {
    return join5(localModelCacheDir(), "ocr-accelerators");
  }
  python() {
    return join5(this.root(), "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  }
  get concurrency() {
    return Math.max(1, this.lanes.filter((lane) => !lane.failed && lane.enabled).length);
  }
  runtimeDevices() {
    return [...this.lanes.map((lane) => {
      const state = lane.pending > 0 ? "running" : lane.failed ? "unavailable" : lane.enabled ? "ready" : "waiting";
      return {
        device: lane.device.device,
        activeTasks: lane.pending,
        state,
        reason: lane.pending > 0 ? "Processing queued OCR pages" : this.foreground && lane.device.device !== "CPU" ? "Reserved for foreground inference" : lane.failed ? lane.device.error ?? "OCR worker failed; fallback active" : lane.enabled ? "Waiting for OCR pages" : lane.device.error ?? "Waiting for device admission or CPU capacity"
      };
    }), ...this.excludedDevices.map((device) => ({ device: device.device, activeTasks: 0, state: "unavailable", reason: device.error ?? "Device is not qualified for this OCR model" }))];
  }
  async status() {
    if (this.state) return this.state;
    if (this.loadedRoot === this.root()) return { status: "ready", message: "Calibrated local OCR devices", devices: [...this.lanes.map((lane) => ({ ...lane.device, qualified: lane.device.qualified && !lane.failed, enabled: lane.enabled && !lane.failed, pending: lane.pending, completed: lane.completed ?? 0 })), ...this.excludedDevices] };
    this.releaseWorkers();
    try {
      const receipt = JSON.parse(await readFile3(join5(this.root(), "ready.json"), "utf8"));
      if (receipt.schema !== 1 || !Array.isArray(receipt.devices)) throw new Error("Invalid acceleration receipt");
      const digest = createHash2("sha256");
      for (const name of ["ppocrv5_det.onnx", "ppocrv5_rec.onnx", "ppocrv5_dict.txt"]) digest.update(await readFile3(join5(localModelCacheDir(), "ocr", name)));
      if (digest.digest("hex") !== receipt.modelHash) throw new Error("OCR weights changed; recalibration required");
      this.modelHash = receipt.modelHash;
      for (const device of receipt.devices) {
        if (/^NPU(?:\.\d+)?$/.test(device.device)) {
          this.excludedDevices.push({ ...device, qualified: false, enabled: false, error: "Full-page NPU OCR failed scanned-page fidelity checks. NPU layout and embeddings use separate qualification." });
          continue;
        }
        if (!device.qualified || !Number.isFinite(device.medianMs) || device.medianMs <= 0) continue;
        if (!(device.device === "CPU" || /^NPU(?:\.\d+)?$/.test(device.device) || /^GPU(?:\.\d+)?$/.test(device.device) && /intel/i.test(device.name))) continue;
        const copies = device.device === "CPU" ? Math.max(1, Math.min(4, Math.floor(availableParallelism6() / 8), Math.floor(freemem5() / 1024 ** 3))) : 1;
        for (let i = 0; i < copies; i++) this.lanes.push(this.makeLane(device));
      }
      if (!this.lanes.some((lane) => lane.device.device === "CPU")) throw new Error("No qualified CPU fallback");
      this.loadedRoot = this.root();
      return { status: "ready", message: "OCR first; CPU plus available Intel/NVIDIA GPUs. Foreground inference reserves GPUs and limits OCR to eight CPU threads.", devices: [...this.lanes.map((lane) => lane.device), ...this.excludedDevices] };
    } catch {
      this.releaseWorkers();
      return { status: "not_installed", message: "Using the standard CPU OCR engine. Download and calibrate optional acceleration to use Intel devices.", devices: [] };
    }
  }
  async recognize(png) {
    if (this.stopped || (await this.status()).status !== "ready") return void 0;
    this.usedAt = Date.now();
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.updateDevices().catch(() => {
        });
      }, 1e3);
      this.timer.unref?.();
    }
    let lane;
    while (!lane) {
      if (this.stopped) return void 0;
      const healthy = this.lanes.filter((lane2) => !lane2.failed && lane2.enabled && (lane2.retryAt ?? 0) <= Date.now());
      if (!healthy.length) return void 0;
      const accelerators = healthy.filter((lane2) => lane2.device.device !== "CPU");
      const pool = accelerators.length ? [...accelerators, ...healthy.filter((lane2) => lane2.device.device === "CPU").slice(0, 1)] : healthy;
      const choices = pool.filter((lane2) => lane2.pending < 1).sort((a, b) => {
        if (a.device.device === "CPU" !== (b.device.device === "CPU")) return a.device.device === "CPU" ? 1 : -1;
        if (a.pending === 0 !== (b.pending === 0)) return a.pending === 0 ? -1 : 1;
        if (a.pending === 0 && b.pending === 0) return (a.lastAssigned ?? 0) - (b.lastAssigned ?? 0) || a.device.medianMs - b.device.medianMs;
        return (a.pending + 1) * a.device.medianMs - (b.pending + 1) * b.device.medianMs;
      });
      lane = choices[0];
      if (!lane) await new Promise((resolve2) => setTimeout(resolve2, 5));
    }
    lane.pending++;
    lane.lastAssigned = Date.now();
    const task = async () => {
      try {
        if (this.stopped) return void 0;
        if (lane.failed || !lane.enabled) return void 0;
        const request = lane.process.request({ png: png.toString("base64") }, 3e5);
        lane.current = request;
        const result2 = await request;
        lane.completed = (lane.completed ?? 0) + 1;
        if (typeof result2.text !== "string") throw new Error("Invalid OCR text response");
        if (lane.device.device.startsWith("CUDA") && !lane.device.qualified) {
          if (result2.provider !== "CUDAExecutionProvider") throw new Error("OCR CUDA provider was not verified");
          const shared = typeof result2.modelHash === "string" && result2.modelHash === this.modelHash;
          while (shared && this.cudaQualification) await this.cudaQualification;
          if (shared && this.cudaQualifiedHash === this.modelHash) {
            lane.device.qualified = true;
            delete lane.device.error;
          } else {
            let release;
            const reservation = shared ? new Promise((resolve2) => {
              release = resolve2;
            }) : void 0;
            if (shared) this.cudaQualification = reservation;
            try {
              const reference = this.lanes.filter((other) => other.device.device === "CPU" && !other.failed && other.enabled).sort((a, b) => (a.pending + 1) * a.device.medianMs - (b.pending + 1) * b.device.medianMs)[0];
              if (!reference) throw new Error("No OCR CPU reference");
              reference.pending++;
              const check = reference.tail.then(() => {
                if (this.stopped || !reference.enabled) throw new Error("OCR yielded before calibration");
                const request2 = reference.process.request({ png: png.toString("base64") }, 3e5);
                reference.current = request2;
                return request2;
              }).finally(() => {
                reference.pending--;
              });
              reference.tail = check.catch(() => {
              });
              const expected = await check;
              reference.completed = (reference.completed ?? 0) + 1;
              const agreement = ocrTextAgreement(String(expected.text ?? ""), String(result2.text ?? ""));
              if (agreement < MIN_OCR_AGREEMENT) {
                lane.device.error = `OCR comparison ${Math.round(agreement * 100)}%; CPU used for this page; retrying GPU qualification after cooldown`;
                lane.retryAt = Date.now() + 1e4;
                lane.device.medianMs = typeof result2.elapsedMs === "number" ? result2.elapsedMs : 100;
                return String(expected.text ?? "");
              }
              lane.device.qualified = true;
              if (shared && result2.modelHash === this.modelHash && String(expected.text ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").length >= 32) this.cudaQualifiedHash = this.modelHash;
              delete lane.device.error;
            } finally {
              release?.();
              if (this.cudaQualification === reservation) this.cudaQualification = void 0;
            }
          }
        }
        if (lane.runs++ > 0 && typeof result2.elapsedMs === "number" && result2.elapsedMs > 0) {
          lane.samples.push(result2.elapsedMs);
          lane.samples = lane.samples.slice(-10);
          const sorted = [...lane.samples].sort((a, b) => a - b);
          lane.device.medianMs = sorted[Math.floor(sorted.length / 2)];
        }
        return result2.text;
      } catch (error) {
        if (lane.enabled) {
          lane.failed = true;
          lane.device.error = String(error).slice(-1e3);
          if (lane.device.device.startsWith("CUDA")) lane.retryAt = Date.now() + 6e4;
        }
        ;
        lane.process.dispose();
        return void 0;
      } finally {
        lane.pending--;
      }
    };
    const result = lane.tail.then(task, task);
    lane.tail = result.catch(() => {
    });
    const text = await result;
    return text === void 0 && !this.stopped ? this.recognize(png) : text;
  }
  command(command, args, timeout, env) {
    return new Promise((resolve2, reject) => {
      const child = spawn3(command, args, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      this.setupChild = child;
      let log = "";
      const append = (data) => {
        log = (log + data.toString()).slice(-4e3);
        this.state = { status: "installing", message: log, devices: [] };
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        stopOwnedProcess(child);
        reject(new Error("OCR accelerator setup timed out"));
      }, timeout);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (this.setupChild === child) this.setupChild = void 0;
        code === 0 ? resolve2() : reject(new Error(`OCR accelerator setup failed: ${log}`));
      });
    });
  }
  async prepare() {
    if (this.preparation) return this.status();
    if (this.stopped) throw new Error("Knowledge plugin is disabled");
    this.releaseWorkers();
    await mkdir3(this.root(), { recursive: true });
    this.state = { status: "installing", message: "Installing private OCR acceleration runtime\u2026", devices: [] };
    this.preparation = ensurePrivatePython(this.root(), (command, args, env) => this.command(command, args, 72e5, env)).then((python) => this.command(python, [script2("setup-ocr-accelerators.py"), this.root()], 72e5, { ...process.env, CUDA_VISIBLE_DEVICES: "" })).then(() => this.command(this.python(), [script2("ocr-accelerator-worker.py"), "--calibrate", "--models", join5(localModelCacheDir(), "ocr"), "--cache", join5(this.root(), "compiled"), "--output", join5(this.root(), "ready.json")], 9e5, acceleratorEnvironment(this.root()))).then(async () => {
      if (process.platform === "linux" || process.platform === "win32") {
        try {
          await this.command(this.python(), [script2("setup-ocr-gpu.py"), localModelCacheDir()], 72e5, acceleratorEnvironment(this.root()));
        } catch {
        }
      }
      this.gpuRetryAt = 0;
      this.state = void 0;
      await this.status();
    }).catch((error) => {
      this.state = { status: "error", message: error instanceof Error ? error.message : String(error), devices: [] };
    }).finally(() => {
      this.preparation = void 0;
    });
    return this.state;
  }
  releaseWorkers() {
    for (const lane of this.lanes) lane.process.dispose();
    this.lanes = [];
    this.excludedDevices = [];
    this.loadedRoot = void 0;
    this.modelHash = void 0;
    this.cudaQualifiedHash = void 0;
    this.cudaQualification = void 0;
  }
  dispose() {
    knowledgeGpuAdmission.request(this, false);
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.unregisterDevices();
    this.setupChild && stopOwnedProcess(this.setupChild);
    this.releaseWorkers();
  }
};

// benchmarks/ocr/replay.ts
init_ocr_pool();
init_ocr();
var [root, output, parallelArg = "8", limitArg = "0"] = process.argv.slice(2);
if (!root || !output) throw Error("Usage: replay <corpus directory> <output JSON> [document concurrency] [limit]");
await mkdir4(dirname4(output), { recursive: true });
setLocalModelCacheDir(process.env.DSH_MODEL_CACHE ?? join6(process.env.DSH_HOME ?? join6(homedir2(), ".dsh"), "cache/dsh-knowledge/local-models"));
var manager = new OcrAcceleration();
var internal = manager;
manager.configure({ localOcrGpuWorkers: Number(process.env.DSH_BENCH_GPU_WORKERS ?? "8") });
if (Number(process.env.DSH_BENCH_GPU_WORKERS) > 8) internal.gpuWorkers = Math.min(16, Number(process.env.DSH_BENCH_GPU_WORKERS));
var pages = [];
var docs = [];
var ocrPages = 0;
var ocrStarted;
var ocrFinished;
var recognize = OcrPool.prototype.recognize;
OcrPool.prototype.recognize = async function(...args) {
  ocrStarted ??= performance.now();
  const result = await recognize.apply(this, args);
  ocrPages++;
  ocrFinished = performance.now();
  return result;
};
var makeLane = internal.makeLane.bind(manager);
internal.makeLane = (device) => {
  const lane = makeLane(device), request = lane.process.request.bind(lane.process);
  if (device.device === "CPU" && process.env.DSH_BENCH_CPU_THREADS) {
    lane.process.args[lane.process.args.indexOf("--threads") + 1] = process.env.DSH_BENCH_CPU_THREADS;
    lane.process.env.OMP_NUM_THREADS = process.env.DSH_BENCH_CPU_THREADS;
  }
  lane.process.request = async (...args) => {
    const start = performance.now();
    try {
      const result = await request(...args);
      pages.push({ device: device.device, ms: performance.now() - start, inferenceMs: result.elapsedMs, chars: String(result.text ?? "").length });
      return result;
    } catch (error) {
      pages.push({ device: device.device, ms: performance.now() - start, error: String(error) });
      throw error;
    }
  };
  return lane;
};
await manager.status();
if (process.env.DSH_BENCH_CPU_WORKERS) {
  const wanted = Number(process.env.DSH_BENCH_CPU_WORKERS), cpus = internal.lanes.filter((lane) => lane.device.device === "CPU");
  const template = cpus[0]?.device;
  while (cpus.length > wanted) {
    const lane = cpus.pop();
    internal.lanes.splice(internal.lanes.indexOf(lane), 1);
    lane.process.dispose();
  }
  while (cpus.length < wanted) {
    const lane = internal.makeLane(template);
    internal.lanes.push(lane);
    cpus.push(lane);
  }
}
for (const [device, key] of [["NPU", "DSH_BENCH_NPU_WORKERS"], ["GPU", "DSH_BENCH_IGPU_WORKERS"]]) {
  const count = Math.max(1, Math.min(2, Number(process.env[key] ?? "1"))), template = internal.lanes.find((lane) => lane.device.device === device)?.device;
  if (template) for (let i = 1; i < count; i++) internal.lanes.push(internal.makeLane(template));
}
useOcrAcceleration(manager);
var files = [];
async function walk(dir) {
  for (const item of (await readdir3(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.isDirectory()) await walk(join6(dir, item.name));
    else if (/\.pdf$/i.test(item.name)) files.push(join6(dir, item.name));
  }
}
await walk(root);
if (Number(limitArg) > 0) files.splice(Number(limitArg));
var manifest = createHash3("sha256");
for (const file of files) {
  manifest.update(relative(root, file));
  manifest.update(await readFile4(file));
}
var next = 0;
var started = performance.now();
var peakRss = 0;
var monitor = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 200);
var saveTail = Promise.resolve();
async function save() {
  const snapshot = JSON.stringify({ environment: { gpuWorkers: process.env.DSH_BENCH_GPU_WORKERS ?? "8", cpuWorkers: process.env.DSH_BENCH_CPU_WORKERS ?? "auto", cpuThreads: process.env.DSH_BENCH_CPU_THREADS ?? "auto", npuWorkers: process.env.DSH_BENCH_NPU_WORKERS ?? "1", igpuWorkers: process.env.DSH_BENCH_IGPU_WORKERS ?? "1" }, corpusHash: manifest.copy().digest("hex"), documents: files.length, completed: docs.length, parallel: Number(parallelArg), seconds: (performance.now() - started) / 1e3, hostPeakRss: peakRss, ocrPages, ocrSpanSeconds: ocrStarted === void 0 ? 0 : ((ocrFinished ?? performance.now()) - ocrStarted) / 1e3, devices: await manager.status(), requests: pages, results: docs }, null, 2);
  saveTail = saveTail.then(async () => {
    await writeFile3(output + ".tmp", snapshot);
    await rename3(output + ".tmp", output);
  });
  await saveTail;
}
process.once("SIGINT", () => {
  void disposeOcrWorker().finally(() => {
    manager.dispose();
    process.exit(130);
  });
});
try {
  await Promise.all(Array.from({ length: Math.max(1, Number(parallelArg)) }, async () => {
    for (; ; ) {
      const file = files[next++];
      if (!file) return;
      const start = performance.now();
      const row = { file: relative(root, file) };
      try {
        const text = await parseDocumentBuffer(await readFile4(file), file, "application/pdf");
        Object.assign(row, { chars: text.length, hash: createHash3("sha256").update(text).digest("hex") });
      } catch (error) {
        row.error = String(error);
      }
      row.ms = performance.now() - start;
      docs.push(row);
      console.log(JSON.stringify({ completed: docs.length, total: files.length, ...row }));
      await save();
    }
  }));
} finally {
  clearInterval(monitor);
  try {
    await save();
  } finally {
    await disposeOcrWorker();
    manager.dispose();
    await disposePdfParsers();
  }
}
console.log(JSON.stringify({ output, seconds: (performance.now() - started) / 1e3, ocrPages, inferenceRequests: pages.length, documents: docs.length }));
process.exit(docs.some((row) => row.error) ? 1 : 0);
//# sourceMappingURL=benchmark-ocr.mjs.map
