/**
 * Worker pool for CPU-bound watermark processing.
 *
 * Each worker is a long-lived Node worker_thread that loads the engine/processors
 * module once and processes jobs sent via postMessage. The pool keeps a configurable
 * number of workers alive, dispatches incoming tasks round-robin to idle workers,
 * and queues tasks when all workers are busy.
 *
 * Sized from settings.maxConcurrent. Resize at runtime via resize().
 */
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const crypto = require('node:crypto');

const WORKER_SCRIPT = path.join(__dirname, 'worker.js');

class WorkerPool {
  constructor(size) {
    this.size = Math.max(1, Math.min(32, Number(size) || 1));
    this.workers = [];
    this.idle = [];
    this.tasks = [];
    this.pending = new Map(); // jobId -> { resolve, reject, worker }
    for (let i = 0; i < this.size; i += 1) this._spawn();
  }

  _spawn() {
    let w;
    try {
      w = new Worker(WORKER_SCRIPT);
    } catch (err) {
      // Constructor failure (e.g. file not found, asar resolution failed).
      // Log via stderr so it ends up in the Electron startup-error.log,
      // and reject any queued tasks so the renderer sees a real error
      // instead of hanging.
      console.error('WorkerPool spawn failed:', err && (err.stack || err.message || err));
      const drained = this.tasks.splice(0);
      for (const t of drained) t.reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    w._id = crypto.randomUUID();
    w._terminated = false;
    w.on('message', (msg) => this._onMessage(w, msg));
    w.on('error', (err) => this._onError(w, err));
    w.on('exit', (code) => this._onExit(w, code));
    this.workers.push(w);
    this.idle.push(w);
  }

  _onMessage(w, msg) {
    if (!msg || !msg.jobId) return;
    const ctx = this.pending.get(msg.jobId);
    if (!ctx) return;
    this.pending.delete(msg.jobId);
    if (msg.error) {
      const err = new Error(msg.error);
      if (msg.stack) err.stack = msg.stack;
      ctx.reject(err);
    } else {
      ctx.resolve(msg.result);
    }
    if (!w._terminated) {
      this.idle.push(w);
      this._dispatch();
    }
  }

  _onError(w, err) {
    // Reject any task this worker was processing
    for (const [id, ctx] of this.pending) {
      if (ctx.worker === w) {
        ctx.reject(err);
        this.pending.delete(id);
      }
    }
    this._removeWorker(w);
    if (this.workers.length < this.size) this._spawn();
    this._dispatch();
  }

  _onExit(w, code) {
    if (!w._terminated && code !== 0) {
      for (const [id, ctx] of this.pending) {
        if (ctx.worker === w) {
          ctx.reject(new Error(`Worker exited unexpectedly (code ${code})`));
          this.pending.delete(id);
        }
      }
      this._removeWorker(w);
      if (this.workers.length < this.size) this._spawn();
      this._dispatch();
    }
  }

  _removeWorker(w) {
    w._terminated = true;
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
  }

  _dispatch() {
    while (this.tasks.length > 0 && this.idle.length > 0) {
      const w = this.idle.shift();
      const task = this.tasks.shift();
      this.pending.set(task.jobId, { ...task, worker: w });
      w.postMessage({ jobId: task.jobId, ...task.payload });
    }
  }

  exec(payload) {
    return new Promise((resolve, reject) => {
      const jobId = crypto.randomUUID();
      this.tasks.push({ jobId, payload, resolve, reject });
      this._dispatch();
    });
  }

  async resize(newSize) {
    newSize = Math.max(1, Math.min(32, Number(newSize) || 1));
    if (newSize === this.size) return;
    this.size = newSize;
    while (this.workers.length < newSize) this._spawn();
    while (this.workers.length > newSize) {
      const w = this.idle.pop();
      if (!w) break; // all busy; will shrink as they finish (best-effort)
      w._terminated = true;
      this.workers = this.workers.filter((x) => x !== w);
      try { await w.terminate(); } catch {}
    }
  }

  async destroy() {
    const all = this.workers.slice();
    this.workers = [];
    this.idle = [];
    for (const w of all) {
      w._terminated = true;
      try { await w.terminate(); } catch {}
    }
    for (const [, ctx] of this.pending) {
      ctx.reject(new Error('Worker pool destroyed'));
    }
    this.pending.clear();
    this.tasks = [];
  }

  stats() {
    return {
      size: this.size,
      total: this.workers.length,
      idle: this.idle.length,
      busy: this.workers.length - this.idle.length,
      queued: this.tasks.length,
      pending: this.pending.size,
    };
  }
}

module.exports = WorkerPool;
