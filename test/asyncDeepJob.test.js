import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncDeepJob, AsyncDeepJobQueue } from '../src/concurrency/asyncDeepJob.js';

// ---------------------------------------------------------------------------
// IP05-5D — Async Deep Jobs Tests
// ---------------------------------------------------------------------------

test('job: creates with pending status', () => {
  const job = new AsyncDeepJob({
    id: 'j1',
    productId: 'mouse-001',
    field: 'sensor',
    tier: 'xhigh'
  });
  assert.equal(job.status, 'pending');
  assert.equal(job.id, 'j1');
  assert.equal(job.field, 'sensor');
});

test('job: start transitions to running', () => {
  const job = new AsyncDeepJob({ id: 'j1', productId: 'p1', field: 'f1', tier: 'high' });
  job.start();
  assert.equal(job.status, 'running');
  assert.ok(job.startedAt);
});

test('job: complete transitions to completed with result', () => {
  const job = new AsyncDeepJob({ id: 'j1', productId: 'p1', field: 'f1', tier: 'high' });
  job.start();
  job.complete({ value: 'HERO 25K' });
  assert.equal(job.status, 'completed');
  assert.deepEqual(job.result, { value: 'HERO 25K' });
  assert.ok(job.completedAt);
});

test('job: fail transitions to failed with error', () => {
  const job = new AsyncDeepJob({ id: 'j1', productId: 'p1', field: 'f1', tier: 'high' });
  job.start();
  job.fail('timeout');
  assert.equal(job.status, 'failed');
  assert.equal(job.error, 'timeout');
});

test('job: isTimedOut returns true after timebox exceeded', () => {
  const job = new AsyncDeepJob({
    id: 'j1', productId: 'p1', field: 'f1', tier: 'high',
    timeboxMs: 100
  });
  job.start();
  job._startedAt = Date.now() - 200;
  assert.equal(job.isTimedOut(), true);
});

test('job: isTimedOut returns false when within timebox', () => {
  const job = new AsyncDeepJob({
    id: 'j1', productId: 'p1', field: 'f1', tier: 'high',
    timeboxMs: 60_000
  });
  job.start();
  assert.equal(job.isTimedOut(), false);
});

test('job: snapshot returns all fields', () => {
  const job = new AsyncDeepJob({ id: 'j1', productId: 'p1', field: 'sensor', tier: 'xhigh' });
  const snap = job.snapshot();
  assert.equal(snap.id, 'j1');
  assert.equal(snap.productId, 'p1');
  assert.equal(snap.field, 'sensor');
  assert.equal(snap.tier, 'xhigh');
  assert.equal(snap.status, 'pending');
});

// --- Queue tests ---

test('queue: submit adds job and returns it', () => {
  const q = new AsyncDeepJobQueue();
  const job = q.submit({ productId: 'p1', field: 'sensor', tier: 'high' });
  assert.ok(job.id);
  assert.equal(job.status, 'pending');
});

test('queue: poll returns next pending job', () => {
  const q = new AsyncDeepJobQueue();
  q.submit({ productId: 'p1', field: 'sensor', tier: 'high' });
  q.submit({ productId: 'p1', field: 'weight', tier: 'xhigh' });
  const next = q.poll();
  assert.ok(next);
  assert.equal(next.status, 'running');
  assert.equal(next.field, 'sensor'); // FIFO
});

test('queue: poll returns null when queue is empty', () => {
  const q = new AsyncDeepJobQueue();
  assert.equal(q.poll(), null);
});

test('queue: getJob retrieves by id', () => {
  const q = new AsyncDeepJobQueue();
  const job = q.submit({ productId: 'p1', field: 'sensor', tier: 'high' });
  const found = q.getJob(job.id);
  assert.equal(found.id, job.id);
});

test('queue: stats tracks pending, running, completed, failed', () => {
  const q = new AsyncDeepJobQueue();
  q.submit({ productId: 'p1', field: 'a', tier: 'high' });
  q.submit({ productId: 'p1', field: 'b', tier: 'high' });
  const j = q.poll();
  j.complete({ v: 1 });

  const stats = q.stats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.running, 0);
  assert.equal(stats.completed, 1);
  assert.equal(stats.total, 2);
});

test('queue: reapTimedOut marks timed-out running jobs as failed', () => {
  const q = new AsyncDeepJobQueue();
  q.submit({ productId: 'p1', field: 'sensor', tier: 'high', timeboxMs: 50 });
  const j = q.poll();
  j._startedAt = Date.now() - 100;
  const reaped = q.reapTimedOut();
  assert.equal(reaped, 1);
  assert.equal(j.status, 'failed');
  assert.ok(j.error.includes('timeout'));
});

test('queue: forProduct returns all jobs for a product', () => {
  const q = new AsyncDeepJobQueue();
  q.submit({ productId: 'p1', field: 'a', tier: 'high' });
  q.submit({ productId: 'p2', field: 'b', tier: 'high' });
  q.submit({ productId: 'p1', field: 'c', tier: 'xhigh' });
  const p1Jobs = q.forProduct('p1');
  assert.equal(p1Jobs.length, 2);
});
