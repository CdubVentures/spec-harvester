import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkerPool } from '../src/concurrency/workerPool.js';

// ---------------------------------------------------------------------------
// IP05-5A — Worker Pool + Concurrency Tests
// ---------------------------------------------------------------------------

test('pool: runs tasks up to concurrency limit', async () => {
  const pool = new WorkerPool({ concurrency: 2, name: 'test' });
  const running = [];
  const task = () =>
    new Promise((resolve) => {
      running.push(Date.now());
      setTimeout(resolve, 50);
    });

  await Promise.all([pool.run(task), pool.run(task), pool.run(task)]);
  assert.equal(running.length, 3);
  assert.equal(pool.stats().completed, 3);
});

test('pool: respects concurrency=1 (serial execution)', async () => {
  const pool = new WorkerPool({ concurrency: 1, name: 'serial' });
  const order = [];
  const makeTask = (id) => async () => {
    order.push(`start-${id}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push(`end-${id}`);
    return id;
  };

  const results = await Promise.all([
    pool.run(makeTask('a')),
    pool.run(makeTask('b')),
    pool.run(makeTask('c'))
  ]);
  assert.deepEqual(results, ['a', 'b', 'c']);
  // With concurrency 1, each must finish before next starts
  assert.equal(order[0], 'start-a');
  assert.equal(order[1], 'end-a');
  assert.equal(order[2], 'start-b');
});

test('pool: handles task errors without blocking pool', async () => {
  const pool = new WorkerPool({ concurrency: 2, name: 'error-test' });
  const failing = () => Promise.reject(new Error('boom'));
  const passing = () => Promise.resolve('ok');

  await assert.rejects(() => pool.run(failing), { message: 'boom' });
  const result = await pool.run(passing);
  assert.equal(result, 'ok');
  assert.equal(pool.stats().failed, 1);
  assert.equal(pool.stats().completed, 1);
});

test('pool: stats tracks active, queued, completed, failed', async () => {
  const pool = new WorkerPool({ concurrency: 1, name: 'stats' });
  let resolveTask;
  const blocker = () => new Promise((resolve) => { resolveTask = resolve; });

  const p1 = pool.run(blocker);
  const p2 = pool.run(() => Promise.resolve('done'));

  // While p1 is running, p2 should be queued
  const midStats = pool.stats();
  assert.equal(midStats.active, 1);
  assert.equal(midStats.queued, 1);

  resolveTask('first');
  await p1;
  await p2;

  const endStats = pool.stats();
  assert.equal(endStats.active, 0);
  assert.equal(endStats.queued, 0);
  assert.equal(endStats.completed, 2);
});

test('pool: default concurrency is 4', () => {
  const pool = new WorkerPool({ name: 'default' });
  assert.equal(pool.stats().concurrency, 4);
});

test('pool: name appears in stats', () => {
  const pool = new WorkerPool({ concurrency: 3, name: 'fetch' });
  assert.equal(pool.stats().name, 'fetch');
  assert.equal(pool.stats().concurrency, 3);
});

test('pool: drain waits for all active and queued tasks', async () => {
  const pool = new WorkerPool({ concurrency: 2, name: 'drain' });
  const results = [];

  pool.run(async () => {
    await new Promise((r) => setTimeout(r, 30));
    results.push('a');
  });
  pool.run(async () => {
    await new Promise((r) => setTimeout(r, 20));
    results.push('b');
  });
  pool.run(async () => {
    await new Promise((r) => setTimeout(r, 10));
    results.push('c');
  });

  await pool.drain();
  assert.equal(results.length, 3);
  assert.ok(results.includes('a'));
  assert.ok(results.includes('b'));
  assert.ok(results.includes('c'));
});

test('pool: high concurrency runs many tasks', async () => {
  const pool = new WorkerPool({ concurrency: 10, name: 'batch' });
  const ids = Array.from({ length: 25 }, (_, i) => i);
  const results = await Promise.all(
    ids.map((id) => pool.run(() => Promise.resolve(id * 2)))
  );
  assert.equal(results.length, 25);
  assert.equal(results[0], 0);
  assert.equal(results[24], 48);
  assert.equal(pool.stats().completed, 25);
});

test('pool: returns task result correctly', async () => {
  const pool = new WorkerPool({ concurrency: 2, name: 'return' });
  const result = await pool.run(() => Promise.resolve({ hello: 'world' }));
  assert.deepEqual(result, { hello: 'world' });
});
