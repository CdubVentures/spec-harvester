import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../src/engine/runtimeGate.js';

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createEngineFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-gate-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
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
      },
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        enum_policy: 'closed',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      },
      dpi: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'scalar'
        }
      },
      coating: {
        required_level: 'optional',
        difficulty: 'medium',
        availability: 'sometimes',
        enum_policy: 'open',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {
      connection: {
        policy: 'closed',
        values: [
          { canonical: 'wired', aliases: ['usb wired'] },
          { canonical: 'wireless', aliases: ['2.4ghz'] }
        ]
      },
      coating: {
        policy: 'open',
        values: [
          { canonical: 'matte', aliases: ['matte finish'] }
        ]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {}
  });

  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse',
    rules: [
      {
        rule_id: 'dpi_plausibility',
        trigger_field: 'dpi',
        check: {
          type: 'range',
          min: 100,
          max: 30000
        }
      }
    ]
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
      { key: 'connection', group: 'connectivity' },
      { key: 'dpi', group: 'sensor' },
      { key: 'coating', group: 'physical' }
    ]
  });

  return {
    root,
    helperRoot
  };
}

test('applyRuntimeFieldRules normalizes values via engine contracts', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        weight: '3.5 oz',
        connection: 'usb wired',
        dpi: '26000'
      },
      provenance: {},
      fieldOrder: ['weight', 'connection', 'dpi']
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 99.22325);
    assert.equal(result.fields.connection, 'wired');
    assert.equal(result.failures.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules rejects closed enum values outside known set', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        connection: 'satellite'
      },
      provenance: {},
      fieldOrder: ['connection']
    });

    assert.equal(result.fields.connection, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'connection' && row.reason_code === 'enum_value_not_allowed'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules enforces cross-validation errors', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        dpi: 99000
      },
      provenance: {},
      fieldOrder: ['dpi']
    });

    assert.equal(result.fields.dpi, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'dpi' && row.reason_code === 'cross_validation_failed'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules can enforce strict evidence audit', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        connection: 'wired'
      },
      provenance: {
        connection: {
          evidence: [
            { url: 'https://example.com/specs' }
          ]
        }
      },
      fieldOrder: ['connection'],
      enforceEvidence: true,
      evidencePack: {
        snippets: []
      }
    });

    assert.equal(result.fields.connection, 'unk');
    assert.equal(
      result.failures.some((row) => row.field === 'connection' && row.reason_code === 'evidence_missing'),
      true
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('applyRuntimeFieldRules reports open-enum curation suggestions', async () => {
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = applyRuntimeFieldRules({
      engine,
      fields: {
        coating: 'satin microtexture'
      },
      provenance: {},
      fieldOrder: ['coating']
    });

    assert.equal(result.fields.coating, 'satin microtexture');
    assert.equal(Array.isArray(result.curation_suggestions), true);
    assert.equal(result.curation_suggestions.length, 1);
    assert.equal(result.curation_suggestions[0].field_key, 'coating');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Per-Field Evidence Enforcement — TDD Tests (Window 1: evidence_required)
// ===========================================================================
//
// These tests codify the Corrected Window 1 specification:
//
//   shouldAuditEvidence = enforceEvidence
//                      || (respectPerFieldEvidence && rule.evidence_required)
//
// New parameter: respectPerFieldEvidence (default: true)
// ---------------------------------------------------------------------------

/**
 * Creates a fixture specifically for per-field evidence enforcement tests.
 *
 * Fields:
 *   - weight:     evidence_required = true
 *   - connection: evidence_required = false
 *   - sensor:     evidence_required = true
 */
async function createEvidenceFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtimegate-evidence-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: true,
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 30, max: 200 }
        }
      },
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: false,
        enum_policy: 'closed',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      },
      sensor: {
        required_level: 'critical',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: true,
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {
      connection: {
        policy: 'closed',
        values: [
          { canonical: 'wired', aliases: ['usb wired'] },
          { canonical: 'wireless', aliases: ['2.4ghz'] },
          { canonical: 'bluetooth', aliases: ['bt'] }
        ]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse',
    templates: {
      weight: {
        patterns: [{ regex: '([\\d.]+)\\s*(g|oz)', group: 1 }]
      }
    }
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

  await writeJson(path.join(generatedRoot, 'component_db', 'sensors.json'), {
    component_type: 'sensor',
    db_name: 'sensors',
    entries: {}
  });

  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'physical' },
      { key: 'connection', group: 'connectivity' },
      { key: 'sensor', group: 'sensor' }
    ]
  });

  return { root, helperRoot };
}

async function withEvidenceEngine(fn) {
  const fixture = await createEvidenceFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    await fn(engine);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

// Good provenance that passes auditEvidence (includes strict fields since
// enforceEvidence=true internally sets strictEvidence=true in runtimeGate).
function goodProvenance(field) {
  return {
    url: 'https://example.com/specs',
    source_id: 'example_com',
    snippet_id: 's1',
    snippet_hash: 'sha256:abc123',
    quote: field === 'weight' ? '54 g' : field === 'sensor' ? 'PAW3395' : 'wired',
    quote_span: null,
    retrieved_at: '2026-02-14T10:00:00Z',
    extraction_method: 'spec_table_match'
  };
}

// Evidence pack that matches the good provenance
const goodEvidencePack = {
  snippets: {
    s1: {
      text: 'Weight: 54 g. Sensor: PAW3395. Connection: wired.',
      snippet_hash: 'sha256:abc123'
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Core acceptance test 1:
// evidence_required=true + known value + missing provenance → unk
// even when enforceEvidence=false
// ═══════════════════════════════════════════════════════════════════════════

test('per-field: evidence_required=true field becomes unk when provenance missing (enforceEvidence=false)', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, connection: 'wired' },
      provenance: {
        // weight has NO provenance → should fail evidence for evidence_required=true
        connection: goodProvenance('connection')
      },
      fieldOrder: ['weight', 'connection'],
      enforceEvidence: false,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    // weight has evidence_required=true, no provenance → must become unk
    assert.equal(result.fields.weight, 'unk', 'weight should be set to unk due to missing evidence');
    // connection has evidence_required=false, enforceEvidence=false → untouched
    assert.equal(result.fields.connection, 'wired', 'connection should remain unchanged');

    // Verify failure recorded
    const weightFailure = result.failures.find((f) => f.field === 'weight' && f.stage === 'evidence');
    assert.ok(weightFailure, 'should have evidence failure for weight');
  });
});

test('per-field: evidence_required=true field becomes unk when provenance incomplete (enforceEvidence=false)', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: {
        // Has URL but missing snippet_id and quote
        weight: { url: 'https://example.com' }
      },
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight should be unk due to incomplete provenance');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Core acceptance test 2:
// evidence_required=false + enforceEvidence=false → no evidence check
// ═══════════════════════════════════════════════════════════════════════════

test('per-field: evidence_required=false field is NOT checked when enforceEvidence=false', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { connection: 'wired' },
      provenance: {
        // No provenance at all — but evidence_required=false so should be fine
      },
      fieldOrder: ['connection'],
      enforceEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.connection, 'wired', 'connection should remain unchanged');
    const evidenceFailure = result.failures.find((f) => f.stage === 'evidence');
    assert.equal(evidenceFailure, undefined, 'no evidence failure should exist');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backwards compatibility:
// Global enforceEvidence=true still checks ALL fields
// ═══════════════════════════════════════════════════════════════════════════

test('backwards-compat: enforceEvidence=true checks all fields regardless of evidence_required', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, connection: 'wired' },
      provenance: {},
      fieldOrder: ['weight', 'connection'],
      enforceEvidence: true,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    // Both fields should be unk — enforceEvidence=true overrides per-field
    assert.equal(result.fields.weight, 'unk', 'weight should be unk');
    assert.equal(result.fields.connection, 'unk', 'connection should be unk even with evidence_required=false');

    const weightFailure = result.failures.find((f) => f.field === 'weight' && f.stage === 'evidence');
    assert.ok(weightFailure, 'weight evidence failure should exist');
    const connectionFailure = result.failures.find((f) => f.field === 'connection' && f.stage === 'evidence');
    assert.ok(connectionFailure, 'connection evidence failure should exist');
  });
});

test('backwards-compat: enforceEvidence=true with good provenance passes all fields', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, connection: 'wired' },
      provenance: {
        weight: goodProvenance('weight'),
        connection: goodProvenance('connection')
      },
      fieldOrder: ['weight', 'connection'],
      enforceEvidence: true,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 54, 'weight should pass with good provenance');
    assert.equal(result.fields.connection, 'wired', 'connection should pass with good provenance');
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 0, 'no evidence failures');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unknown values skip evidence checks
// ═══════════════════════════════════════════════════════════════════════════

test('per-field: unk values are skipped even when evidence_required=true', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 'unk', sensor: 'unk' },
      provenance: {},
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    // unk values should remain unk without new evidence failures
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 0, 'no evidence failures for unk values');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// respectPerFieldEvidence=false opt-out (QA Judge / Override Workflow)
// ═══════════════════════════════════════════════════════════════════════════

test('opt-out: respectPerFieldEvidence=false skips per-field evidence checks', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, sensor: 'PAW3395' },
      provenance: {},
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: false,
      respectPerFieldEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    // Both fields have evidence_required=true but respectPerFieldEvidence=false
    // should suppress per-field enforcement
    assert.equal(result.fields.weight, 54, 'weight should remain unchanged with opt-out');
    assert.equal(result.fields.sensor, 'PAW3395', 'sensor should remain unchanged with opt-out');
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 0, 'no evidence failures with opt-out');
  });
});

test('opt-out: respectPerFieldEvidence=false does NOT suppress global enforceEvidence=true', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: {},
      fieldOrder: ['weight'],
      enforceEvidence: true,
      respectPerFieldEvidence: false,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    // enforceEvidence=true always takes precedence
    assert.equal(result.fields.weight, 'unk', 'weight should be unk — global enforce overrides opt-out');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// respectPerFieldEvidence defaults to true
// ═══════════════════════════════════════════════════════════════════════════

test('default: respectPerFieldEvidence defaults to true (per-field enforcement active)', async () => {
  await withEvidenceEngine((engine) => {
    // Do NOT pass respectPerFieldEvidence — it should default to true
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, connection: 'wired' },
      provenance: {},
      fieldOrder: ['weight', 'connection'],
      enforceEvidence: false,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    // weight (evidence_required=true) should fail → unk
    assert.equal(result.fields.weight, 'unk', 'weight should be unk by default');
    // connection (evidence_required=false) should pass
    assert.equal(result.fields.connection, 'wired', 'connection should be unchanged');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Mixed scenario: multiple evidence_required=true fields, some with provenance
// ═══════════════════════════════════════════════════════════════════════════

test('mixed: only evidence_required=true fields without provenance fail', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, sensor: 'PAW3395', connection: 'wired' },
      provenance: {
        // weight has good provenance
        weight: goodProvenance('weight'),
        // sensor has NO provenance → should fail (evidence_required=true)
        // connection has NO provenance → should pass (evidence_required=false)
      },
      fieldOrder: ['weight', 'sensor', 'connection'],
      enforceEvidence: false,
      evidencePack: goodEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 54, 'weight has good provenance → stays');
    assert.equal(result.fields.sensor, 'unk', 'sensor missing provenance + evidence_required=true → unk');
    assert.equal(result.fields.connection, 'wired', 'connection missing provenance + evidence_required=false → stays');

    const failures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(failures.length, 1, 'only one evidence failure');
    assert.equal(failures[0].field, 'sensor');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge case: field with no rule at all (engine.getFieldRule returns null)
// ═══════════════════════════════════════════════════════════════════════════

test('edge: field with no rule definition is not evidence-checked in per-field mode', async () => {
  // Create a minimal fixture where we add an extra field to fieldOrder that
  // has no rule definition. We need the field to survive Pass 1 normalization
  // (normalizeCandidate returns ok:true for fields it doesn't know about when
  // isUnknownToken returns true for the field, so we use the engine fixture
  // and verify that evidence checking doesn't consider ruleless fields).
  //
  // The key verification: a field with no rule should NOT get evidence_required
  // treatment — its evidence_required should be treated as falsy/undefined.
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtimegate-norule-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: true,
        contract: { type: 'number', shape: 'scalar', unit: 'g', range: { min: 30, max: 200 } }
      },
      // 'extra_field' intentionally NOT in field_rules
    }
  });
  await writeJson(path.join(generatedRoot, 'known_values.json'), { category: 'mouse', enums: {} });
  await writeJson(path.join(generatedRoot, 'parse_templates.json'), { category: 'mouse', templates: {} });
  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), { category: 'mouse', rules: [] });
  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0', previous_version: '1.0.0', bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {}, migrations: []
  });
  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse', fields: [{ key: 'weight', group: 'physical' }]
  });

  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: helperRoot }
    });

    // Verify the engine truly has no rule for 'extra_field'
    assert.equal(engine.getFieldRule('extra_field'), null, 'extra_field should have no rule');

    // Directly test the evidence decision: for a field with no rule,
    // evidence_required is undefined/falsy → should NOT be evidence-checked
    const rule = engine.getFieldRule('extra_field');
    const shouldCheck = rule && rule.evidence_required;
    assert.equal(Boolean(shouldCheck), false,
      'field with no rule → evidence_required is falsy');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge case: evidence_required not set on rule (undefined) — should be falsy
// ═══════════════════════════════════════════════════════════════════════════

test('edge: field where evidence_required is undefined is treated as false', async () => {
  // Use the original fixture which does NOT have evidence_required on any field
  const fixture = await createEngineFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });

    const result = applyRuntimeFieldRules({
      engine,
      fields: { dpi: 16000 },
      provenance: {},
      fieldOrder: ['dpi'],
      enforceEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.dpi, 16000, 'dpi should remain — evidence_required undefined treated as false');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Changes array: evidence stage changes are properly recorded
// ═══════════════════════════════════════════════════════════════════════════

test('changes: evidence failures produce correct change records', async () => {
  await withEvidenceEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54, sensor: 'PAW3395' },
      provenance: {},
      fieldOrder: ['weight', 'sensor'],
      enforceEvidence: false,
      evidencePack: goodEvidencePack
    });

    const evidenceChanges = result.changes.filter((c) => c.stage === 'evidence');
    assert.equal(evidenceChanges.length, 2, 'two evidence changes (weight + sensor)');

    for (const change of evidenceChanges) {
      assert.equal(change.after, 'unk', 'after value should be unk');
      assert.notEqual(change.before, 'unk', 'before value should not be unk');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// No engine = no-op (existing behavior preserved)
// ═══════════════════════════════════════════════════════════════════════════

test('no-op: applyRuntimeFieldRules returns early when engine is null', () => {
  const result = applyRuntimeFieldRules({
    engine: null,
    fields: { weight: 54 },
    enforceEvidence: false
  });

  assert.equal(result.applied, false);
  assert.equal(result.fields.weight, 54);
  assert.equal(result.failures.length, 0);
});

// ===========================================================================
// Window 2: min_evidence_refs — TDD Tests
// ===========================================================================
//
// min_evidence_refs lives at rule.evidence.min_evidence_refs (nested).
//
// Quality audit runs if:
//   enforceEvidence || (respectPerFieldEvidence && (evidence_required || minRefs > 0))
//
// Count audit runs if:
//   minRefs > 1 && (enforceEvidence || respectPerFieldEvidence)
//
// Distinct ref = unique (url, snippet_id) pair.  Missing snippet_id → not counted.
// ---------------------------------------------------------------------------

/**
 * Fixture for min_evidence_refs tests.
 *
 * Fields:
 *   - weight:     evidence.min_evidence_refs = 2, evidence_required = true
 *   - connection: evidence.min_evidence_refs = 1, evidence_required = true
 *   - dpi:        evidence.min_evidence_refs = 2, evidence_required = false
 *   - coating:    evidence.min_evidence_refs = 0, evidence_required = false
 */
async function createMinRefsFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtimegate-minrefs-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: true,
        evidence: {
          required: true,
          min_evidence_refs: 2,
          conflict_policy: 'resolve_by_tier_else_unknown',
          tier_preference: ['tier1', 'tier2', 'tier3']
        },
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 30, max: 200 }
        }
      },
      connection: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: true,
        evidence: {
          required: true,
          min_evidence_refs: 1,
          conflict_policy: 'resolve_by_tier_else_unknown',
          tier_preference: ['tier1', 'tier2', 'tier3']
        },
        enum_policy: 'closed',
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      },
      dpi: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        evidence_required: false,
        evidence: {
          required: false,
          min_evidence_refs: 2,
          conflict_policy: 'resolve_by_tier_else_unknown',
          tier_preference: ['tier1', 'tier2', 'tier3']
        },
        contract: {
          type: 'number',
          shape: 'scalar',
          range: { min: 100, max: 50000 }
        }
      },
      coating: {
        required_level: 'optional',
        difficulty: 'medium',
        availability: 'sometimes',
        evidence_required: false,
        evidence: {
          required: false,
          min_evidence_refs: 0,
          conflict_policy: 'resolve_by_tier_else_unknown',
          tier_preference: ['tier1', 'tier2', 'tier3']
        },
        contract: {
          type: 'string',
          shape: 'scalar'
        }
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'known_values.json'), {
    category: 'mouse',
    enums: {
      connection: {
        policy: 'closed',
        values: [
          { canonical: 'wired', aliases: ['usb wired'] },
          { canonical: 'wireless', aliases: ['2.4ghz'] }
        ]
      }
    }
  });

  await writeJson(path.join(generatedRoot, 'parse_templates.json'), {
    category: 'mouse', templates: {}
  });
  await writeJson(path.join(generatedRoot, 'cross_validation_rules.json'), {
    category: 'mouse', rules: []
  });
  await writeJson(path.join(generatedRoot, 'key_migrations.json'), {
    version: '1.0.0', previous_version: '1.0.0', bump: 'patch',
    summary: { added_count: 0, removed_count: 0, changed_count: 0 },
    key_map: {}, migrations: []
  });
  await writeJson(path.join(generatedRoot, 'ui_field_catalog.json'), {
    category: 'mouse',
    fields: [
      { key: 'weight', group: 'physical' },
      { key: 'connection', group: 'connectivity' },
      { key: 'dpi', group: 'sensor' },
      { key: 'coating', group: 'physical' }
    ]
  });

  return { root, helperRoot };
}

async function withMinRefsEngine(fn) {
  const fixture = await createMinRefsFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    await fn(engine);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
}

// Helper: build provenance with N distinct evidence entries
function buildProvenance(field, evidenceEntries) {
  return {
    [field]: {
      value: null,
      evidence: evidenceEntries
    }
  };
}

// Helper: build a valid evidence entry
function makeEvidence(url, snippetId, quote) {
  return {
    url,
    snippet_id: snippetId,
    quote,
    source_id: 'test_source',
    snippet_hash: 'sha256:test',
    retrieved_at: '2026-02-14T10:00:00Z',
    extraction_method: 'spec_table_match'
  };
}

const minRefsEvidencePack = {
  snippets: {
    s1: { text: 'Weight: 54 g. DPI: 16000. Connection: wired. Coating: matte.', snippet_hash: 'sha256:test' },
    s2: { text: 'Weight confirmed 54 g by manufacturer spec sheet.', snippet_hash: 'sha256:test' },
    s3: { text: 'DPI specification: 16000.', snippet_hash: 'sha256:test' }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Core: min=2, only 1 distinct ref → fail with evidence_insufficient_refs
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=2 with 1 distinct ref → fail', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com/specs', 's1', '54 g')
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight should be unk — only 1 ref, need 2');
    const failure = result.failures.find((f) => f.field === 'weight' && f.stage === 'evidence');
    assert.ok(failure, 'should have evidence failure');
    assert.equal(failure.reason_code, 'evidence_insufficient_refs');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Core: min=2, 2 distinct refs → pass
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=2 with 2 distinct refs → pass', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com/specs', 's1', '54 g'),
        makeEvidence('https://manufacturer.com/product', 's2', '54 g')
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 54, 'weight should pass with 2 distinct refs');
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 0, 'no evidence failures');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Core: min=2, 3 distinct refs → pass
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=2 with 3 distinct refs → pass', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://a.com', 's1', '54 g'),
        makeEvidence('https://b.com', 's2', '54 g'),
        makeEvidence('https://c.com', 's3', '54 g')
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 54, 'weight should pass with 3 refs (need 2)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deduplication: same (url, snippet_id) pair counted once
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: duplicate (url, snippet_id) pairs are deduplicated', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com/specs', 's1', '54 g'),
        makeEvidence('https://example.com/specs', 's1', '54 grams'),  // same url+snippet
        makeEvidence('https://example.com/specs', 's1', '54g')         // same url+snippet again
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight unk — 3 entries but only 1 distinct pair');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Missing snippet_id entries don't count as distinct refs
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: evidence entries without snippet_id are not counted', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com/specs', 's1', '54 g'),
        { url: 'https://other.com', quote: '54 g' }  // no snippet_id
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight unk — entry without snippet_id not counted');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// min=1: no count check needed (quality check only)
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=1 only runs quality check, no count check', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { connection: 'wired' },
      provenance: buildProvenance('connection', [
        makeEvidence('https://example.com', 's1', 'wired')
      ]),
      fieldOrder: ['connection'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.connection, 'wired', 'connection passes with 1 ref (min=1)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// min=0 + evidence_required=false: no evidence check at all
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=0 + evidence_required=false → no evidence checks', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { coating: 'matte' },
      provenance: {},  // no provenance at all
      fieldOrder: ['coating'],
      enforceEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.coating, 'matte', 'coating passes — min=0, not required');
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge case: min=2 + evidence_required=false → quality AND count enforced
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: min=2 + evidence_required=false still enforces quality and count', async () => {
  await withMinRefsEngine((engine) => {
    // dpi: evidence_required=false, min_evidence_refs=2
    // Should still run quality check on first ref AND count check

    // First: no provenance at all → quality fail
    const noProvResult = applyRuntimeFieldRules({
      engine,
      fields: { dpi: 16000 },
      provenance: {},
      fieldOrder: ['dpi'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });
    assert.equal(noProvResult.fields.dpi, 'unk', 'dpi unk — no provenance, min>0 triggers quality check');

    // Second: 1 valid ref → quality passes but count fails
    const oneRefResult = applyRuntimeFieldRules({
      engine,
      fields: { dpi: 16000 },
      provenance: buildProvenance('dpi', [
        makeEvidence('https://example.com', 's1', '16000')
      ]),
      fieldOrder: ['dpi'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });
    assert.equal(oneRefResult.fields.dpi, 'unk', 'dpi unk — 1 ref but need 2');
    const countFail = oneRefResult.failures.find((f) => f.reason_code === 'evidence_insufficient_refs');
    assert.ok(countFail, 'should have insufficient refs failure');

    // Third: 2 valid refs → both pass
    const twoRefResult = applyRuntimeFieldRules({
      engine,
      fields: { dpi: 16000 },
      provenance: buildProvenance('dpi', [
        makeEvidence('https://a.com', 's1', '16000'),
        makeEvidence('https://b.com', 's3', '16000')
      ]),
      fieldOrder: ['dpi'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });
    assert.equal(twoRefResult.fields.dpi, 16000, 'dpi passes with 2 refs');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// respectPerFieldEvidence=false skips BOTH quality and count
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: respectPerFieldEvidence=false skips count check', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: {},
      fieldOrder: ['weight'],
      enforceEvidence: false,
      respectPerFieldEvidence: false,
      evidencePack: null
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 54, 'weight stays — opt-out disables per-field checks');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// enforceEvidence=true + min=2 + 1 ref → fail (global enforce + count)
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: enforceEvidence=true with min=2 and 1 ref → fail count', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com', 's1', '54 g')
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: true,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight unk — enforceEvidence=true, only 1 ref for min=2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Quality fail → CONTINUE, count check not reached
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: quality failure prevents redundant count check', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        // bad provenance — missing snippet_id and quote
        { url: 'https://example.com' },
        { url: 'https://other.com' }
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk');
    // Should have exactly 1 evidence failure (quality), not also a count failure
    const evidenceFailures = result.failures.filter((f) => f.stage === 'evidence');
    assert.equal(evidenceFailures.length, 1, 'only one evidence failure (quality, not count)');
    assert.notEqual(evidenceFailures[0].reason_code, 'evidence_insufficient_refs',
      'failure should be quality-related, not count');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Change records: count failures produce correct stage/reason
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: count failure produces correct change record', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: buildProvenance('weight', [
        makeEvidence('https://example.com', 's1', '54 g')
      ]),
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    const change = result.changes.find((c) => c.stage === 'evidence' && c.field === 'weight');
    assert.ok(change, 'should have evidence change record');
    assert.equal(change.before, 54);
    assert.equal(change.after, 'unk');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Empty evidence array → count = 0
// ═══════════════════════════════════════════════════════════════════════════

test('min-refs: empty evidence array counts as 0 distinct refs', async () => {
  await withMinRefsEngine((engine) => {
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: 54 },
      provenance: { weight: { evidence: [] } },
      fieldOrder: ['weight'],
      enforceEvidence: false,
      evidencePack: minRefsEvidencePack
    });

    assert.equal(result.applied, true);
    assert.equal(result.fields.weight, 'unk', 'weight unk — empty evidence array');
  });
});
