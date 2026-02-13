import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { loadQueueState } from '../src/queue/queueState.js';
import {
  reconcileDriftedProduct,
  scanAndEnqueueDriftedProducts
} from '../src/publish/driftScheduler.js';

function makeStorage(tempRoot) {
  return createStorage({
    localMode: true,
    localInputRoot: path.join(tempRoot, 'fixtures'),
    localOutputRoot: path.join(tempRoot, 'out'),
    s3InputPrefix: 'specs/inputs',
    s3OutputPrefix: 'specs/outputs'
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(value || ''), 'utf8');
}

async function seedPublishedCurrent(tempRoot, category, productId, specs = {}) {
  await writeJson(
    path.join(tempRoot, 'out', 'output', category, 'published', productId, 'current.json'),
    {
      product_id: productId,
      category,
      identity: {
        brand: 'Razer',
        model: 'Viper V3 Pro',
        variant: 'Wireless'
      },
      specs
    }
  );
}

async function seedFinalSourceHistory(tempRoot, category, rows = []) {
  await writeText(
    path.join(tempRoot, 'out', 'final', category, 'razer', 'viper-v3-pro', 'wireless', 'evidence', 'sources.jsonl'),
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  );
}

async function seedLatestArtifacts(tempRoot, category, productId, fields, provenance = {}, summary = {}) {
  const latestBase = path.join(tempRoot, 'out', 'specs', 'outputs', category, productId, 'latest');
  await writeJson(path.join(latestBase, 'normalized.json'), {
    identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: 'Wireless' },
    fields
  });
  await writeJson(path.join(latestBase, 'provenance.json'), provenance);
  await writeJson(path.join(latestBase, 'summary.json'), {
    generated_at: '2026-02-13T00:00:00.000Z',
    ...summary
  });
}

test('scanAndEnqueueDriftedProducts seeds baseline then enqueues product when hashes drift', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-drift-scan-'));
  const storage = makeStorage(tempRoot);
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';

  try {
    await seedPublishedCurrent(tempRoot, category, productId, { weight: 59 });
    await seedFinalSourceHistory(tempRoot, category, [
      {
        ts: '2026-02-13T00:00:00.000Z',
        host: 'manufacturer.example',
        source_id: 'manufacturer_example',
        tier: 1,
        page_content_hash: 'sha256:aaa',
        text_hash: 'sha256:aaa'
      }
    ]);

    const first = await scanAndEnqueueDriftedProducts({
      storage,
      category,
      queueOnChange: true,
      maxProducts: 50
    });
    assert.equal(first.drift_detected_count, 0);
    assert.equal(first.queued_count, 0);

    await seedFinalSourceHistory(tempRoot, category, [
      {
        ts: '2026-02-13T00:00:00.000Z',
        host: 'manufacturer.example',
        source_id: 'manufacturer_example',
        tier: 1,
        page_content_hash: 'sha256:aaa',
        text_hash: 'sha256:aaa'
      },
      {
        ts: '2026-02-13T02:00:00.000Z',
        host: 'manufacturer.example',
        source_id: 'manufacturer_example',
        tier: 1,
        page_content_hash: 'sha256:bbb',
        text_hash: 'sha256:bbb'
      }
    ]);

    const second = await scanAndEnqueueDriftedProducts({
      storage,
      category,
      queueOnChange: true,
      maxProducts: 50
    });
    assert.equal(second.drift_detected_count, 1);
    assert.equal(second.queued_count, 1);
    assert.equal(second.products[0].product_id, productId);
    assert.equal(second.products[0].changes.some((row) => row.key === 'manufacturer_example'), true);

    const queue = await loadQueueState({ storage, category });
    const row = queue.state.products[productId];
    assert.equal(row.status, 'pending');
    assert.equal(row.next_action_hint, 'drift_reextract');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('reconcileDriftedProduct queues for manual review when extracted fields changed', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-drift-reconcile-review-'));
  const storage = makeStorage(tempRoot);
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';
  let publishCalls = 0;

  try {
    await seedPublishedCurrent(tempRoot, category, productId, { weight: 59, dpi: 26000 });
    await seedLatestArtifacts(
      tempRoot,
      category,
      productId,
      { weight: '57', dpi: '26000' },
      {
        weight: {
          confidence: 0.95,
          evidence: [{ url: 'https://manufacturer.example/spec', quote: 'Weight: 57 g', snippet_hash: 'sha256:w57' }]
        },
        dpi: {
          confidence: 0.9,
          evidence: [{ url: 'https://manufacturer.example/spec', quote: 'DPI: 26000', snippet_hash: 'sha256:dpi' }]
        }
      }
    );

    const result = await reconcileDriftedProduct({
      storage,
      config: {},
      category,
      productId,
      autoRepublish: true,
      publishFn: async () => {
        publishCalls += 1;
        return { published_count: 1 };
      }
    });
    assert.equal(result.action, 'queued_for_review');
    assert.equal(result.changed_fields.some((row) => row.field === 'weight'), true);
    assert.equal(publishCalls, 0);

    const queue = await loadQueueState({ storage, category });
    const row = queue.state.products[productId];
    assert.equal(row.status, 'needs_manual');
    assert.equal(row.next_action_hint, 'drift_review_required');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('reconcileDriftedProduct auto-republishes when no value diff remains', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-drift-reconcile-publish-'));
  const storage = makeStorage(tempRoot);
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';
  let publishCalls = 0;

  try {
    await seedPublishedCurrent(tempRoot, category, productId, { weight: 59 });
    await seedLatestArtifacts(
      tempRoot,
      category,
      productId,
      { weight: '59' },
      {
        weight: {
          confidence: 0.95,
          evidence: [{ url: 'https://manufacturer.example/spec', quote: 'Weight: 59 g', snippet_hash: 'sha256:w59' }]
        }
      }
    );

    const result = await reconcileDriftedProduct({
      storage,
      config: {},
      category,
      productId,
      autoRepublish: true,
      publishFn: async () => {
        publishCalls += 1;
        return { published_count: 1, processed_count: 1, blocked_count: 0 };
      }
    });

    assert.equal(result.action, 'auto_republished');
    assert.equal(publishCalls, 1);
    const queue = await loadQueueState({ storage, category });
    const row = queue.state.products[productId];
    assert.equal(row.status, 'complete');
    assert.equal(row.next_action_hint, 'none');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('reconcileDriftedProduct quarantines when latest evidence is invalid', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-drift-reconcile-quarantine-'));
  const storage = makeStorage(tempRoot);
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';

  try {
    await seedPublishedCurrent(tempRoot, category, productId, { weight: 59 });
    await seedLatestArtifacts(
      tempRoot,
      category,
      productId,
      { weight: '59' },
      {
        weight: {
          confidence: 0.95,
          evidence: [{ url: 'https://manufacturer.example/spec', quote: 'Weight: 59 g', snippet_hash: '' }]
        }
      }
    );

    const result = await reconcileDriftedProduct({
      storage,
      config: {},
      category,
      productId,
      autoRepublish: true,
      publishFn: async () => ({ published_count: 1 })
    });

    assert.equal(result.action, 'quarantined');
    assert.equal(result.evidence_failures.length > 0, true);
    const queue = await loadQueueState({ storage, category });
    const row = queue.state.products[productId];
    assert.equal(row.status, 'blocked');
    assert.equal(row.next_action_hint, 'drift_quarantine');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
