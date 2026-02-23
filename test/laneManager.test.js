import test from 'node:test';
import assert from 'node:assert/strict';
import { LaneManager } from '../src/concurrency/laneManager.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('creates 4 lanes with default concurrency', () => {
  const lm = new LaneManager();
  const snapshot = lm.snapshot();

  assert.ok(snapshot.search, 'Expected search lane');
  assert.ok(snapshot.fetch, 'Expected fetch lane');
  assert.ok(snapshot.parse, 'Expected parse lane');
  assert.ok(snapshot.llm, 'Expected llm lane');

  assert.equal(snapshot.search.concurrency, 2);
  assert.equal(snapshot.fetch.concurrency, 4);
  assert.equal(snapshot.parse.concurrency, 4);
  assert.equal(snapshot.llm.concurrency, 2);
});

test('creates lanes with custom concurrency', () => {
  const lm = new LaneManager({
    search: { concurrency: 1 },
    fetch: { concurrency: 8 },
    parse: { concurrency: 6 },
    llm: { concurrency: 3 }
  });
  const snapshot = lm.snapshot();

  assert.equal(snapshot.search.concurrency, 1);
  assert.equal(snapshot.fetch.concurrency, 8);
  assert.equal(snapshot.parse.concurrency, 6);
  assert.equal(snapshot.llm.concurrency, 3);
});

test('dispatch runs task in correct lane', async () => {
  const lm = new LaneManager();
  let ran = false;

  const result = await lm.dispatch('search', async () => {
    ran = true;
    return 42;
  });

  assert.ok(ran, 'Task should have run');
  assert.equal(result, 42);

  const snapshot = lm.snapshot();
  assert.equal(snapshot.search.completed, 1);
});

test('dispatch throws for unknown lane', async () => {
  const lm = new LaneManager();
  await assert.rejects(
    () => lm.dispatch('invalid', async () => {}),
    (err) => err.message.includes('Unknown lane')
  );
});

test('pause prevents new tasks from starting, resume unblocks', async () => {
  const lm = new LaneManager({ search: { concurrency: 1 } });
  lm.pause('search');

  const snapshot = lm.snapshot();
  assert.equal(snapshot.search.paused, true);

  let started = false;
  const taskPromise = lm.dispatch('search', async () => {
    started = true;
    return 'done';
  });

  await delay(50);
  assert.equal(started, false, 'Task should not start while paused');

  lm.resume('search');
  const result = await taskPromise;
  assert.equal(result, 'done');
  assert.equal(started, true, 'Task should run after resume');
});

test('setConcurrency changes lane concurrency at runtime', () => {
  const lm = new LaneManager({ fetch: { concurrency: 4 } });

  lm.setConcurrency('fetch', 8);
  const snapshot = lm.snapshot();
  assert.equal(snapshot.fetch.concurrency, 8);
});

test('setConcurrency clamps to minimum 1', () => {
  const lm = new LaneManager();
  lm.setConcurrency('search', 0);
  const snapshot = lm.snapshot();
  assert.equal(snapshot.search.concurrency, 1);
});

test('snapshot reports per-lane stats', async () => {
  const lm = new LaneManager();
  await lm.dispatch('search', async () => 'a');
  await lm.dispatch('fetch', async () => 'b');
  await lm.dispatch('fetch', async () => 'c');

  const snapshot = lm.snapshot();
  assert.equal(snapshot.search.completed, 1);
  assert.equal(snapshot.fetch.completed, 2);
  assert.equal(snapshot.parse.completed, 0);
  assert.equal(snapshot.llm.completed, 0);
});

test('drain waits for all lanes to complete', async () => {
  const lm = new LaneManager();
  let count = 0;

  lm.dispatch('search', async () => { await delay(20); count += 1; });
  lm.dispatch('fetch', async () => { await delay(20); count += 1; });
  lm.dispatch('parse', async () => { await delay(20); count += 1; });

  await lm.drain();
  assert.equal(count, 3, 'All tasks should complete before drain resolves');
});

test('withBudgetGuard rejects task when budget check fails', async () => {
  const lm = new LaneManager();
  const mockBudget = { canFetchUrl: () => false };

  const result = await lm.dispatchWithBudget('fetch', async () => 'done', {
    budgetEnforcer: mockBudget,
    budgetCheck: 'canFetchUrl'
  });

  assert.equal(result, null, 'Should return null when budget exhausted');
  const snapshot = lm.snapshot();
  assert.equal(snapshot.fetch.completed, 0, 'Task should not have run');
  assert.equal(snapshot.fetch.budget_rejected, 1, 'Should track budget rejections');
});

test('withBudgetGuard runs task when budget check passes', async () => {
  const lm = new LaneManager();
  const mockBudget = { canFetchUrl: () => true };

  const result = await lm.dispatchWithBudget('fetch', async () => 'done', {
    budgetEnforcer: mockBudget,
    budgetCheck: 'canFetchUrl'
  });

  assert.equal(result, 'done');
  const snapshot = lm.snapshot();
  assert.equal(snapshot.fetch.completed, 1);
});
