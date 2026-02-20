import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../src/s3/storage.js';
import {
  approveGreenOverrides,
  buildReviewMetrics,
  finalizeOverrides,
  readReviewArtifacts,
  resolveOverrideFilePath,
  setManualOverride,
  setOverrideFromCandidate
} from '../src/review/overrideWorkflow.js';
import { buildManualOverrideCandidateId } from '../src/utils/candidateIdentifier.js';

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

async function seedFieldRulesArtifacts(helperRoot, category) {
  const generatedRoot = path.join(helperRoot, category, '_generated');
  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category,
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 30, max: 200 }
        }
      }
    }
  });
  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category,
    enums: {}
  });
  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category,
    templates: {}
  });
  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category,
    rules: []
  });
  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0',
    previous_version: '1.0.0',
    bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {},
    migrations: []
  });
  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category,
    fields: [{ key: 'weight', group: 'physical' }]
  });
}

async function seedReviewCandidates(storage, category, productId, value = '59') {
  const reviewBase = storage.resolveOutputKey(category, productId, 'review');
  await storage.writeObject(
    `${reviewBase}/candidates.json`,
    Buffer.from(JSON.stringify({
      version: 1,
      category,
      product_id: productId,
      candidate_count: 1,
      field_count: 1,
      items: [
        {
          candidate_id: 'cand_1',
          field: 'weight',
          value,
          score: 0.91,
          host: 'manufacturer.example',
          source_id: 'manufacturer_example',
          method: 'dom',
          tier: 1,
          evidence_key: 'https://manufacturer.example/spec#weight',
          evidence: {
            url: 'https://manufacturer.example/spec',
            snippet_id: 'snp_weight_1',
            snippet_hash: 'sha256:abc123',
            quote: `Weight: ${value} g`,
            quote_span: [0, 12],
            snippet_text: `Weight: ${value} g without cable`,
            source_id: 'manufacturer_example'
          }
        }
      ],
      by_field: {
        weight: ['cand_1']
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${reviewBase}/review_queue.json`,
    Buffer.from(JSON.stringify({
      version: 1,
      category,
      product_id: productId,
      count: 1,
      items: [{ field: 'weight', reason_codes: ['missing_required_field'] }]
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

async function seedLatestArtifacts(storage, category, productId) {
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  await storage.writeObject(
    `${latestBase}/normalized.json`,
    Buffer.from(JSON.stringify({
      identity: {
        brand: 'Razer',
        model: 'Viper V3 Pro'
      },
      fields: {
        weight: 'unk'
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/provenance.json`,
    Buffer.from(JSON.stringify({
      weight: {
        value: 'unk',
        confidence: 0
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    `${latestBase}/summary.json`,
    Buffer.from(JSON.stringify({
      missing_required_fields: ['weight'],
      fields_below_pass_target: ['weight'],
      critical_fields_below_pass_target: ['weight'],
      field_reasoning: {
        weight: {
          value: 'unk',
          unknown_reason: 'not_found_after_search',
          reasons: ['missing_required_field']
        }
      }
    }, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

async function seedReviewProductPayload(storage, category, productId, fieldStates = {}) {
  const reviewBase = storage.resolveOutputKey(category, productId, 'review');
  const payload = {
    product_id: productId,
    category,
    identity: {
      brand: 'Razer',
      model: 'Viper V3 Pro',
      variant: ''
    },
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
            candidate_id: 'cand_1',
            value: '59',
            score: 0.91,
            source_id: 'manufacturer_example',
            source: 'manufacturer.example',
            tier: 1,
            method: 'dom',
            evidence: {
              url: 'https://manufacturer.example/spec',
              snippet_id: 'snp_weight_1',
              snippet_hash: 'sha256:abc123',
              quote: 'Weight: 59 g',
              quote_span: [0, 12],
              snippet_text: 'Weight: 59 g without cable',
              source_id: 'manufacturer_example'
            }
          }
        ]
      },
      ...fieldStates
    }
  };
  await storage.writeObject(
    `${reviewBase}/product.json`,
    Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
}

test('setOverrideFromCandidate writes helper override file and finalize applies it to latest artifacts', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-override-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-override';
  try {
    await seedFieldRulesArtifacts(config.helperFilesRoot, category);
    await seedReviewCandidates(storage, category, productId);
    await seedLatestArtifacts(storage, category, productId);

    const setResult = await setOverrideFromCandidate({
      storage,
      config,
      category,
      productId,
      field: 'weight',
      candidateId: 'cand_1'
    });
    assert.equal(setResult.value, '59');
    const overridePath = resolveOverrideFilePath({ config, category, productId });
    const overridePayload = JSON.parse(await fs.readFile(overridePath, 'utf8'));
    assert.equal(overridePayload.overrides.weight.override_value, '59');
    assert.equal(overridePayload.overrides.weight.override_source, 'candidate_selection');
    assert.equal(overridePayload.overrides.weight.override_provenance.snippet_id, 'snp_weight_1');

    const previewFinalize = await finalizeOverrides({
      storage,
      config,
      category,
      productId,
      applyOverrides: false
    });
    assert.equal(previewFinalize.applied, false);
    assert.equal(previewFinalize.reason, 'apply_overrides_flag_not_set');

    const finalizeResult = await finalizeOverrides({
      storage,
      config,
      category,
      productId,
      applyOverrides: true
    });
    assert.equal(finalizeResult.applied, true);
    assert.equal(finalizeResult.applied_count, 1);

    const latestBase = storage.resolveOutputKey(category, productId, 'latest');
    const normalized = await storage.readJson(`${latestBase}/normalized.json`);
    const summary = await storage.readJson(`${latestBase}/summary.json`);
    const provenance = await storage.readJson(`${latestBase}/provenance.json`);
    assert.equal(normalized.fields.weight, 59);
    assert.equal(summary.field_reasoning.weight.unknown_reason, null);
    assert.equal(provenance.weight.override.candidate_id, 'cand_1');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('setOverrideFromCandidate accepts synthetic candidates when candidateValue is provided', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-synthetic-candidate-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-synthetic-candidate';
  try {
    await seedFieldRulesArtifacts(config.helperFilesRoot, category);
    await seedLatestArtifacts(storage, category, productId);

    const setResult = await setOverrideFromCandidate({
      storage,
      config,
      category,
      productId,
      field: 'weight',
      candidateId: 'pl_weight_synthetic_1',
      candidateValue: '59',
      candidateSource: 'pipeline',
      candidateMethod: 'product_extraction',
    });
    assert.equal(setResult.value, '59');
    assert.equal(setResult.candidate_id, 'pl_weight_synthetic_1');

    const overridePath = resolveOverrideFilePath({ config, category, productId });
    const overridePayload = JSON.parse(await fs.readFile(overridePath, 'utf8'));
    assert.equal(overridePayload.overrides.weight.candidate_id, 'pl_weight_synthetic_1');
    assert.equal(overridePayload.overrides.weight.override_value, '59');
    assert.equal(overridePayload.overrides.weight.source.method, 'product_extraction');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('finalizeOverrides demotes invalid override values through runtime engine gate', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-override-invalid-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-override-invalid';

  try {
    await seedFieldRulesArtifacts(config.helperFilesRoot, category);
    await seedReviewCandidates(storage, category, productId, '10');
    await seedLatestArtifacts(storage, category, productId);

    await setOverrideFromCandidate({
      storage,
      config,
      category,
      productId,
      field: 'weight',
      candidateId: 'cand_1'
    });
    const blocked = await finalizeOverrides({
      storage,
      config,
      category,
      productId,
      applyOverrides: true
    });
    assert.equal(blocked.applied, false);
    assert.equal(blocked.reason, 'runtime_validation_failed');
    assert.equal(blocked.runtime_gate.failure_count > 0, true);

    const finalizeResult = await finalizeOverrides({
      storage,
      config,
      category,
      productId,
      applyOverrides: true,
      saveAsDraft: true
    });
    assert.equal(finalizeResult.applied, true);
    assert.equal(finalizeResult.runtime_gate.failure_count > 0, true);

    const latestBase = storage.resolveOutputKey(category, productId, 'latest');
    const normalized = await storage.readJson(`${latestBase}/normalized.json`);
    const summary = await storage.readJson(`${latestBase}/summary.json`);
    assert.equal(normalized.fields.weight, 'unk');
    assert.equal(
      summary.field_reasoning.weight.unknown_reason,
      'out_of_range'
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('readReviewArtifacts returns safe defaults when review files do not exist', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-read-'));
  const storage = makeStorage(tempRoot);
  try {
    const result = await readReviewArtifacts({
      storage,
      category: 'mouse',
      productId: 'missing-review'
    });
    assert.equal(Array.isArray(result.candidates.items), true);
    assert.equal(Array.isArray(result.reviewQueue.items), true);
    assert.equal(result.reviewQueue.count, 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('setManualOverride requires evidence and writes canonical manual override candidate id', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-manual-override-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-manual';
  try {
    await assert.rejects(
      () => setManualOverride({
        storage,
        config,
        category,
        productId,
        field: 'weight',
        value: '59',
        evidence: {
          url: '',
          quote: ''
        }
      }),
      /requires evidence.url and evidence.quote/i
    );

    const manual = await setManualOverride({
      storage,
      config,
      category,
      productId,
      field: 'weight',
      value: '59',
      reason: 'Official spec table',
      reviewer: 'reviewer_1',
      evidence: {
        url: 'https://manufacturer.example/spec',
        quote: 'Weight: 59 g',
        quote_span: [0, 12]
      }
    });
    assert.equal(
      manual.candidate_id,
      buildManualOverrideCandidateId({
        category,
        productId,
        fieldKey: 'weight',
        value: '59',
        evidenceUrl: 'https://manufacturer.example/spec',
        evidenceQuote: 'Weight: 59 g',
      }),
    );

    const overridePath = resolveOverrideFilePath({ config, category, productId });
    const overridePayload = JSON.parse(await fs.readFile(overridePath, 'utf8'));
    assert.equal(overridePayload.overrides.weight.override_source, 'manual_entry');
    assert.equal(overridePayload.overrides.weight.override_provenance.url, 'https://manufacturer.example/spec');
    assert.equal(overridePayload.overrides.weight.override_value, '59');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('approveGreenOverrides writes candidate overrides only for green known fields', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-approve-greens-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-approve-greens';
  try {
    await seedFieldRulesArtifacts(config.helperFilesRoot, category);
    await seedReviewCandidates(storage, category, productId);
    await seedLatestArtifacts(storage, category, productId);
    await seedReviewProductPayload(storage, category, productId, {
      dpi: {
        selected: {
          value: 'unk',
          confidence: 0,
          status: 'needs_review',
          color: 'gray'
        },
        needs_review: true,
        reason_codes: ['missing_value'],
        candidates: []
      }
    });

    const result = await approveGreenOverrides({
      storage,
      config,
      category,
      productId,
      reviewer: 'reviewer_1',
      reason: 'bulk_green_approve'
    });

    assert.equal(result.approved_count, 1);
    assert.equal(result.skipped_count >= 1, true);
    assert.equal(result.approved_fields.includes('weight'), true);

    const overridePath = resolveOverrideFilePath({ config, category, productId });
    const overridePayload = JSON.parse(await fs.readFile(overridePath, 'utf8'));
    assert.equal(overridePayload.review_status, 'in_progress');
    assert.equal(overridePayload.overrides.weight.override_source, 'candidate_selection');
    assert.equal(overridePayload.overrides.weight.override_reason, 'bulk_green_approve');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('buildReviewMetrics reports throughput and override ratios from override docs', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'spec-harvester-review-metrics-'));
  const storage = makeStorage(tempRoot);
  const config = {
    helperFilesRoot: path.join(tempRoot, 'helper_files')
  };
  const category = 'mouse';
  const productId = 'mouse-review-metrics';
  try {
    await seedFieldRulesArtifacts(config.helperFilesRoot, category);
    await seedReviewCandidates(storage, category, productId);
    await seedLatestArtifacts(storage, category, productId);
    await seedReviewProductPayload(storage, category, productId);
    await approveGreenOverrides({
      storage,
      config,
      category,
      productId,
      reviewer: 'reviewer_metrics',
      reason: 'bulk_green_approve'
    });
    await finalizeOverrides({
      storage,
      config,
      category,
      productId,
      applyOverrides: true
    });

    const metrics = await buildReviewMetrics({
      config,
      category,
      windowHours: 24
    });
    assert.equal(metrics.category, category);
    assert.equal(metrics.reviewed_products >= 1, true);
    assert.equal(metrics.overrides_total >= 1, true);
    assert.equal(metrics.products_per_hour > 0, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
