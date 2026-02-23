function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export class AutomationWorker {
  constructor({ queue, handlers = {}, ttlMs = 86400000, maxDomainFailures = 3, backoffBaseMs = 1000 }) {
    this._queue = queue;
    this._handlers = handlers;
    this._ttlMs = ttlMs;
    this._maxDomainFailures = maxDomainFailures;
    this._backoffBaseMs = backoffBaseMs;
    this._domainState = new Map();
  }

  consumeNext() {
    const queued = this._queue.queryByStatus('queued');

    for (const job of queued) {
      const domain = extractDomain(job.payload?.url || '');
      if (domain && this._isDomainBlocked(domain)) continue;
      return this._queue.transition(job.id, 'running');
    }

    return null;
  }

  applyTTL() {
    const now = Date.now();
    const queued = this._queue.queryByStatus('queued');
    let expired = 0;

    for (const job of queued) {
      const createdAt = new Date(job.created_at).getTime();
      if (now - createdAt > this._ttlMs) {
        this._queue.transition(job.id, 'running');
        this._queue.transition(job.id, 'failed');
        expired += 1;
      }
    }

    return expired;
  }

  recordDomainFailure(domain) {
    const state = this._domainState.get(domain) || { failures: 0, lastFailure: 0 };
    state.failures += 1;
    state.lastFailure = Date.now();
    this._domainState.set(domain, state);
  }

  recordDomainSuccess(domain) {
    this._domainState.set(domain, { failures: 0, lastFailure: 0 });
  }

  getDomainBackoffState(domain) {
    const state = this._domainState.get(domain) || { failures: 0, lastFailure: 0 };
    const backoffMs = state.failures > 0 ? this._backoffBaseMs * Math.pow(2, state.failures - 1) : 0;
    const blocked = state.failures >= this._maxDomainFailures;
    return { failures: state.failures, backoffMs, blocked };
  }

  async executeJob(job) {
    const handler = this._handlers[job.job_type];

    if (!handler) {
      this._queue.transition(job.id, 'failed');
      return { ...this._queue.getJob(job.id), status: 'failed' };
    }

    try {
      await handler(job.payload);
      this._queue.transition(job.id, 'done');
      const domain = extractDomain(job.payload?.url || '');
      if (domain) this.recordDomainSuccess(domain);
      return { ...this._queue.getJob(job.id), status: 'done' };
    } catch {
      this._queue.transition(job.id, 'failed');
      const domain = extractDomain(job.payload?.url || '');
      if (domain) this.recordDomainFailure(domain);
      return { ...this._queue.getJob(job.id), status: 'failed' };
    }
  }

  async runOnce() {
    this.applyTTL();
    const job = this.consumeNext();
    if (!job) return null;
    return this.executeJob(job);
  }

  _isDomainBlocked(domain) {
    const state = this._domainState.get(domain);
    if (!state) return false;
    if (state.failures >= this._maxDomainFailures) return true;
    const backoffMs = this._backoffBaseMs * Math.pow(2, state.failures - 1);
    return Date.now() - state.lastFailure < backoffMs;
  }
}
