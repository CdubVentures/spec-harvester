import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../src/engine/runtimeGate.js';

// ---------------------------------------------------------------------------
// list_rules enforcement tests
//
// Architecture (per Pass 1 agreement):
//   Candidate-level (normalizeCandidate): dedupe only
//   Final-level (runtimeGate):            sort + min/max enforcement
// ---------------------------------------------------------------------------

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function createListRulesFixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'list-rules-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      colors: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'string',
          shape: 'list',
          list_rules: { dedupe: true, sort: 'none', min_items: 0, max_items: 100 }
        },
        evidence: { required: false }
      },
      features: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'string',
          shape: 'list',
          list_rules: { dedupe: true, sort: 'asc', min_items: 0, max_items: 5 }
        },
        evidence: { required: false }
      },
      sizes: {
        required_level: 'expected',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'list',
          list_rules: { dedupe: true, sort: 'desc', min_items: 2, max_items: 10 }
        },
        evidence: { required: false }
      },
      tags: {
        required_level: 'optional',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'string',
          shape: 'list',
          list_rules: { dedupe: false, sort: 'none', min_items: 0, max_items: 100 }
        },
        evidence: { required: false }
      },
      weight: {
        required_level: 'required',
        difficulty: 'easy',
        availability: 'always',
        contract: {
          type: 'number',
          shape: 'scalar',
          unit: 'g',
          range: { min: 30, max: 200 }
        },
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
      { key: 'colors', group: 'physical' },
      { key: 'features', group: 'features' },
      { key: 'sizes', group: 'physical' },
      { key: 'tags', group: 'meta' },
      { key: 'weight', group: 'physical' }
    ]
  });

  return { root, helperRoot };
}

// =========================================================================
// SECTION 1: Candidate-level dedupe (via normalizeCandidate)
// =========================================================================

test('list_rules dedupe: removes case-insensitive string duplicates, preserves first casing', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = engine.normalizeCandidate('colors', 'Black, White, black, WHITE, white');
    assert.equal(result.ok, true);
    assert.deepEqual(result.normalized, ['Black', 'White']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules dedupe: whitespace-normalized comparison', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = engine.normalizeCandidate('colors', '  Black  , Black,  black ');
    assert.equal(result.ok, true);
    assert.deepEqual(result.normalized, ['Black']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules dedupe: number list removes exact duplicates', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = engine.normalizeCandidate('sizes', '100, 200, 100, 300, 200');
    assert.equal(result.ok, true);
    // After dedupe, 3 unique values remain (order may vary since sort happens later)
    assert.equal(result.normalized.length, 3);
    assert.ok(result.normalized.includes(100));
    assert.ok(result.normalized.includes(200));
    assert.ok(result.normalized.includes(300));
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules dedupe: disabled when dedupe=false — preserves duplicates', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    const result = engine.normalizeCandidate('tags', 'alpha, beta, alpha, gamma');
    assert.equal(result.ok, true);
    assert.deepEqual(result.normalized, ['alpha', 'beta', 'alpha', 'gamma']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules dedupe: empty list after dedupe stays empty', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // Empty input
    const result = engine.normalizeCandidate('colors', '');
    // normalizeCandidate should handle empty lists gracefully
    assert.equal(result.ok, false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 2: Final-level sort (via runtimeGate, between normalize + xval)
// =========================================================================

test('list_rules sort: asc sorts strings case-insensitively', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // features has sort: 'asc'
    const result = applyRuntimeFieldRules({
      engine,
      fields: { features: 'Cherry, Apple, Banana' },
      fieldOrder: ['features']
    });
    assert.deepEqual(result.fields.features, ['Apple', 'Banana', 'Cherry']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules sort: desc sorts numbers descending', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // sizes has sort: 'desc', type: 'number'
    const result = applyRuntimeFieldRules({
      engine,
      fields: { sizes: '10, 30, 20, 50, 40' },
      fieldOrder: ['sizes']
    });
    assert.deepEqual(result.fields.sizes, [50, 40, 30, 20, 10]);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules sort: none preserves original order', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // colors has sort: 'none'
    const result = applyRuntimeFieldRules({
      engine,
      fields: { colors: 'Red, Blue, Green' },
      fieldOrder: ['colors']
    });
    assert.deepEqual(result.fields.colors, ['Red', 'Blue', 'Green']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 3: Final-level min/max enforcement (via runtimeGate)
// =========================================================================

test('list_rules max_items: truncates list and records change', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // features has max_items: 5, sort: 'asc'
    const result = applyRuntimeFieldRules({
      engine,
      fields: { features: 'G, F, E, D, C, B, A' },
      fieldOrder: ['features']
    });
    // After dedupe + sort asc: [A, B, C, D, E, F, G] → truncated to [A, B, C, D, E]
    assert.equal(result.fields.features.length, 5);
    assert.deepEqual(result.fields.features, ['A', 'B', 'C', 'D', 'E']);
    // Should have a change record for the truncation
    const truncChange = result.changes.find(
      (c) => c.field === 'features' && c.stage === 'list_rules'
    );
    assert.ok(truncChange, 'expected a list_rules change record for truncation');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules min_items: violation sets field to unk with failure', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // sizes has min_items: 2, but only 1 value provided
    const result = applyRuntimeFieldRules({
      engine,
      fields: { sizes: '42' },
      fieldOrder: ['sizes']
    });
    assert.equal(result.fields.sizes, 'unk');
    const failure = result.failures.find(
      (f) => f.field === 'sizes' && f.reason_code === 'min_items_not_met'
    );
    assert.ok(failure, 'expected min_items_not_met failure');
    assert.equal(failure.stage, 'list_rules');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules min_items: exactly min_items passes', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // sizes has min_items: 2, providing exactly 2
    const result = applyRuntimeFieldRules({
      engine,
      fields: { sizes: '42, 84' },
      fieldOrder: ['sizes']
    });
    // Should pass (2 items meets min_items: 2)
    assert.ok(Array.isArray(result.fields.sizes));
    assert.equal(result.fields.sizes.length, 2);
    const failure = result.failures.find(
      (f) => f.field === 'sizes' && f.reason_code === 'min_items_not_met'
    );
    assert.equal(failure, undefined);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules min_items: after dedupe — duplicates collapse below minimum', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // sizes has min_items: 2, but both values are same → dedupe to 1 → below min
    const result = applyRuntimeFieldRules({
      engine,
      fields: { sizes: '42, 42' },
      fieldOrder: ['sizes']
    });
    assert.equal(result.fields.sizes, 'unk');
    const failure = result.failures.find(
      (f) => f.field === 'sizes' && f.reason_code === 'min_items_not_met'
    );
    assert.ok(failure, 'expected min_items_not_met after dedupe collapsed the list');
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

// =========================================================================
// SECTION 4: Combined pipeline + regression
// =========================================================================

test('list_rules combined: dedupe + sort + truncate in full pipeline', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // features: sort asc, max_items 5, dedupe true
    // Input: 8 items with duplicates → dedupe to 6 → sort asc → truncate to 5
    const result = applyRuntimeFieldRules({
      engine,
      fields: { features: 'Zebra, Apple, Mango, apple, Banana, Cherry, mango, Date' },
      fieldOrder: ['features']
    });
    // After dedupe: [Zebra, Apple, Mango, Banana, Cherry, Date] (6 unique)
    // After sort asc: [Apple, Banana, Cherry, Date, Mango, Zebra]
    // After max_items 5: [Apple, Banana, Cherry, Date, Mango]
    assert.equal(result.fields.features.length, 5);
    assert.deepEqual(result.fields.features, ['Apple', 'Banana', 'Cherry', 'Date', 'Mango']);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules: scalar field is unaffected by list_rules logic', async () => {
  const fixture = await createListRulesFixtureRoot();
  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: fixture.helperRoot }
    });
    // weight is a scalar number field, should normalize normally
    const result = applyRuntimeFieldRules({
      engine,
      fields: { weight: '54' },
      fieldOrder: ['weight']
    });
    assert.equal(result.fields.weight, 54);
    const listFailures = result.failures.filter((f) => f.stage === 'list_rules');
    assert.equal(listFailures.length, 0);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('list_rules: no list_rules in contract → no enforcement applied', async () => {
  // Create a fixture with a list field that has no list_rules at all
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'list-rules-noconfig-'));
  const helperRoot = path.join(root, 'helper_files');
  const generatedRoot = path.join(helperRoot, 'mouse', '_generated');

  await writeJson(path.join(generatedRoot, 'field_rules.json'), {
    category: 'mouse',
    fields: {
      labels: {
        required_level: 'optional',
        difficulty: 'easy',
        availability: 'always',
        contract: { type: 'string', shape: 'list' },
        evidence: { required: false }
      }
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
    category: 'mouse',
    fields: [{ key: 'labels', group: 'meta' }]
  });

  try {
    const engine = await FieldRulesEngine.create('mouse', {
      config: { helperFilesRoot: helperRoot }
    });
    // Duplicates should survive when there are no list_rules
    const result = applyRuntimeFieldRules({
      engine,
      fields: { labels: 'a, b, a, c' },
      fieldOrder: ['labels']
    });
    // Without list_rules, the raw parsed list is returned (no dedupe, no sort, no limits)
    assert.ok(Array.isArray(result.fields.labels));
    assert.equal(result.fields.labels.length, 4);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
