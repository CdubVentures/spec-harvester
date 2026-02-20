import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import {
  buildAccuracyTrend,
  buildLlmMetrics,
  buildSourceHealth,
  checkPublishBlockers,
  evaluatePublishGate,
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
        JSON.stringify({ ts: '2026-02-12T00:00:00.000Z', provider: 'deepseek', model: 'deepseek-chat', productId: productId, runId: 'run-001', cost_usd: 0.05, prompt_tokens: 1000, completion_tokens: 200, reason: 'extract' }),
        JSON.stringify({ ts: '2026-02-12T00:00:30.000Z', provider: 'deepseek', model: 'deepseek-reasoner', productId: productId, runId: 'run-001', cost_usd: 0.02, prompt_tokens: 500, completion_tokens: 120, reason: 'verify' }),
        JSON.stringify({ ts: '2026-02-12T01:00:00.000Z', provider: 'deepseek', model: 'deepseek-reasoner', productId: productId, cost_usd: 0.08, prompt_tokens: 1200, completion_tokens: 300, reason: 'verify' })
      ].join('\n') + '\n'
    );

    const llmMetrics = await buildLlmMetrics({
      storage,
      config: { llmMonthlyBudgetUsd: 1 },
      period: 'month'
    });
    assert.equal(llmMetrics.total_calls, 3);
    assert.equal(llmMetrics.total_cost_usd > 0, true);
    assert.equal(llmMetrics.by_model.some((row) => row.model === 'deepseek-chat'), true);
    assert.equal(Array.isArray(llmMetrics.by_run), true);
    const runRow = llmMetrics.by_run.find((row) => row.run_id === 'run-001');
    assert.ok(runRow);
    assert.equal(runRow.calls, 2);
    assert.equal(runRow.cost_usd, 0.07);
    assert.equal(runRow.is_session_fallback, false);
    assert.equal(llmMetrics.by_run.some((row) => row.is_session_fallback), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// checkPublishBlockers — block_publish_when_unk gate tests (Window 3 TDD)
// ===========================================================================

async function createBlockerFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-blocker-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'number', shape: 'scalar', unit: 'g', range: { min: 20, max: 120 } },
        priority: {
          block_publish_when_unk: true,
          publish_gate: true,
          publish_gate_reason: 'missing_required'
        }
      },
      dpi: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'number', shape: 'scalar' },
        priority: {
          block_publish_when_unk: true,
          publish_gate: true,
          publish_gate_reason: 'missing_required'
        }
      },
      sensor: {
        required_level: 'expected',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'string', shape: 'scalar' },
        priority: {
          block_publish_when_unk: false,
          publish_gate: false
        }
      },
      coating: {
        required_level: 'optional',
        availability: 'sometimes',
        difficulty: 'easy',
        contract: { type: 'string', shape: 'scalar' }
        // No priority sub-object — block_publish_when_unk is undefined
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {}
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {}
  });

  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: []
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'general', label: 'Weight', order: 1 },
      { key: 'dpi', group: 'sensor', label: 'DPI', order: 2 },
      { key: 'sensor', group: 'sensor', label: 'Sensor', order: 3 },
      { key: 'coating', group: 'physical', label: 'Coating', order: 4 }
    ]
  });

  return { root, helperRoot };
}

// ---------------------------------------------------------------------------
// Test 1: block_publish_when_unk=true + unk field → blocked
// ---------------------------------------------------------------------------
test('checkPublishBlockers: block_publish_when_unk=true + unk field → blocked', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: 'unk', dpi: '26000', sensor: 'Focus Pro', coating: 'PTFE' }
    });
    assert.equal(result.blocked, true);
    assert.equal(result.publish_blocked_fields.length, 1);
    assert.equal(result.publish_blocked_fields[0].field, 'weight');
    assert.equal(result.publish_blocked_fields[0].reason, 'missing_required');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: block_publish_when_unk=true + all fields present → passes
// ---------------------------------------------------------------------------
test('checkPublishBlockers: block_publish_when_unk=true + all fields present → passes', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: '59', dpi: '26000', sensor: 'Focus Pro', coating: 'PTFE' }
    });
    assert.equal(result.blocked, false);
    assert.equal(result.publish_blocked_fields.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: block_publish_when_unk=false + unk field → passes
// ---------------------------------------------------------------------------
test('checkPublishBlockers: block_publish_when_unk=false + unk field → passes', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: '59', dpi: '26000', sensor: 'unk', coating: 'PTFE' }
    });
    assert.equal(result.blocked, false);
    assert.equal(result.publish_blocked_fields.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: no priority object → treated as block=false
// ---------------------------------------------------------------------------
test('checkPublishBlockers: no priority object → treated as block=false', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: '59', dpi: '26000', sensor: 'Focus Pro', coating: 'unk' }
    });
    // coating has no priority sub-object → block_publish_when_unk is undefined → treated as false
    assert.equal(result.blocked, false);
    assert.equal(result.publish_blocked_fields.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: multiple blocked fields → all listed
// ---------------------------------------------------------------------------
test('checkPublishBlockers: multiple blocked fields → all listed', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: 'unk', dpi: 'unk', sensor: 'unk', coating: 'unk' }
    });
    assert.equal(result.blocked, true);
    assert.equal(result.publish_blocked_fields.length, 2);
    const blockedFields = result.publish_blocked_fields.map((row) => row.field).sort();
    assert.deepEqual(blockedFields, ['dpi', 'weight']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: publish_gate_reason is included in each blocker
// ---------------------------------------------------------------------------
test('checkPublishBlockers: publish_gate_reason is included in each blocker', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = checkPublishBlockers({
      engine,
      fields: { weight: 'unk', dpi: 'unk', sensor: 'Focus Pro', coating: 'PTFE' }
    });
    assert.equal(result.blocked, true);
    assert.equal(result.publish_blocked_fields.length, 2);
    for (const blocker of result.publish_blocked_fields) {
      assert.ok(blocker.reason, `blocker for ${blocker.field} should have reason`);
      assert.equal(blocker.reason, 'missing_required');
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: unknown-token variants ('', 'unknown', 'n/a', 'null', '-') all treated as unk
// ---------------------------------------------------------------------------
test('checkPublishBlockers: unknown-token variants all treated as unk', async () => {
  const fixture = await createBlockerFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // weight='' and dpi='unknown' → both should be treated as unknown
    const result = checkPublishBlockers({
      engine,
      fields: { weight: '', dpi: 'unknown', sensor: 'Focus Pro', coating: 'PTFE' }
    });
    assert.equal(result.blocked, true);
    assert.equal(result.publish_blocked_fields.length, 2);
    const blockedFields = result.publish_blocked_fields.map((row) => row.field).sort();
    assert.deepEqual(blockedFields, ['dpi', 'weight']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ===========================================================================
// evaluatePublishGate — category-level publish gate tests (Window 3b TDD)
// ===========================================================================

async function createPublishGateFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-gate-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      brand_name: {
        required_level: 'identity',
        availability: 'always',
        difficulty: 'easy',
        contract: { type: 'string', shape: 'scalar' },
        evidence_required: true,
        evidence: { required: true, min_evidence_refs: 1 },
        ui: { label: 'Brand Name', group: 'Identity', order: 1 }
      },
      weight: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'number', shape: 'scalar', unit: 'g', range: { min: 20, max: 120 } },
        evidence_required: true,
        evidence: { required: true, min_evidence_refs: 1 },
        ui: { label: 'Weight', group: 'General', order: 2 }
      },
      dpi: {
        required_level: 'expected',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'number', shape: 'scalar' },
        evidence_required: true,
        evidence: { required: true, min_evidence_refs: 1 },
        ui: { label: 'DPI', group: 'Sensor', order: 3 }
      },
      sensor: {
        required_level: 'expected',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'string', shape: 'scalar' },
        evidence_required: false,
        evidence: { required: false },
        ui: { label: 'Sensor', group: 'Sensor', order: 4 }
      },
      coating: {
        required_level: 'optional',
        availability: 'sometimes',
        difficulty: 'easy',
        contract: { type: 'string', shape: 'scalar' },
        ui: { label: 'Coating', group: 'Physical', order: 5 }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {}
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {}
  });

  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: []
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'brand_name', group: 'identity', label: 'Brand Name', order: 1 },
      { key: 'weight', group: 'general', label: 'Weight', order: 2 },
      { key: 'dpi', group: 'sensor', label: 'DPI', order: 3 },
      { key: 'sensor', group: 'sensor', label: 'Sensor', order: 4 },
      { key: 'coating', group: 'physical', label: 'Coating', order: 5 }
    ]
  });

  return { root, helperRoot };
}

const FULL_FIELDS = { brand_name: 'Razer', weight: 59, dpi: 26000, sensor: 'Focus Pro', coating: 'PTFE' };
const GOOD_PROVENANCE = {
  brand_name: { evidence: [{ url: 'https://razer.com', snippet_id: 's1', quote: 'Razer' }] },
  weight: { evidence: [{ url: 'https://razer.com', snippet_id: 's2', quote: '59g' }] },
  dpi: { evidence: [{ url: 'https://razer.com', snippet_id: 's3', quote: '26000 DPI' }] }
};
const CLEAN_RUNTIME_GATE = { failures: [], warnings: [] };

// ---------------------------------------------------------------------------
// Test 1: gate='none' → always passes, even with missing fields
// ---------------------------------------------------------------------------
test('evaluatePublishGate: gate=none → passes even with missing fields', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'unk', weight: 'unk', dpi: 'unk' },
      provenance: {},
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'none'
    });
    assert.equal(result.pass, true);
    assert.equal(result.gate, 'none');
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 2: gate='identity_complete' + missing identity field → blocked
// ---------------------------------------------------------------------------
test('evaluatePublishGate: identity_complete + missing identity → blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'unk', weight: 59, dpi: 26000 },
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'identity_complete'
    });
    assert.equal(result.pass, false);
    assert.equal(result.blockers.length >= 1, true);
    assert.equal(result.blockers[0].field, 'brand_name');
    assert.equal(result.blockers[0].gate_check, 'identity_complete');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3: gate='identity_complete' + identity present → passes
// ---------------------------------------------------------------------------
test('evaluatePublishGate: identity_complete + identity present → passes', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 'unk', dpi: 'unk' },
      provenance: {},
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'identity_complete'
    });
    assert.equal(result.pass, true);
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4: gate='required_complete' + missing required field → blocked
// ---------------------------------------------------------------------------
test('evaluatePublishGate: required_complete + missing required → blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 'unk', dpi: 26000 },
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'required_complete'
    });
    assert.equal(result.pass, false);
    const weightBlocker = result.blockers.find((b) => b.field === 'weight');
    assert.ok(weightBlocker);
    assert.equal(weightBlocker.gate_check, 'required_complete');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5: gate='required_complete' + all required present → passes
//         (dpi is 'expected', not required — unk is ok)
// ---------------------------------------------------------------------------
test('evaluatePublishGate: required_complete + all required present → passes', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 59, dpi: 'unk', sensor: 'unk' },
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'required_complete'
    });
    assert.equal(result.pass, true);
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6: gate='evidence_complete' + value present but no provenance → blocked
// ---------------------------------------------------------------------------
test('evaluatePublishGate: evidence_complete + value without evidence → blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 59, dpi: 26000, sensor: 'Focus Pro' },
      provenance: {
        brand_name: { evidence: [{ url: 'https://razer.com', snippet_id: 's1', quote: 'Razer' }] }
        // weight and dpi have values + evidence_required but NO provenance
      },
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'evidence_complete'
    });
    assert.equal(result.pass, false);
    const evidenceBlockers = result.blockers.filter((b) => b.gate_check === 'evidence_complete');
    assert.equal(evidenceBlockers.length >= 1, true);
    // weight and dpi should be blocked (have values, evidence_required, no provenance)
    const blockedFields = evidenceBlockers.map((b) => b.field).sort();
    assert.ok(blockedFields.includes('weight'));
    assert.ok(blockedFields.includes('dpi'));
    // sensor has no evidence_required — should NOT be blocked
    assert.equal(blockedFields.includes('sensor'), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 7: gate='evidence_complete' + all evidence present → passes
// ---------------------------------------------------------------------------
test('evaluatePublishGate: evidence_complete + all evidence present → passes', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: FULL_FIELDS,
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'evidence_complete'
    });
    assert.equal(result.pass, true);
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 8: gate='evidence_complete' + evidence-required field is unk → NOT evidence-blocked
//         (field has no value to evidence — only required/identity gates would catch it)
// ---------------------------------------------------------------------------
test('evaluatePublishGate: evidence_complete + unk evidence-required field → not evidence-blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 59, dpi: 'unk', sensor: 'Focus Pro' },
      provenance: {
        brand_name: { evidence: [{ url: 'https://razer.com', snippet_id: 's1', quote: 'Razer' }] },
        weight: { evidence: [{ url: 'https://razer.com', snippet_id: 's2', quote: '59g' }] }
      },
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'evidence_complete'
    });
    // dpi is unk and evidence_required, but since it has no value, evidence check doesn't apply
    assert.equal(result.pass, true);
    const evidenceBlockers = result.blockers.filter((b) => b.gate_check === 'evidence_complete');
    assert.equal(evidenceBlockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 9: gate='all_validations_pass' + runtimeGate failures → blocked
// ---------------------------------------------------------------------------
test('evaluatePublishGate: all_validations_pass + runtimeGate failures → blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: FULL_FIELDS,
      provenance: GOOD_PROVENANCE,
      runtimeGate: {
        failures: [{ field: 'weight', stage: 'normalize', reason_code: 'out_of_range' }],
        warnings: []
      },
      gate: 'all_validations_pass'
    });
    assert.equal(result.pass, false);
    const failureBlockers = result.blockers.filter((b) => b.gate_check === 'all_validations_pass');
    assert.equal(failureBlockers.length >= 1, true);
    assert.equal(failureBlockers[0].field, 'weight');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 10: gate='all_validations_pass' + clean → passes
// ---------------------------------------------------------------------------
test('evaluatePublishGate: all_validations_pass + clean runtimeGate → passes', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: FULL_FIELDS,
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'all_validations_pass'
    });
    assert.equal(result.pass, true);
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 11: gate='strict' + runtimeGate warnings → blocked
// ---------------------------------------------------------------------------
test('evaluatePublishGate: strict + runtimeGate warnings → blocked', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: FULL_FIELDS,
      provenance: GOOD_PROVENANCE,
      runtimeGate: {
        failures: [],
        warnings: [{ field: 'dpi', stage: 'cross_validate', reason_code: 'cross_validation_warning' }]
      },
      gate: 'strict'
    });
    assert.equal(result.pass, false);
    const strictBlockers = result.blockers.filter((b) => b.gate_check === 'strict');
    assert.equal(strictBlockers.length >= 1, true);
    assert.equal(strictBlockers[0].field, 'dpi');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 12: gate='strict' + all clean → passes
// ---------------------------------------------------------------------------
test('evaluatePublishGate: strict + all clean → passes', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: FULL_FIELDS,
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'strict'
    });
    assert.equal(result.pass, true);
    assert.equal(result.blockers.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 13: gate=undefined → defaults to required_complete behavior
// ---------------------------------------------------------------------------
test('evaluatePublishGate: undefined gate defaults to required_complete', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // brand_name=unk → identity field missing → should block under required_complete
    const blocked = evaluatePublishGate({
      engine,
      fields: { brand_name: 'unk', weight: 59, dpi: 26000 },
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE
    });
    assert.equal(blocked.pass, false);
    assert.equal(blocked.gate, 'required_complete');

    // all required/identity present → should pass
    const passes = evaluatePublishGate({
      engine,
      fields: { brand_name: 'Razer', weight: 59, dpi: 'unk' },
      provenance: GOOD_PROVENANCE,
      runtimeGate: CLEAN_RUNTIME_GATE
    });
    assert.equal(passes.pass, true);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 14: blockers have correct shape (field, gate_check, reason)
// ---------------------------------------------------------------------------
test('evaluatePublishGate: blockers have machine-readable shape', async () => {
  const fixture = await createPublishGateFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = evaluatePublishGate({
      engine,
      fields: { brand_name: 'unk', weight: 'unk', dpi: 26000 },
      provenance: {},
      runtimeGate: CLEAN_RUNTIME_GATE,
      gate: 'evidence_complete'
    });
    assert.equal(result.pass, false);
    for (const blocker of result.blockers) {
      assert.equal(typeof blocker.field, 'string');
      assert.equal(typeof blocker.gate_check, 'string');
      assert.equal(typeof blocker.reason, 'string');
      assert.ok(blocker.field.length > 0);
      assert.ok(blocker.gate_check.length > 0);
      assert.ok(blocker.reason.length > 0);
    }
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
