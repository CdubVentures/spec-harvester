import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const cliPath = path.resolve('src/cli/spec.js');

async function runCli(args, { env = {} } = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [cliPath, ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      }
    }
  );
  return JSON.parse(stdout);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, String(value || ''), 'utf8');
}

function localArgs({ inputRoot, outputRoot, importsRoot }) {
  return [
    '--local',
    '--output-mode', 'local',
    '--local-input-root', inputRoot,
    '--local-output-root', outputRoot,
    '--imports-root', importsRoot
  ];
}

async function seedHelperArtifacts(helperRoot) {
  const generated = path.join(helperRoot, 'mouse', '_generated');
  await writeJson(path.join(generated, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        availability: 'expected',
        difficulty: 'easy',
        contract: { type: 'number', shape: 'scalar', unit: 'g', range: { min: 20, max: 120 } },
        ui: { label: 'Weight', group: 'General', order: 9 }
      }
    }
  });
  await writeJson(path.join(generated, 'known_values.json'), { category: 'mouse', enums: {} });
  await writeJson(path.join(generated, 'parse_templates.json'), { category: 'mouse', templates: {} });
  await writeJson(path.join(generated, 'cross_validation_rules.json'), { category: 'mouse', rules: [] });
  await writeJson(path.join(generated, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [{ key: 'weight', label: 'Weight', group: 'General', order: 9 }]
  });
  await writeJson(path.join(generated, 'schema.json'), {
    category: 'mouse',
    field_order: ['weight'],
    critical_fields: [],
    expected_easy_fields: ['weight'],
    expected_sometimes_fields: [],
    deep_fields: [],
    editorial_fields: [],
    targets: { targetCompleteness: 0.9, targetConfidence: 0.8 }
  });
  await writeJson(path.join(generated, 'required_fields.json'), ['fields.weight']);
}

async function seedLatest(outputRoot, productId) {
  const base = path.join(outputRoot, 'specs', 'outputs', 'mouse', productId, 'latest');
  await writeJson(path.join(base, 'normalized.json'), {
    identity: { brand: 'Razer', model: 'Viper V3 Pro', variant: 'Wireless' },
    fields: { weight: '59' }
  });
  await writeJson(path.join(base, 'provenance.json'), {
    weight: {
      value: '59',
      confidence: 0.95,
      evidence: [
        {
          url: 'https://manufacturer.example/spec',
          source_id: 'manufacturer_example',
          snippet_id: 'snp_weight_1',
          snippet_hash: 'sha256:aaa',
          quote: 'Weight: 59 g',
          quote_span: [0, 12],
          retrieved_at: '2026-02-13T00:00:00.000Z'
        }
      ]
    }
  });
  await writeJson(path.join(base, 'summary.json'), {
    validated: true,
    confidence: 0.9,
    coverage_overall: 1,
    completeness_required: 1,
    generated_at: '2026-02-13T00:00:00.000Z',
    missing_required_fields: [],
    fields_below_pass_target: [],
    critical_fields_below_pass_target: []
  });
}

async function seedOverride(helperRoot, productId) {
  await writeJson(path.join(helperRoot, 'mouse', '_overrides', `${productId}.overrides.json`), {
    version: 1,
    category: 'mouse',
    product_id: productId,
    review_status: 'approved',
    reviewed_by: 'reviewer_cli',
    reviewed_at: '2026-02-13T01:00:00.000Z',
    review_time_seconds: 30,
    overrides: {
      weight: {
        field: 'weight',
        override_source: 'candidate_selection',
        override_value: '58',
        override_reason: 'human approved',
        override_provenance: {
          url: 'https://manufacturer.example/spec',
          source_id: 'manufacturer_example',
          retrieved_at: '2026-02-13T00:00:00.000Z',
          snippet_id: 'snp_weight_1',
          snippet_hash: 'sha256:aaa',
          quote: 'Weight: 58 g',
          quote_span: [0, 12]
        }
      }
    }
  });
}

test('publish/provenance/changelog/source-health/llm-metrics CLI commands work', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-phase9-cli-'));
  const inputRoot = path.join(tempRoot, 'fixtures');
  const outputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');
  const helperRoot = path.join(tempRoot, 'helper_files');
  const productId = 'mouse-cli-phase9';

  try {
    await seedHelperArtifacts(helperRoot);
    await seedLatest(outputRoot, productId);
    await seedOverride(helperRoot, productId);
    await writeText(
      path.join(outputRoot, 'specs', 'outputs', 'final', 'mouse', 'razer', 'viper-v3-pro', 'evidence', 'sources.jsonl'),
      `${JSON.stringify({ ts: '2026-02-13T00:00:00.000Z', host: 'manufacturer.example', source_id: 'manufacturer_example', tier: 1, status: 200, page_content_hash: 'sha256:aaa', text_hash: 'sha256:aaa' })}\n`
    );
    await writeText(
      path.join(outputRoot, '_billing', 'ledger.jsonl'),
      `${JSON.stringify({ ts: '2026-02-13T00:00:00.000Z', provider: 'deepseek', model: 'deepseek-chat', cost_usd: 0.05, prompt_tokens: 1000, completion_tokens: 200, productId })}\n`
    );

    const env = {
      HELPER_FILES_ROOT: helperRoot
    };

    const published = await runCli([
      'publish',
      '--category', 'mouse',
      '--product-id', productId,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(published.command, 'publish');
    assert.equal(published.published_count, 1);

    const allApproved = await runCli([
      'publish',
      '--category', 'mouse',
      '--all-approved',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(allApproved.command, 'publish');
    assert.equal(allApproved.processed_count >= 1, true);

    const provenance = await runCli([
      'provenance',
      '--category', 'mouse',
      '--product-id', productId,
      '--field', 'weight',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(provenance.command, 'provenance');
    assert.equal(provenance.field, 'weight');

    const changelog = await runCli([
      'changelog',
      '--category', 'mouse',
      '--product-id', productId,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(changelog.command, 'changelog');
    assert.equal(Array.isArray(changelog.entries), true);

    const sourceHealth = await runCli([
      'source-health',
      '--category', 'mouse',
      '--period', '30d',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(sourceHealth.command, 'source-health');
    assert.equal(sourceHealth.total_sources >= 1, true);

    const llmMetrics = await runCli([
      'llm-metrics',
      '--period', 'month',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(llmMetrics.command, 'llm-metrics');
    assert.equal(llmMetrics.total_calls >= 1, true);

    const benchmark = await runCli([
      'accuracy-benchmark',
      '--category', 'mouse',
      '--golden-files',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(benchmark.command, 'accuracy-benchmark');

    const trend = await runCli([
      'accuracy-trend',
      '--category', 'mouse',
      '--field', 'weight',
      '--period', '90d',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(trend.command, 'accuracy-trend');
    assert.equal(Array.isArray(trend.points), true);

    const driftSeed = await runCli([
      'drift-scan',
      '--category', 'mouse',
      '--max-products', '50',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(driftSeed.command, 'drift-scan');
    assert.equal(driftSeed.drift_detected_count, 0);

    await writeText(
      path.join(outputRoot, 'specs', 'outputs', 'final', 'mouse', 'razer', 'viper-v3-pro', 'evidence', 'sources.jsonl'),
      [
        JSON.stringify({ ts: '2026-02-13T00:00:00.000Z', host: 'manufacturer.example', source_id: 'manufacturer_example', tier: 1, status: 200, page_content_hash: 'sha256:aaa', text_hash: 'sha256:aaa' }),
        JSON.stringify({ ts: '2026-02-13T01:00:00.000Z', host: 'manufacturer.example', source_id: 'manufacturer_example', tier: 1, status: 200, page_content_hash: 'sha256:bbb', text_hash: 'sha256:bbb' })
      ].join('\n') + '\n'
    );

    const driftDetect = await runCli([
      'drift-scan',
      '--category', 'mouse',
      '--max-products', '50',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(driftDetect.command, 'drift-scan');
    assert.equal(Number.isFinite(Number(driftDetect.drift_detected_count)), true);
    assert.equal(Number(driftDetect.scanned_count) >= 1, true);

    const driftReconcile = await runCli([
      'drift-reconcile',
      '--category', 'mouse',
      '--product-id', productId,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(driftReconcile.command, 'drift-reconcile');
    assert.equal(['queued_for_review', 'quarantined', 'auto_republished', 'no_change'].includes(driftReconcile.action), true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
