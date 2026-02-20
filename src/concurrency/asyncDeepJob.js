/**
 * Async Deep Jobs (IP05-5D).
 *
 * For deep tasks (vision, xhigh reasoning):
 *   - Async submission/poll pattern so the harvester isn't blocked
 *   - Timebox per product and per field
 *   - Queue with status tracking
 */

let _idCounter = 0;

export class AsyncDeepJob {
  constructor({ id, productId, field, tier, timeboxMs = 120_000 } = {}) {
    this.id = id || `deep-${++_idCounter}-${Date.now()}`;
    this.productId = String(productId || '');
    this.field = String(field || '');
    this.tier = String(tier || 'high');
    this.timeboxMs = Math.max(1, Number(timeboxMs) || 120_000);
    this.status = 'pending';
    this.result = null;
    this.error = null;
    this._createdAt = Date.now();
    this._startedAt = null;
    this._completedAt = null;
  }

  get startedAt() {
    return this._startedAt ? new Date(this._startedAt).toISOString() : null;
  }

  get completedAt() {
    return this._completedAt ? new Date(this._completedAt).toISOString() : null;
  }

  start() {
    this.status = 'running';
    this._startedAt = Date.now();
  }

  complete(result) {
    this.status = 'completed';
    this.result = result;
    this._completedAt = Date.now();
  }

  fail(error) {
    this.status = 'failed';
    this.error = String(error || 'unknown error');
    this._completedAt = Date.now();
  }

  isTimedOut() {
    if (this.status !== 'running' || !this._startedAt) return false;
    return (Date.now() - this._startedAt) > this.timeboxMs;
  }

  elapsedMs() {
    if (!this._startedAt) return 0;
    const end = this._completedAt || Date.now();
    return end - this._startedAt;
  }

  snapshot() {
    return {
      id: this.id,
      productId: this.productId,
      field: this.field,
      tier: this.tier,
      status: this.status,
      result: this.result,
      error: this.error,
      timeboxMs: this.timeboxMs,
      elapsedMs: this.elapsedMs(),
      startedAt: this.startedAt,
      completedAt: this.completedAt
    };
  }
}

export class AsyncDeepJobQueue {
  constructor() {
    this._jobs = new Map();
  }

  submit({ productId, field, tier, timeboxMs } = {}) {
    const job = new AsyncDeepJob({ productId, field, tier, timeboxMs });
    this._jobs.set(job.id, job);
    return job;
  }

  /**
   * Poll the next pending job (FIFO), transition it to running.
   */
  poll() {
    for (const job of this._jobs.values()) {
      if (job.status === 'pending') {
        job.start();
        return job;
      }
    }
    return null;
  }

  getJob(id) {
    return this._jobs.get(id) || null;
  }

  forProduct(productId) {
    const pid = String(productId || '');
    return [...this._jobs.values()].filter((j) => j.productId === pid);
  }

  /**
   * Reap timed-out running jobs.
   * Returns count of jobs that were reaped.
   */
  reapTimedOut() {
    let count = 0;
    for (const job of this._jobs.values()) {
      if (job.status === 'running' && job.isTimedOut()) {
        job.fail(`timeout after ${job.timeboxMs}ms`);
        count += 1;
      }
    }
    return count;
  }

  stats() {
    let pending = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    for (const job of this._jobs.values()) {
      if (job.status === 'pending') pending += 1;
      else if (job.status === 'running') running += 1;
      else if (job.status === 'completed') completed += 1;
      else if (job.status === 'failed') failed += 1;
    }
    return { total: this._jobs.size, pending, running, completed, failed };
  }
}
