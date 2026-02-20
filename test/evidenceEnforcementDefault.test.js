import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../src/engine/runtimeGate.js';

// ---------------------------------------------------------------------------
// A.1 (continued) — RuntimeGate Evidence Enforcement Default Tests
//
// After A.1 wire-in, enforceEvidence should default to TRUE when aggressive
// mode is enabled. These tests verify the behavior of runtimeGate.js with
// evidence enforcement in various scenarios.
// ---------------------------------------------------------------------------

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-enforce-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar', unit: 'g', range: { min: 30, max: 200 } },
        evidence: { required: true, min_evidence_refs: 1 }
      },
      sensor: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'string', shape: 'scalar' },
        evidence: { required: true, min_evidence_refs: 1 }
      },
      polling_rate: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'number', shape: 'scalar' },
        evidence: { required: false }
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

  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0',
    previous_version: '1.0.0',
    bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {},
    migrations: []
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'physical' },
      { key: 'sensor', group: 'sensor' },
      { key: 'polling_rate', group: 'performance' }
    ]
  });

  return { root, helperRoot };
}

// =========================================================================
// SECTION 1: Evidence enforcement zeroes out fields without evidence
// =========================================================================

test('A.1 enforce: field with value but no evidence provenance is zeroed out', async () => {
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '54',
        sensor: 'Focus Pro 4K'
      },
      provenance: {},
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: true,
      evidencePack: { snippets: [], references: [] }
    });

    assert.equal(result.fields.weight, 'unk');
    assert.equal(result.fields.sensor, 'unk');
    assert.ok(result.failures.length >= 2);
    assert.ok(result.failures.every((f) => f.stage === 'evidence'));
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 2: Evidence enforcement passes with valid provenance
// =========================================================================

test('A.1 enforce: strict enforcement via runtimeGate accepts complete provenance (BUG FIXED)', async () => {
  // toEvidenceProvenance now passes retrieved_at + extraction_method,
  // so strict enforcement works correctly with complete provenance.
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: '54' },
      provenance: {
        weight: {
          url: 'https://rtings.com/mouse/razer-viper',
          snippet_id: 's1',
          quote: '54 grams',
          source_id: 'rtings_com',
          snippet_hash: 'sha256:abc',
          retrieved_at: new Date().toISOString(),
          extraction_method: 'spec_table_match'
        }
      },
      fieldOrder: ['weight'],
      enforceEvidence: true,
      evidencePack: {
        snippets: [{
          id: 's1',
          source_id: 'rtings_com',
          normalized_text: 'The mouse weighs 54 grams.',
          snippet_hash: 'sha256:abc'
        }],
        references: [{ id: 's1', url: 'https://rtings.com/mouse/razer-viper' }]
      }
    });
    // With the fix, weight should now pass strict evidence audit
    assert.notEqual(result.fields.weight, 'unk');
    assert.equal(result.failures.filter((f) => f.stage === 'evidence').length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 3: Mixed — some fields have evidence, some don't
// =========================================================================

test('A.1 enforce: weight preserved, sensor zeroed — mixed evidence (BUG FIXED)', async () => {
  // With the toEvidenceProvenance fix, weight (has complete provenance)
  // is preserved while sensor (no provenance) is zeroed.
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '54',
        sensor: 'Focus Pro 4K'
      },
      provenance: {
        weight: {
          url: 'https://rtings.com',
          snippet_id: 's1',
          quote: '54',
          source_id: 'rtings_com',
          snippet_hash: 'sha256:w1',
          retrieved_at: new Date().toISOString(),
          extraction_method: 'spec_table_match'
        }
      },
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: true,
      evidencePack: {
        snippets: [{
          id: 's1',
          source_id: 'rtings_com',
          normalized_text: 'Weight: 54 grams',
          snippet_hash: 'sha256:w1'
        }],
        references: [{ id: 's1', url: 'https://rtings.com' }]
      }
    });

    // Weight should be preserved (has complete evidence provenance)
    assert.notEqual(result.fields.weight, 'unk');
    // Sensor should be zeroed (no evidence provenance)
    assert.equal(result.fields.sensor, 'unk');
    // Only sensor should have evidence failure
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 1);
    assert.equal(evidenceFailures[0].field, 'sensor');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 4: Without enforceEvidence, fields pass regardless
// =========================================================================

test('A.1 enforce off: fields without evidence pass when enforceEvidence=false and per-field off', async () => {
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '54',
        sensor: 'Focus Pro 4K'
      },
      provenance: {},
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: false,
      respectPerFieldEvidence: false
    });

    // Without enforcement AND per-field off, both should pass normalization
    assert.notEqual(result.fields.weight, 'unk');
    assert.notEqual(result.fields.sensor, 'unk');
    // No evidence failures
    assert.equal(result.failures.filter((f) => f.stage === 'evidence').length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 5: Changes are tracked correctly
// =========================================================================

test('A.1 enforce: changes list records before/after for evidence failures', async () => {
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '54'
      },
      provenance: {},
      fieldOrder: ['weight'],
      enforceEvidence: true,
      evidencePack: { snippets: [], references: [] }
    });

    const weightChange = result.changes.find(
      (c) => c.field === 'weight' && c.stage === 'evidence'
    );
    assert.ok(weightChange);
    assert.notEqual(weightChange.before, 'unk');
    assert.equal(weightChange.after, 'unk');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 6: Normalization still runs before evidence check
// =========================================================================

test('A.1 enforce: normalization failures happen before evidence check', async () => {
  const fixture = await createFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '999999'  // out of range 30-200
      },
      provenance: {
        weight: {
          url: 'https://example.com',
          snippet_id: 's1',
          quote: '999999',
          source_id: 'example'
        }
      },
      fieldOrder: ['weight'],
      enforceEvidence: true,
      evidencePack: {
        snippets: [{
          id: 's1',
          source_id: 'example',
          normalized_text: 'Weight: 999999 grams',
          snippet_hash: 'sha256:x'
        }],
        references: [{ id: 's1', url: 'https://example.com' }]
      }
    });

    // Weight should be unk due to cross-validation (out of range), NOT evidence failure
    assert.equal(result.fields.weight, 'unk');
    // The failure should be from cross_validate or normalize, not evidence
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    // Field was already zeroed by normalization/cross-validate, so evidence check shouldn't fire
    assert.equal(evidenceFailures.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
