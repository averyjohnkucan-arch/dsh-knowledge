import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class ModelProcess {
  #child;
  #requests = new Map();
  #serial = 0;
  #tail = Promise.resolve();
  #idle;
  #closed = false;

  constructor(idleSeconds = 120) {
    this.idleSeconds = idleSeconds;
  }

  call(method, args = [], timeout = 120_000) {
    const task = this.#tail.then(() => this.#send(method, args, timeout));
    this.#tail = task.catch(() => {});
    return task;
  }

  #send(method, args, timeout) {
    if (this.#closed) throw new Error('Knowledge is shutting down');
    clearTimeout(this.#idle);
    if (!this.#child) {
      const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
      this.#child = child;
      child.on('message', (message) => this.#requests.get(message.id)?.(message));
      const failed = (error) => {
        if (this.#child !== child) return;
        this.stop(error.message);
      };
      child.once('error', failed);
      child.once('exit', (code, signal) =>
        failed(new Error('Model worker exited (' + (signal || code) + ')')),
      );
    }
    const id = ++this.#serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('Model worker timed out'), timeout);
      this.#requests.set(id, ({ error, value }) => {
        clearTimeout(timer);
        this.#requests.delete(id);
        if (this.idleSeconds > 0) {
          this.#idle = setTimeout(() => this.stop(), this.idleSeconds * 1000);
          this.#idle.unref();
        }
        if (error) reject(new Error(error));
        else resolve(value);
      });
      const child = this.#child;
      child.send({ id, method, args }, (error) => {
        if (error && this.#child === child) this.stop(error.message);
      });
    });
  }

  close() {
    this.#closed = true;
    this.stop('Knowledge is shutting down');
  }

  stop(reason = 'Model worker stopped') {
    const child = this.#child;
    this.#child = undefined;
    for (const settle of this.#requests.values()) settle({ error: reason });
    clearTimeout(this.#idle);
    child?.kill('SIGKILL');
  }
}
