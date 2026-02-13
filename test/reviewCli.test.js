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
        effort: 2,
        contract: { type: 'number', shape: 'scalar', unit: 'g' },
        excel: {
          dataEntry: { sheet: 'dataEntry', row: 9, key_cell: 'B9' }
        },
        ui: { label: 'Weight', group: 'General', order: 9 }
      }
    }
  });
  await writeJson(path.join(generated, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [{ key: 'weight', label: 'Weight', group: 'General', order: 9 }]
  });
}

async function seedLatest(outputRoot, productId) {
  const base = path.join(outputRoot, 'specs', 'outputs', 'mouse', productId, 'latest');
  await writeJson(path.join(base, 'normalized.json'), {
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    fields: { weight: 'unk' }
  });
  await writeJson(path.join(base, 'provenance.json'), {
    weight: { value: 'unk', confidence: 0, evidence: [] }
  });
  await writeJson(path.join(base, 'summary.json'), {
    confidence: 0.2,
    coverage_overall: 0.1,
    missing_required_fields: ['weight'],
    fields_below_pass_target: ['weight'],
    critical_fields_below_pass_target: ['weight'],
    field_reasoning: {
      weight: {
        unknown_reason: 'not_found_after_search',
        reasons: ['missing_required_field']
      }
    },
    generated_at: '2026-02-13T00:00:00.000Z'
  });
  await writeJson(path.join(base, 'candidates.json'), {
    weight: [
      {
        candidate_id: 'cand_weight_1',
        value: '59',
        score: 0.81,
        host: 'manufacturer.example',
        source_id: 'manufacturer_example',
        tier: 1,
        method: 'spec_table_match',
        evidence: {
          url: 'https://manufacturer.example/spec',
          snippet_id: 'snp_001',
          quote: 'Weight: 59 g'
        }
      }
    ]
  });
}

async function seedQueue(outputRoot, productId) {
  const state = {
    category: 'mouse',
    updated_at: '2026-02-13T00:00:00.000Z',
    products: {
      [productId]: {
        productId,
        s3key: `specs/inputs/mouse/products/${productId}.json`,
        status: 'complete',
        priority: 3,
        updated_at: '2026-02-13T00:00:00.000Z'
      }
    }
  };
  const key = path.join(outputRoot, 'specs', 'outputs', '_queue', 'mouse', 'state.json');
  await writeJson(key, state);
}

async function seedReviewProduct(outputRoot, productId) {
  const base = path.join(outputRoot, 'specs', 'outputs', 'mouse', productId, 'review');
  await writeJson(path.join(base, 'product.json'), {
    product_id: productId,
    category: 'mouse',
    identity: { brand: 'Razer', model: 'Viper V3 Pro' },
    fields: {
      weight: {
        selected: {
          value: '59',
          confidence: 0.95,
          status: 'ok',
          color: 'green'
        },
        needs_review: false,
        reason_codes: [],
        candidates: [
          {
            candidate_id: 'cand_weight_1',
            value: '59',
            score: 0.81,
            source_id: 'manufacturer_example',
            source: 'manufacturer.example',
            tier: 1,
            method: 'spec_table_match',
            evidence: {
              url: 'https://manufacturer.example/spec',
              snippet_id: 'snp_001',
              quote: 'Weight: 59 g'
            }
          }
        ]
      }
    }
  });
}

test('review CLI builds artifacts, lists review queue, and writes suggestion files', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-cli-'));
  const inputRoot = path.join(tempRoot, 'fixtures');
  const outputRoot = path.join(tempRoot, 'out');
  const importsRoot = path.join(tempRoot, 'imports');
  const helperRoot = path.join(tempRoot, 'helper_files');
  const productId = 'mouse-review-cli';
  try {
    await seedHelperArtifacts(helperRoot);
    await seedLatest(outputRoot, productId);
    await seedQueue(outputRoot, productId);

    const env = {
      HELPER_FILES_ROOT: helperRoot
    };

    const built = await runCli([
      'review', 'build',
      '--category', 'mouse',
      '--product-id', productId,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(built.command, 'review');
    assert.equal(built.action, 'build');
    assert.equal(Boolean(built.product), true);
    assert.equal(built.product.review_field_count >= 1, true);
    await seedReviewProduct(outputRoot, productId);

    const queue = await runCli([
      'review', 'queue',
      '--category', 'mouse',
      '--status', 'needs_review',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(queue.command, 'review');
    assert.equal(queue.action, 'queue');
    assert.equal(queue.count >= 1, true);
    assert.equal(queue.items[0].product_id, productId);

    const productLite = await runCli([
      'review', 'product',
      '--category', 'mouse',
      '--product-id', productId,
      '--without-candidates',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(productLite.command, 'review');
    assert.equal(productLite.action, 'product');
    assert.deepEqual(productLite.fields.weight.candidates, []);
    assert.equal(productLite.fields.weight.candidate_count >= 1, true);

    const approveGreens = await runCli([
      'review', 'approve-greens',
      '--category', 'mouse',
      '--product-id', productId,
      '--reviewer', 'reviewer_cli',
      '--reason', 'bulk_green_approve',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(approveGreens.command, 'review');
    assert.equal(approveGreens.action, 'approve-greens');
    assert.equal(Number.isFinite(Number(approveGreens.approved_count)), true);
    assert.equal(Array.isArray(approveGreens.approved_fields), true);

    const metrics = await runCli([
      'review', 'metrics',
      '--category', 'mouse',
      '--window-hours', '24',
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(metrics.command, 'review');
    assert.equal(metrics.action, 'metrics');
    assert.equal(metrics.reviewed_products >= 0, true);
    assert.equal(metrics.products_per_hour >= 0, true);

    const suggestion = await runCli([
      'review', 'suggest',
      '--category', 'mouse',
      '--type', 'enum',
      '--field', 'switch_type',
      '--value', 'optical-v2',
      '--evidence-url', 'https://manufacturer.example/spec',
      '--evidence-quote', 'Switch Type: Optical V2',
      '--product-id', productId,
      ...localArgs({ inputRoot, outputRoot, importsRoot })
    ], { env });
    assert.equal(suggestion.command, 'review');
    assert.equal(suggestion.action, 'suggest');
    assert.equal(suggestion.appended, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
