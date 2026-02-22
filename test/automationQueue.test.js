import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { AutomationQueue } from '../src/pipeline/automationQueue.js';

function makeQueue() {
  const db = new Database(':memory:');
  return { db, queue: new AutomationQueue(db) };
}

test('enqueue job persists with status queued', () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'url:https://a.com', payload: { url: 'https://a.com' } });
  assert.ok(job.id);
  assert.equal(job.status, 'queued');
  assert.equal(job.job_type, 'refetch');
  db.close();
});

test('transition: queued → running → done', () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: {} });
  assert.equal(job.status, 'queued');

  const running = queue.transition(job.id, 'running');
  assert.equal(running.status, 'running');

  const done = queue.transition(job.id, 'done');
  assert.equal(done.status, 'done');
  db.close();
});

test('transition: queued → running → failed', () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'k2', payload: {} });
  queue.transition(job.id, 'running');

  const failed = queue.transition(job.id, 'failed');
  assert.equal(failed.status, 'failed');
  db.close();
});

test('dedupe: same dedupe_key returns existing job', () => {
  const { db, queue } = makeQueue();
  const job1 = queue.enqueue({ jobType: 'refetch', dedupeKey: 'same-key', payload: { a: 1 } });
  const job2 = queue.enqueue({ jobType: 'refetch', dedupeKey: 'same-key', payload: { a: 2 } });

  assert.equal(job1.id, job2.id);
  db.close();
});

test('query by status', () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: {} });
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k2', payload: {} });
  const job3 = queue.enqueue({ jobType: 'repair', dedupeKey: 'k3', payload: {} });
  queue.transition(job3.id, 'running');

  const queued = queue.queryByStatus('queued');
  assert.equal(queued.length, 2);

  const running = queue.queryByStatus('running');
  assert.equal(running.length, 1);
  assert.equal(running[0].id, job3.id);
  db.close();
});

test('query by job_type', () => {
  const { db, queue } = makeQueue();
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: {} });
  queue.enqueue({ jobType: 'repair', dedupeKey: 'k2', payload: {} });
  queue.enqueue({ jobType: 'refetch', dedupeKey: 'k3', payload: {} });

  const refetch = queue.queryByJobType('refetch');
  assert.equal(refetch.length, 2);

  const repair = queue.queryByJobType('repair');
  assert.equal(repair.length, 1);
  db.close();
});

test('getJob returns full job details', () => {
  const { db, queue } = makeQueue();
  const job = queue.enqueue({ jobType: 'refetch', dedupeKey: 'k1', payload: { url: 'https://a.com' } });
  const fetched = queue.getJob(job.id);
  assert.equal(fetched.id, job.id);
  assert.equal(fetched.job_type, 'refetch');
  assert.equal(fetched.dedupe_key, 'k1');
  db.close();
});

test('getJob returns null for unknown id', () => {
  const { db, queue } = makeQueue();
  assert.equal(queue.getJob(999), null);
  db.close();
});
