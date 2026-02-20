import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  buildReviewLayout,
  buildProductReviewPayload,
  buildReviewQueue,
  writeCategoryReviewArtifacts,
  writeProductReviewArtifacts
} from '../src/review/reviewGridData.js';

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

async function seedCategoryArtifacts(helperRoot, category) {
  const generated = path.join(helperRoot, category, '_generated');
  await writeJson(path.join(generated, 'field_rules.json'), {
    category,
    fields: {
      weight: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        effort: 2,
        contract: { type: 'number', shape: 'scalar', unit: 'g' },
        excel: {
          dataEntry: { sheet: 'dataEntry', row: 9, key_cell: 'B9' }
        },
        ui: { label: 'Weight', group: 'General', order: 9 }
      },
      dpi: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'medium',
        effort: 5,
        contract: { type: 'number', shape: 'scalar', unit: null },
        excel: {
          dataEntry: { sheet: 'dataEntry', row: 10, key_cell: 'B10' }
        },
        ui: { label: 'DPI', group: '', order: 10 }
      },
      connection: {
        required_level: 'expected',
        availability: 'sometimes',
        difficulty: 'easy',
        effort: 3,
        contract: { type: 'enum', shape: 'scalar', unit: null },
        excel: {
          dataEntry: { sheet: 'dataEntry', row: 11, key_cell: 'B11' }
        },
        ui: { label: 'Connection', group: 'Connectivity', order: 11 }
      }
    }
  });
  await writeJson(path.join(generated, 'ui_field_catalog.json'), {
    category,
    fields: [
      { key: 'weight', label: 'Weight', group: 'General', order: 9 },
      { key: 'dpi', label: 'DPI', group: '', order: 10 },
      { key: 'connection', label: 'Connection', group: 'Connectivity', order: 11 }
    ]
  });
}

async function seedLatestArtifacts(storage, category, productId, options = {}) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const identity = options.identity ?? { brand: 'Razer', model: 'Viper V3 Pro', variant: 'Wireless' };
  const fields = options.fields ?? { weight: 59, dpi: 'unk', connection: 'wireless' };
  const summary = {
    productId,
    runId: 'run_test_001',
    confidence: 0.88,
    coverage_overall: 0.66,
    validated: false,
    fields_below_pass_target: ['dpi'],
    critical_fields_below_pass_target: ['dpi'],
    missing_required_fields: ['dpi'],
    field_reasoning: {
      dpi: {
        unknown_reason: 'not_found_after_search',
        reasons: ['missing_required_field']
      }
    },
    generated_at: '2026-02-13T00:00:00.000Z',
    ...(options.summary || {})
  };
  const candidates = options.candidates ?? {
    weight: [
      {
        candidate_id: 'cand_weight_1',
        value: '59',
        score: 0.96,
        host: 'razer.example',
        source_id: 'razer_com',
        tier: 1,
        method: 'spec_table_match',
        evidence: {
          url: 'https://razer.example/specs',
          snippet_id: 'snp_001',
          snippet_hash: 'sha256:abc',
          quote: 'Weight: 59 g',
          quote_span: [0, 12],
          snippet_text: 'Weight: 59 g (without cable)'
        }
      }
    ],
    dpi: [
      {
        candidate_id: 'cand_dpi_1',
        value: '30000',
        score: 0.54,
        host: 'db.example',
        source_id: 'db_example',
        tier: 2,
        method: 'llm_extract',
        evidence: {
          url: 'https://db.example/review',
          snippet_id: 'snp_777',
          quote: 'DPI: 30000'
        }
      }
    ]
  };

  await storage.writeObject(
    `${latestBase}/normalized.json`,
    Buffer.from(JSON.stringify({
      identity,
      fields
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/provenance.json`,
    Buffer.from(JSON.stringify({
      weight: {
        value: 59,
        confidence: 0.96,
        evidence: [
          {
            url: 'https://razer.example/specs',
            source_id: 'razer_com',
            snippet_id: 'snp_001',
            snippet_hash: 'sha256:abc',
            quote: 'Weight: 59 g',
            quote_span: [0, 12],
            extraction_method: 'spec_table_match'
          }
        ]
      },
      dpi: {
        value: 'unk',
        confidence: 0,
        evidence: []
      },
      connection: {
        value: 'wireless',
        confidence: 0.9,
        evidence: [
          {
            url: 'https://razer.example/specs',
            source_id: 'razer_com',
            snippet_id: 'snp_010',
            quote: 'Connection: Wireless'
          }
        ]
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/summary.json`,
    Buffer.from(JSON.stringify(summary, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/candidates.json`,
    Buffer.from(JSON.stringify(candidates, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

async function seedQueueState(storage, category, productIds = []) {
  const state = {
    category,
    updated_at: '2026-02-13T00:00:00.000Z',
    products: {}
  };
  for (const productId of productIds) {
    state.products[productId] = {
      productId,
      s3key: `specs/inputs/${category}/products/${productId}.json`,
      status: 'complete',
      priority: 3,
      updated_at: '2026-02-13T00:00:00.000Z'
    };
  }
  const modernKey = `_queue/${category}/state.json`;
  const legacyKey = storage.resolveOutputKey('_queue', category, 'state.json');
  await storage.writeObject(
    modernKey,
    Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    legacyKey,
    Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

test('buildReviewLayout follows excel row order and inherits blank group labels', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-layout-'));
  const storage = makeStorage(tempRoot);
  const config = { helperFilesRoot: path.join(tempRoot, 'helper_files') };
  try {
    await seedCategoryArtifacts(config.helperFilesRoot, 'mouse');
    const layout = await buildReviewLayout({ storage, config, category: 'mouse' });
    assert.equal(layout.category, 'mouse');
    assert.equal(layout.excel.key_range, 'B9:B11');
    assert.equal(layout.rows.length, 3);
    assert.deepEqual(layout.rows.map((row) => row.key), ['weight', 'dpi', 'connection']);
    assert.equal(layout.rows[0].group, 'General');
    assert.equal(layout.rows[1].group, 'General');
    assert.equal(layout.rows[2].group, 'Connectivity');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('writeProductReviewArtifacts writes review candidates and per-field review queue', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-product-'));
  const storage = makeStorage(tempRoot);
  const config = { helperFilesRoot: path.join(tempRoot, 'helper_files') };
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';
  try {
    await seedCategoryArtifacts(config.helperFilesRoot, category);
    await seedLatestArtifacts(storage, category, productId);
    const result = await writeProductReviewArtifacts({
      storage,
      config,
      category,
      productId
    });

    assert.equal(result.candidate_count >= 2, true);
    assert.equal(result.review_field_count >= 1, true);

    const reviewBase = ['final', category, productId, 'review'].join('/');
    const candidates = await storage.readJson(`${reviewBase}/candidates.json`);
    const reviewQueue = await storage.readJson(`${reviewBase}/review_queue.json`);
    const product = await storage.readJson(`${reviewBase}/product.json`);

    assert.equal(Array.isArray(candidates.items), true);
    assert.equal(candidates.items.some((row) => row.field === 'weight'), true);
    assert.equal(candidates.items.some((row) => row.field === 'dpi'), true);
    assert.equal(Array.isArray(reviewQueue.items), true);
    assert.equal(reviewQueue.items.some((row) => row.field === 'dpi'), true);
    assert.equal(product.identity.brand, 'Razer');
    assert.equal(product.fields.weight.selected.value, 59);
    assert.equal(Array.isArray(product.fields.weight.candidates), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildProductReviewPayload can omit candidate payloads for lightweight grid rendering', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-product-lite-'));
  const storage = makeStorage(tempRoot);
  const config = { helperFilesRoot: path.join(tempRoot, 'helper_files') };
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless-lite';
  try {
    await seedCategoryArtifacts(config.helperFilesRoot, category);
    await seedLatestArtifacts(storage, category, productId);
    const payload = await buildProductReviewPayload({
      storage,
      config,
      category,
      productId,
      includeCandidates: false
    });

    assert.equal(payload.product_id, productId);
    assert.equal(payload.fields.weight.selected.value, 59);
    assert.equal(payload.fields.weight.candidate_count >= 1, true);
    assert.deepEqual(payload.fields.weight.candidates, []);
    assert.equal(payload.fields.dpi.needs_review, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildReviewQueue sorts products by urgency and writeCategoryReviewArtifacts persists queue', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-queue-'));
  const storage = makeStorage(tempRoot);
  const config = { helperFilesRoot: path.join(tempRoot, 'helper_files') };
  const category = 'mouse';
  try {
    await seedCategoryArtifacts(config.helperFilesRoot, category);
    const productA = 'mouse-a';
    const productB = 'mouse-b';
    await seedLatestArtifacts(storage, category, productA);
    await seedLatestArtifacts(storage, category, productB);
    await seedQueueState(storage, category, [productA, productB]);

    await storage.writeObject(
      `final/${category}/${productA}/review/review_queue.json`,
      Buffer.from(JSON.stringify({
        version: 1,
        category,
        product_id: productA,
        count: 4,
        items: [{ field: 'dpi', reason_codes: ['missing_required_field'] }]
      }, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );
    await storage.writeObject(
      `final/${category}/${productB}/review/review_queue.json`,
      Buffer.from(JSON.stringify({
        version: 1,
        category,
        product_id: productB,
        count: 1,
        items: [{ field: 'connection', reason_codes: ['low_confidence'] }]
      }, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );

    const queue = await buildReviewQueue({
      storage,
      config,
      category,
      status: 'needs_review',
      limit: 10
    });
    assert.equal(queue.length, 2);
    assert.equal(queue[0].product_id, productA);
    assert.equal(queue[0].flags >= queue[1].flags, true);

    const written = await writeCategoryReviewArtifacts({
      storage,
      config,
      category,
      status: 'needs_review',
      limit: 10
    });
    assert.equal(written.count, 2);
    const stored = await storage.readJson(`_review/${category}/queue.json`);
    assert.equal(stored.count, 2);
    assert.equal(Array.isArray(stored.items), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('review payload and queue infer readable identity from product_id when normalized identity is missing', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-identity-fallback-'));
  const storage = makeStorage(tempRoot);
  const config = { helperFilesRoot: path.join(tempRoot, 'helper_files') };
  const category = 'mouse';
  const productId = 'mouse-acer-cestus-310-310';
  try {
    await seedCategoryArtifacts(config.helperFilesRoot, category);
    await seedLatestArtifacts(storage, category, productId, {
      identity: {}
    });
    await seedQueueState(storage, category, [productId]);
    await storage.writeObject(
      `final/${category}/${productId}/review/review_queue.json`,
      Buffer.from(JSON.stringify({
        version: 1,
        category,
        product_id: productId,
        count: 2,
        items: [{ field: 'dpi', reason_codes: ['missing_required_field'] }]
      }, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );

    const payload = await buildProductReviewPayload({
      storage,
      config,
      category,
      productId,
      includeCandidates: false
    });
    assert.equal(payload.identity.brand, 'Acer');
    assert.equal(payload.identity.model, 'Cestus 310');

    const queue = await buildReviewQueue({
      storage,
      config,
      category,
      status: 'needs_review',
      limit: 10
    });
    assert.equal(queue.length, 1);
    assert.equal(queue[0].brand, 'Acer');
    assert.equal(queue[0].model, 'Cestus 310');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
