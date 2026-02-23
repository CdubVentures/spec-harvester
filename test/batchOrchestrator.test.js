import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchOrchestrator } from '../src/pipeline/batchOrchestrator.js';

function makeOrchestrator(options = {}) {
  return new BatchOrchestrator({
    maxRetries: options.maxRetries ?? 2,
    runProduct: options.runProduct ?? (async () => ({ status: 'done' }))
  });
}

test('createBatch initializes batch with pending status', () => {
  const orch = makeOrchestrator();
  const batch = orch.createBatch({
    batchId: 'batch-1',
    category: 'mouse',
    products: [
      { productId: 'mouse-a', s3key: 'specs/mouse/a.json' },
      { productId: 'mouse-b', s3key: 'specs/mouse/b.json' }
    ]
  });

  assert.equal(batch.batchId, 'batch-1');
  assert.equal(batch.status, 'pending');
  assert.equal(batch.products.length, 2);
  assert.equal(batch.products[0].status, 'pending');
  assert.equal(batch.products[1].status, 'pending');
});

test('getBatch returns null for unknown batch', () => {
  const orch = makeOrchestrator();
  assert.equal(orch.getBatch('nonexistent'), null);
});

test('startBatch transitions batch from pending to running', () => {
  const orch = makeOrchestrator();
  orch.createBatch({
    batchId: 'batch-1',
    category: 'mouse',
    products: [{ productId: 'mouse-a', s3key: 'a.json' }]
  });

  const batch = orch.startBatch('batch-1');
  assert.equal(batch.status, 'running');
});

test('startBatch throws for unknown batch', () => {
  const orch = makeOrchestrator();
  assert.throws(() => orch.startBatch('nonexistent'), /not found/i);
});

test('pauseBatch transitions running batch to paused', () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.startBatch('b1');

  const batch = orch.pauseBatch('b1');
  assert.equal(batch.status, 'paused');
});

test('resumeBatch transitions paused batch to running', () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.startBatch('b1');
  orch.pauseBatch('b1');

  const batch = orch.resumeBatch('b1');
  assert.equal(batch.status, 'running');
});

test('cancelBatch transitions to cancelled', () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.startBatch('b1');

  const batch = orch.cancelBatch('b1');
  assert.equal(batch.status, 'cancelled');
});

test('runNextProduct processes products sequentially', async () => {
  const ran = [];
  const orch = makeOrchestrator({
    runProduct: async ({ productId }) => {
      ran.push(productId);
      return { status: 'done' };
    }
  });
  orch.createBatch({
    batchId: 'b1',
    category: 'mouse',
    products: [
      { productId: 'mouse-a' },
      { productId: 'mouse-b' },
      { productId: 'mouse-c' }
    ]
  });
  orch.startBatch('b1');

  const r1 = await orch.runNextProduct('b1');
  assert.equal(r1.productId, 'mouse-a');
  assert.equal(r1.status, 'done');

  const r2 = await orch.runNextProduct('b1');
  assert.equal(r2.productId, 'mouse-b');

  const r3 = await orch.runNextProduct('b1');
  assert.equal(r3.productId, 'mouse-c');

  const r4 = await orch.runNextProduct('b1');
  assert.equal(r4, null);

  assert.deepStrictEqual(ran, ['mouse-a', 'mouse-b', 'mouse-c']);

  const batch = orch.getBatch('b1');
  assert.equal(batch.status, 'completed');
});

test('failed product retries up to maxRetries then skips', async () => {
  let callCount = 0;
  const orch = makeOrchestrator({
    maxRetries: 2,
    runProduct: async ({ productId }) => {
      callCount += 1;
      if (productId === 'mouse-fail') throw new Error('network timeout');
      return { status: 'done' };
    }
  });
  orch.createBatch({
    batchId: 'b1',
    category: 'mouse',
    products: [{ productId: 'mouse-fail' }, { productId: 'mouse-ok' }]
  });
  orch.startBatch('b1');

  const r1 = await orch.runNextProduct('b1');
  assert.equal(r1.productId, 'mouse-fail');
  assert.equal(r1.status, 'skipped');

  const batch = orch.getBatch('b1');
  const failProduct = batch.products.find((p) => p.productId === 'mouse-fail');
  assert.equal(failProduct.status, 'skipped');
  assert.equal(failProduct.retries, 2);

  const r2 = await orch.runNextProduct('b1');
  assert.equal(r2.productId, 'mouse-ok');
  assert.equal(r2.status, 'done');
});

test('paused batch runNextProduct returns null', async () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.startBatch('b1');
  orch.pauseBatch('b1');

  const result = await orch.runNextProduct('b1');
  assert.equal(result, null);
});

test('snapshot returns batch summary', () => {
  const orch = makeOrchestrator();
  orch.createBatch({
    batchId: 'b1',
    category: 'mouse',
    products: [
      { productId: 'mouse-a' },
      { productId: 'mouse-b' }
    ]
  });

  const snapshot = orch.snapshot('b1');
  assert.equal(snapshot.batchId, 'b1');
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.pending, 2);
  assert.equal(snapshot.done, 0);
  assert.equal(snapshot.failed, 0);
  assert.equal(snapshot.skipped, 0);
});

test('listBatches returns all batch summaries', () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.createBatch({ batchId: 'b2', category: 'monitor', products: [{ productId: 'b' }] });

  const list = orch.listBatches();
  assert.equal(list.length, 2);
  assert.ok(list.some((b) => b.batchId === 'b1'));
  assert.ok(list.some((b) => b.batchId === 'b2'));
});

test('addProduct adds to pending batch', () => {
  const orch = makeOrchestrator();
  orch.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  orch.addProduct('b1', { productId: 'b' });

  const batch = orch.getBatch('b1');
  assert.equal(batch.products.length, 2);
});

test('removeProduct removes from pending batch', () => {
  const orch = makeOrchestrator();
  orch.createBatch({
    batchId: 'b1',
    category: 'mouse',
    products: [{ productId: 'a' }, { productId: 'b' }]
  });
  orch.removeProduct('b1', 'a');

  const batch = orch.getBatch('b1');
  assert.equal(batch.products.length, 1);
  assert.equal(batch.products[0].productId, 'b');
});
