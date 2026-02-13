import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  buildAccuracyTrend,
  buildLlmMetrics,
  buildSourceHealth,
  publishProducts,
  readPublishedChangelog,
  readPublishedProvenance,
  runAccuracyBenchmarkReport
} from '../src/publish/publishingPipeline.js';

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

async function createCategoryFixture(helperRoot, category = 'mouse') {
  const generated = path.join(helperRoot, category, '_generated');
  await writeJson(path.join(generated, 'field_rules.json'), {
    category,
    fields: {
      weight: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 20, max: 120 }
        },
        ui: { label: 'Weight', group: 'General', order: 9 }
      },
      dpi: {
        required_level: 'expected',
        availability: 'expected',
        difficulty: 'easy',
        contract: {
          type: 'number',
          shape: 'scalar'
        },
        ui: { label: 'DPI', group: 'Sensor', order: 10 }
      }
    }
  });
  await writeJson(path.join(generated, 'known_values.json'), {
    category,
    enums: {}
  });
  await writeJson(path.join(generated, 'parse_templates.json'), {
    category,
    templates: {}
  });
  await writeJson(path.join(generated, 'cross_validation_rules.json'), {
    category,
    rules: []
  });
  await writeJson(path.join(generated, 'ui_field_catalog.json'), {
    category,
    fields: [
      { key: 'weight', group: 'general', label: 'Weight', order: 9 },
      { key: 'dpi', group: 'sensor', label: 'DPI', order: 10 }
    ]
  });
  await writeJson(path.join(generated, 'schema.json'), {
    category,
    field_order: ['weight', 'dpi'],
    critical_fields: [],
    expected_easy_fields: ['weight', 'dpi'],
    expected_sometimes_fields: [],
    deep_fields: [],
    editorial_fields: [],
    targets: {
      targetCompleteness: 0.9,
      targetConfidence: 0.8
    }
  });
  await writeJson(path.join(generated, 'required_fields.json'), ['fields.weight']);
}

async function seedLatest(storage, category, productId, { weight = '59', dpi = '26000' } = {}) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  await storage.writeObject(
    `${latestBase}/normalized.json`,
    Buffer.from(JSON.stringify({
      identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: 'Wireless' },
      fields: { weight, dpi }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/provenance.json`,
    Buffer.from(JSON.stringify({
      weight: {
        value: weight,
        confidence: 0.95,
        evidence: [
          {
            url: 'https://manufacturer.example/spec',
            source_id: 'manufacturer_example',
            snippet_id: 'snp_weight_1',
            snippet_hash: 'sha256:aaa',
            quote_span: [0, 12],
            quote: 'Weight: 59 g',
            retrieved_at: '2026-02-13T00:00:00.000Z'
          }
        ]
      },
      dpi: {
        value: dpi,
        confidence: 0.9,
        evidence: [
          {
            url: 'https://manufacturer.example/spec',
            source_id: 'manufacturer_example',
            snippet_id: 'snp_dpi_1',
            snippet_hash: 'sha256:bbb',
            quote: 'DPI: 26000',
            retrieved_at: '2026-02-13T00:00:00.000Z'
          }
        ]
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/summary.json`,
    Buffer.from(JSON.stringify({
      validated: true,
      confidence: 0.92,
      coverage_overall: 1,
      completeness_required: 1,
      generated_at: '2026-02-13T00:00:00.000Z',
      missing_required_fields: [],
      fields_below_pass_target: [],
      critical_fields_below_pass_target: [],
      field_reasoning: {
        weight: { reasons: ['manufacturer_source'] },
        dpi: { reasons: ['manufacturer_source'] }
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

async function seedApprovedOverride(helperRoot, category, productId, value) {
  const overridePath = path.join(helperRoot, category, '_overrides', `${productId}.overrides.json`);
  await writeJson(overridePath, {
    version: 1,
    category,
    product_id: productId,
    review_status: 'approved',
    reviewed_by: 'reviewer_1',
    reviewed_at: '2026-02-13T01:00:00.000Z',
    review_time_seconds: 38,
    overrides: {
      weight: {
        field: 'weight',
        override_source: 'candidate_selection',
        candidate_index: 0,
        override_value: String(value),
        override_reason: 'human verified',
        override_provenance: {
          url: 'https://manufacturer.example/spec',
          source_id: 'manufacturer_example',
          retrieved_at: '2026-02-13T00:00:00.000Z',
          snippet_id: 'snp_weight_1',
          snippet_hash: 'sha256:aaa',
          quote: `Weight: ${value} g`,
          quote_span: [0, 12]
        },
        overridden_by: 'reviewer_1',
        overridden_at: '2026-02-13T01:00:00.000Z'
      }
    }
  });
}

test('publishProducts merges approved overrides, writes artifacts, and versions diffs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase9-publish-'));
  const storage = makeStorage(tempRoot);
  const helperRoot = path.join(tempRoot, 'helper_files');
  const category = 'mouse';
  const productId = 'mouse-razer-viper-v3-pro-wireless';

  try {
    await createCategoryFixture(helperRoot, category);
    await seedLatest(storage, category, productId, { weight: '59', dpi: '26000' });
    await seedApprovedOverride(helperRoot, category, productId, '58');

    const first = await publishProducts({
      storage,
      config: { helperFilesRoot: helperRoot },
      category,
      productIds: [productId]
    });

    assert.equal(first.published_count, 1);
    assert.equal(first.blocked_count, 0);

    const current = await storage.readJson(`output/${category}/published/${productId}/current.json`);
    assert.equal(current.published_version, '1.0.0');
    assert.equal(current.specs.weight, 58);
    assert.equal(current.metrics.human_overrides, 1);

    const compact = await storage.readJson(`output/${category}/published/${productId}/compact.json`);
    assert.equal(compact.specs.weight, 58);

    const prov = await readPublishedProvenance({
      storage,
      category,
      productId,
      field: 'weight'
    });
    assert.equal(prov.field, 'weight');
    assert.equal(prov.provenance.evidence[0].snippet_id, 'snp_weight_1');

    await seedApprovedOverride(helperRoot, category, productId, '57');
    const second = await publishProducts({
      storage,
      config: { helperFilesRoot: helperRoot },
      category,
      productIds: [productId]
    });

    assert.equal(second.published_count, 1);
    const secondCurrent = await storage.readJson(`output/${category}/published/${productId}/current.json`);
    assert.equal(secondCurrent.published_version, '1.0.1');
    assert.equal(secondCurrent.specs.weight, 57);

    const archivedV1 = await storage.readJson(`output/${category}/published/${productId}/versions/v1.0.0.json`);
    assert.equal(archivedV1.specs.weight, 58);

    const changelog = await readPublishedChangelog({ storage, category, productId });
    assert.equal(Array.isArray(changelog.entries), true);
    assert.equal(changelog.entries.length >= 2, true);
    assert.equal(changelog.entries[0].changes.some((row) => row.field === 'weight'), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('publishProducts blocks invalid override values via runtime validation', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase9-publish-block-'));
  const storage = makeStorage(tempRoot);
  const helperRoot = path.join(tempRoot, 'helper_files');
  const category = 'mouse';
  const productId = 'mouse-invalid-override';

  try {
    await createCategoryFixture(helperRoot, category);
    await seedLatest(storage, category, productId, { weight: '59', dpi: '26000' });
    await seedApprovedOverride(helperRoot, category, productId, 'not-a-number');

    const result = await publishProducts({
      storage,
      config: { helperFilesRoot: helperRoot },
      category,
      productIds: [productId]
    });

    assert.equal(result.published_count, 0);
    assert.equal(result.blocked_count, 1);
    assert.equal(await storage.objectExists(`output/${category}/published/${productId}/current.json`), false);
    assert.equal(String(result.results[0].reason || '').includes('validation'), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('monitoring helpers produce trend, source health, and llm metrics', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase9-monitoring-'));
  const storage = makeStorage(tempRoot);
  const helperRoot = path.join(tempRoot, 'helper_files');
  const category = 'mouse';
  const productId = 'mouse-monitoring-case';

  try {
    await createCategoryFixture(helperRoot, category);
    await seedLatest(storage, category, productId);
    await seedApprovedOverride(helperRoot, category, productId, '58');

    const benchmark = await runAccuracyBenchmarkReport({
      storage,
      config: {
        helperFilesRoot: helperRoot,
        goldenRoot: path.join(tempRoot, 'golden')
      },
      category,
      period: 'weekly',
      maxCases: 0
    });
    assert.equal(benchmark.report_type, 'accuracy');

    await writeJson(
      path.join(tempRoot, 'out', 'output', category, 'reports', 'accuracy_2026-02-10.json'),
      {
        report_type: 'accuracy',
        category,
        generated_at: '2026-02-10T00:00:00.000Z',
        period: 'weekly',
        by_field: {
          weight: { accuracy: 0.97 }
        }
      }
    );
    await writeJson(
      path.join(tempRoot, 'out', 'output', category, 'reports', 'accuracy_2026-02-12.json'),
      {
        report_type: 'accuracy',
        category,
        generated_at: '2026-02-12T00:00:00.000Z',
        period: 'weekly',
        by_field: {
          weight: { accuracy: 0.91 }
        }
      }
    );

    const trend = await buildAccuracyTrend({
      storage,
      category,
      field: 'weight',
      periodDays: 90
    });
    assert.equal(trend.points.length >= 2, true);
    assert.equal(Number.isFinite(trend.delta), true);

    await writeText(
      path.join(tempRoot, 'out', 'specs', 'outputs', 'final', category, 'razer', 'viper-v3-pro', 'evidence', 'sources.jsonl'),
      [
        JSON.stringify({ ts: '2026-02-12T00:00:00.000Z', host: 'manufacturer.example', status: 200 }),
        JSON.stringify({ ts: '2026-02-12T01:00:00.000Z', host: 'manufacturer.example', status: 403 }),
        JSON.stringify({ ts: '2026-02-12T02:00:00.000Z', host: 'review.example', status: 200 })
      ].join('\n') + '\n'
    );

    const sourceHealth = await buildSourceHealth({
      storage,
      category,
      periodDays: 30
    });
    assert.equal(sourceHealth.total_sources >= 2, true);
    assert.equal(sourceHealth.sources.some((row) => row.host === 'manufacturer.example'), true);

    await writeText(
      path.join(tempRoot, 'out', '_billing', 'ledger.jsonl'),
      [
        JSON.stringify({ ts: '2026-02-12T00:00:00.000Z', provider: 'deepseek', model: 'deepseek-chat', productId: productId, cost_usd: 0.05, prompt_tokens: 1000, completion_tokens: 200, reason: 'extract' }),
        JSON.stringify({ ts: '2026-02-12T01:00:00.000Z', provider: 'deepseek', model: 'deepseek-reasoner', productId: productId, cost_usd: 0.08, prompt_tokens: 1200, completion_tokens: 300, reason: 'verify' })
      ].join('\n') + '\n'
    );

    const llmMetrics = await buildLlmMetrics({
      storage,
      config: { llmMonthlyBudgetUsd: 1 },
      period: 'month'
    });
    assert.equal(llmMetrics.total_calls, 2);
    assert.equal(llmMetrics.total_cost_usd > 0, true);
    assert.equal(llmMetrics.by_model.some((row) => row.model === 'deepseek-chat'), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
