import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  loadQueueState,
  markStaleQueueProducts,
  recordQueueFailure,
  selectNextQueueProduct,
  upsertQueueProduct
} from '../src/queue/queueState.js';

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });
}

test('selectNextQueueProduct skips paused and future-retry rows', () => {
  const now = Date.now();
  const next = selectNextQueueProduct({
    products: {
      'mouse-a': {
        productId: 'mouse-a',
        status: 'pending',
        next_retry_at: new Date(now + 60_000).toISOString()
      },
      'mouse-b': {
        productId: 'mouse-b',
        status: 'pending',
        next_retry_at: ''
      },
      'mouse-c': {
        productId: 'mouse-c',
        status: 'paused',
        next_retry_at: ''
      }
    }
  });

  assert.equal(next?.productId, 'mouse-b');
});

test('recordQueueFailure applies exponential retry and then hard-fails at max attempts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-queue-failure-'));
  const storage = makeStorage(tempRoot);

  try {
    await upsertQueueProduct({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      s3key: 'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2.json',
      patch: {
        status: 'pending',
        max_attempts: 2
      }
    });

    const first = await recordQueueFailure({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      s3key: 'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2.json',
      error: new Error('network timeout')
    });
    assert.equal(first.product.status, 'pending');
    assert.equal(first.product.retry_count, 1);
    assert.equal(Boolean(first.product.next_retry_at), true);
    assert.equal(String(first.product.last_error || '').includes('network timeout'), true);

    const second = await recordQueueFailure({
      storage,
      category: 'mouse',
      productId: 'mouse-logitech-g-pro-x-superlight-2',
      s3key: 'specs/inputs/mouse/products/mouse-logitech-g-pro-x-superlight-2.json',
      error: new Error('network timeout')
    });
    assert.equal(second.product.status, 'failed');
    assert.equal(second.product.retry_count, 2);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('markStaleQueueProducts marks old complete rows as stale', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-queue-stale-'));
  const storage = makeStorage(tempRoot);

  try {
    await upsertQueueProduct({
      storage,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-pro',
      s3key: 'specs/inputs/mouse/products/mouse-razer-viper-v3-pro.json',
      patch: {
        status: 'complete',
        last_completed_at: '2025-01-01T00:00:00.000Z'
      }
    });
    await upsertQueueProduct({
      storage,
      category: 'mouse',
      productId: 'mouse-razer-viper-v3-hyperspeed',
      s3key: 'specs/inputs/mouse/products/mouse-razer-viper-v3-hyperspeed.json',
      patch: {
        status: 'complete',
        last_completed_at: '2026-02-12T00:00:00.000Z'
      }
    });

    const stale = await markStaleQueueProducts({
      storage,
      category: 'mouse',
      staleAfterDays: 30,
      nowIso: '2026-02-13T00:00:00.000Z'
    });
    assert.equal(stale.stale_marked, 1);
    assert.equal(stale.products.includes('mouse-razer-viper-v3-pro'), true);

    const loaded = await loadQueueState({ storage, category: 'mouse' });
    assert.equal(loaded.state.products['mouse-razer-viper-v3-pro'].status, 'stale');
    assert.equal(loaded.state.products['mouse-razer-viper-v3-hyperspeed'].status, 'complete');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('loadQueueState recovers from corrupt queue state json and allows rewrite on upsert', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-queue-corrupt-'));
  const storage = makeStorage(tempRoot);
  const category = 'mouse';
  const modernKey = `_queue/${category}/state.json`;
  const legacyKey = storage.resolveOutputKey('_queue', category, 'state.json');

  try {
    await storage.writeObject(modernKey, Buffer.from('{"category":"mouse","products":{}}}', 'utf8'));
    await storage.writeObject(legacyKey, Buffer.from('{"category":"mouse","products":{}}}', 'utf8'));

    const loaded = await loadQueueState({ storage, category });
    assert.equal(loaded.recovered_from_corrupt_state, true);
    assert.deepEqual(loaded.state.products, {});

    await upsertQueueProduct({
      storage,
      category,
      productId: 'mouse-recovery-check',
      s3key: 'specs/inputs/mouse/products/mouse-recovery-check.json',
      patch: { status: 'pending' }
    });

    const after = await loadQueueState({ storage, category });
    assert.equal(Boolean(after.state.products['mouse-recovery-check']), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
