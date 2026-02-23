import test from 'node:test';
import assert from 'node:assert/strict';
import { createBatchRouteHandler } from '../src/api/routes/batchRoutes.js';
import { BatchOrchestrator } from '../src/pipeline/batchOrchestrator.js';

function makeCtx() {
  const orchestrator = new BatchOrchestrator({
    maxRetries: 1,
    runProduct: async ({ productId }) => ({ status: 'done', productId })
  });
  const jsonRes = (res, status, body) => ({ status, body });
  const readJsonBody = async () => ({});
  return { orchestrator, jsonRes, readJsonBody };
}

function makeHandler(ctx) {
  return createBatchRouteHandler(ctx);
}

test('POST batch/create creates a new batch', async () => {
  const ctx = makeCtx();
  ctx.readJsonBody = async () => ({
    batchId: 'b1',
    category: 'mouse',
    products: [{ productId: 'mouse-a' }, { productId: 'mouse-b' }]
  });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'create'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.batchId, 'b1');
  assert.equal(result.body.products.length, 2);
});

test('GET batch/list returns all batches', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  ctx.orchestrator.createBatch({ batchId: 'b2', category: 'monitor', products: [{ productId: 'b' }] });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'list'], new URLSearchParams(), 'GET', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.batches.length, 2);
});

test('GET batch/status/:id returns batch snapshot', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'status', 'b1'], new URLSearchParams(), 'GET', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.batchId, 'b1');
  assert.equal(result.body.total, 1);
});

test('POST batch/start/:id starts a batch', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'start', 'b1'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'running');
});

test('POST batch/pause/:id pauses a running batch', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  ctx.orchestrator.startBatch('b1');
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'pause', 'b1'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'paused');
});

test('POST batch/cancel/:id cancels a batch', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  ctx.orchestrator.startBatch('b1');
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'cancel', 'b1'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'cancelled');
});

test('POST batch/add-product/:id adds product to batch', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }] });
  ctx.readJsonBody = async () => ({ productId: 'b' });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'add-product', 'b1'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.products.length, 2);
});

test('POST batch/remove-product/:id removes product', async () => {
  const ctx = makeCtx();
  ctx.orchestrator.createBatch({ batchId: 'b1', category: 'mouse', products: [{ productId: 'a' }, { productId: 'b' }] });
  ctx.readJsonBody = async () => ({ productId: 'a' });
  const handler = makeHandler(ctx);

  const result = await handler(['batch', 'remove-product', 'b1'], new URLSearchParams(), 'POST', {}, {});
  assert.equal(result.status, 200);
  assert.equal(result.body.products.length, 1);
});

test('unknown route returns false', async () => {
  const ctx = makeCtx();
  const handler = makeHandler(ctx);

  const result = await handler(['unknown'], new URLSearchParams(), 'GET', {}, {});
  assert.equal(result, false);
});
