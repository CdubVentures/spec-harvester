import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AutomationQueue } from '../src/pipeline/automationQueue.js';
import { AutomationWorker } from '../src/pipeline/automationWorker.js';

function makeQueue() {
  const db = new Database(':memory:');
  return { db, queue: new AutomationQueue(db) };
}

function makeWorker(queue, handlers = {}, options = {}) {
  return new AutomationWorker({
    queue,
    handlers,
    ttlMs: options.ttlMs ?? 24 * 60 * 60 * 1000,
    maxDomainFailures: options.maxDomainFailures ?? 3,
    backoffBaseMs: options.backoffBaseMs ?? 1000
  });
}

test('consumeNext dequeues oldest queued job and marks it running', () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });
  queue.enqueue({ jobType: 'repair_search', dedupeKey: 'k2', payload: { query: 'test' } });

  const worker = makeWorker(queue);
  const job = worker.consumeNext();

  assert.ok(job, 'Expected a dequeued job');
  assert.equal(job.dedupe_key, 'k1');
  assert.equal(job.status, 'running');

  db.close();
});

test('consumeNext returns null when queue is empty', () => {
  const { db, queue } = makeQueue();
  const worker = makeWorker(queue);
  const job = worker.consumeNext();
  assert.equal(job, null);
  db.close();
});

test('consumeNext skips jobs blocked by domain backoff', () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://blocked.com/page1' } });
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k2', payload: { url: 'https://good.com/page1' } });

  const worker = makeWorker(queue, {}, { maxDomainFailures: 2 });
  worker.recordDomainFailure('blocked.com');
  worker.recordDomainFailure('blocked.com');

  const job = worker.consumeNext();
  assert.ok(job, 'Expected a dequeued job');
  assert.equal(job.payload.url, 'https://good.com/page1');

  db.close();
});

test('applyTTL marks stale queued jobs as failed', () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });

  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE automation_jobs SET created_at = ? WHERE id = ?').run(twoDaysAgo, job.id);

  const worker = makeWorker(queue, {}, { ttlMs: 24 * 60 * 60 * 1000 });
  const expired = worker.applyTTL();

  assert.ok(expired >= 1, `Expected at least 1 expired job, got ${expired}`);

  const updated = queue.getJob(job.id);
  assert.equal(updated.status, 'failed');

  db.close();
});

test('applyTTL does not expire fresh jobs', () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });

  const worker = makeWorker(queue, {}, { ttlMs: 24 * 60 * 60 * 1000 });
  const expired = worker.applyTTL();

  assert.equal(expired, 0);

  db.close();
});

test('domainBackoff tracks consecutive failures and applies exponential delay', () => {
  const { db, queue } = makeQueue();
  const worker = makeWorker(queue, {}, { maxDomainFailures: 5, backoffBaseMs: 100 });

  worker.recordDomainFailure('bad.com');
  worker.recordDomainFailure('bad.com');

  const state = worker.getDomainBackoffState('bad.com');
  assert.equal(state.failures, 2);
  assert.ok(state.backoffMs >= 200, `Expected backoff >= 200ms, got ${state.backoffMs}`);
  assert.equal(state.blocked, false);

  db.close();
});

test('domainBackoff blocks domain after max failures', () => {
  const { db, queue } = makeQueue();
  const worker = makeWorker(queue, {}, { maxDomainFailures: 3 });

  worker.recordDomainFailure('bad.com');
  worker.recordDomainFailure('bad.com');
  worker.recordDomainFailure('bad.com');

  const state = worker.getDomainBackoffState('bad.com');
  assert.equal(state.blocked, true);
  assert.equal(state.failures, 3);

  db.close();
});

test('domainBackoff resets on success', () => {
  const { db, queue } = makeQueue();
  const worker = makeWorker(queue, {}, { maxDomainFailures: 3 });

  worker.recordDomainFailure('flaky.com');
  worker.recordDomainFailure('flaky.com');
  worker.recordDomainSuccess('flaky.com');

  const state = worker.getDomainBackoffState('flaky.com');
  assert.equal(state.failures, 0);
  assert.equal(state.blocked, false);

  db.close();
});

test('executeJob calls handler and transitions to done on success', async () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });

  let handlerCalled = false;
  const handlers = {
    refetch: async (payload) => { handlerCalled = true; return { success: true }; }
  };

  const worker = makeWorker(queue, handlers);
  const consumed = worker.consumeNext();
  const result = await worker.executeJob(consumed);

  assert.ok(handlerCalled, 'Expected handler to be called');
  assert.equal(result.status, 'done');

  const final = queue.getJob(job.id);
  assert.equal(final.status, 'done');

  db.close();
});

test('executeJob transitions to failed when handler throws', async () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://fail.com/page' } });

  const handlers = {
    refetch: async () => { throw new Error('network error'); }
  };

  const worker = makeWorker(queue, handlers, { maxDomainFailures: 5 });
  const consumed = worker.consumeNext();
  const result = await worker.executeJob(consumed);

  assert.equal(result.status, 'failed');

  const state = worker.getDomainBackoffState('fail.com');
  assert.equal(state.failures, 1);

  db.close();
});

test('executeJob transitions to failed for unknown job type', async () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'unknown_type', dedupeKey: 'k1', payload: {} });

  const worker = makeWorker(queue, {});
  const consumed = worker.consumeNext();
  const result = await worker.executeJob(consumed);

  assert.equal(result.status, 'failed');

  db.close();
});

test('runOnce: dequeues, executes, returns result', async () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });

  const handlers = {
    refetch: async () => ({ success: true })
  };

  const worker = makeWorker(queue, handlers);
  const result = await worker.runOnce();

  assert.ok(result, 'Expected result from runOnce');
  assert.equal(result.status, 'done');

  db.close();
});

test('runOnce: returns null when queue is empty', async () => {
  const { db, queue } = makeQueue();
  const worker = makeWorker(queue, {});
  const result = await worker.runOnce();
  assert.equal(result, null);
  db.close();
});
