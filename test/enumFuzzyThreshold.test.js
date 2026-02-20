import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldRulesEngine } from '../src/engine/fieldRulesEngine.js';
import { ComponentResolver } from '../src/extract/componentResolver.js';

// ---------------------------------------------------------------------------
// enum_fuzzy_threshold tests
//
// Fixes dead config: enum_fuzzy_threshold is authored per-field in Studio
// (compiled into rule.enum.match.fuzzy_threshold) but runtime hardcodes 0.75.
//
// After fix:
//   - normalizeCandidate reads rule.enum.match.fuzzy_threshold ?? 0.75
//   - ComponentResolver reads rule.enum.match.fuzzy_threshold ?? 0.7
//   - Invalid values are clamped to [0, 1] at runtime
// ---------------------------------------------------------------------------

// Similarity scores (simpleSimilarity uses containment: short.length / long.length)
//
// "SensorX"  (7 chars) vs "SensorXY"  (8 chars) → 7/8 = 0.875
// "SensorX"  (7 chars) vs "SensorXYZ" (9 chars) → 7/9 = 0.778
// "SensorX"  (7 chars) vs "SensorX"   (7 chars) → 1.0
//
// So a query "SensorXY" against DB entry "SensorX" scores 0.875:
//   - passes at threshold 0.75 ✓
//   - fails  at threshold 0.92 ✗

function buildComponentDB() {
  return {
    sensor: {
      entries: {
        sensorx: {
          canonical_name: 'SensorX',
          properties: { max_dpi: 26000, sensor_type: 'optical' }
        },
        sensory: {
          canonical_name: 'SensorY',
          properties: { max_dpi: 16000, sensor_type: 'laser' }
        }
      }
    }
  };
}

function buildEngine(fieldRules, componentDBs = buildComponentDB()) {
  return new FieldRulesEngine({
    category: 'test',
    loaded: {
      rules: { fields: fieldRules },
      knownValues: {},
      componentDBs
    }
  });
}

function sensorField(overrides = {}) {
  return {
    required_level: 'required',
    difficulty: 'easy',
    availability: 'always',
    contract: { type: 'component_ref', shape: 'scalar' },
    component_db_ref: 'sensor',
    evidence: { required: false },
    ...overrides
  };
}

// =========================================================================
// SECTION 1: fuzzyMatchComponent with explicit threshold parameter
// =========================================================================

test('fuzzyMatchComponent: marginal match passes at default threshold 0.75', () => {
  const engine = buildEngine({ sensor: sensorField() });
  // "SensorXY" vs "SensorX" → score 0.875, passes 0.75
  const result = engine.fuzzyMatchComponent('sensor', 'SensorXY');
  assert.ok(result.match, 'should match at default 0.75 threshold');
  assert.equal(result.match.canonical_name, 'SensorX');
  assert.ok(result.score >= 0.75);
});

test('fuzzyMatchComponent: marginal match fails at strict threshold 0.92', () => {
  const engine = buildEngine({ sensor: sensorField() });
  // "SensorXY" vs "SensorX" → score 0.875, fails 0.92
  const result = engine.fuzzyMatchComponent('sensor', 'SensorXY', 0.92);
  assert.equal(result.match, null, 'should NOT match at 0.92 threshold');
  assert.ok(result.score < 0.92);
  assert.ok(result.score > 0, 'score should still be computed');
});

test('fuzzyMatchComponent: exact match passes at any threshold', () => {
  const engine = buildEngine({ sensor: sensorField() });
  const result = engine.fuzzyMatchComponent('sensor', 'SensorX', 0.99);
  assert.ok(result.match, 'exact match should pass even at 0.99');
  assert.equal(result.score, 1);
});

// =========================================================================
// SECTION 2: normalizeCandidate reads per-field threshold
// =========================================================================

test('normalizeCandidate: component_ref with authored threshold=0.92 rejects marginal fuzzy match', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { strategy: 'alias', fuzzy_threshold: 0.92 } }
    })
  });
  // "SensorXY" → fuzzy score 0.875 → below 0.92 → rejected
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, 'component_not_found');
});

test('normalizeCandidate: component_ref with authored threshold=0.75 accepts same marginal match', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { strategy: 'alias', fuzzy_threshold: 0.75 } }
    })
  });
  // "SensorXY" → fuzzy score 0.875 → above 0.75 → accepted
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, 'SensorX');
});

test('normalizeCandidate: component_ref with no authored threshold defaults to 0.75', () => {
  const engine = buildEngine({
    sensor: sensorField()
    // no enum.match.fuzzy_threshold → should default to 0.75
  });
  // "SensorXY" → score 0.875 → above default 0.75 → accepted
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, 'SensorX');
});

test('normalizeCandidate: exact component match always succeeds regardless of threshold', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { strategy: 'alias', fuzzy_threshold: 0.99 } }
    })
  });
  const result = engine.normalizeCandidate('sensor', 'SensorX');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, 'SensorX');
});

test('normalizeCandidate: very weak match rejected at default threshold', () => {
  const engine = buildEngine({
    sensor: sensorField()
  });
  // "CompletelyDifferent" vs "SensorX" → very low similarity → rejected
  const result = engine.normalizeCandidate('sensor', 'CompletelyDifferent');
  assert.equal(result.ok, false);
  assert.equal(result.reason_code, 'component_not_found');
});

// =========================================================================
// SECTION 3: ComponentResolver reads per-field threshold
// =========================================================================

test('ComponentResolver: uses authored threshold from field rule', () => {
  // Strict threshold (0.92) should reject marginal match in inference
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { strategy: 'alias', fuzzy_threshold: 0.92 } }
    }),
    max_dpi: {
      required_level: 'expected',
      difficulty: 'easy',
      availability: 'always',
      contract: { type: 'number', shape: 'scalar' },
      evidence: { required: false }
    }
  });
  const resolver = new ComponentResolver(engine);
  const rows = resolver.resolveFromCandidates([
    { field: 'sensor', value: 'SensorXY', method: 'html_table', keyPath: 'table.sensor' }
  ]);
  // With threshold=0.92, fuzzy score 0.875 should NOT match → no inferred fields
  const inferredDpi = rows.find((r) => r.field === 'max_dpi' && r.method === 'component_db_inference');
  assert.equal(inferredDpi, undefined, 'should not infer fields when fuzzy match fails strict threshold');
});

test('ComponentResolver: looser authored threshold allows inference', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { strategy: 'alias', fuzzy_threshold: 0.70 } }
    }),
    max_dpi: {
      required_level: 'expected',
      difficulty: 'easy',
      availability: 'always',
      contract: { type: 'number', shape: 'scalar' },
      evidence: { required: false }
    }
  });
  const resolver = new ComponentResolver(engine);
  const rows = resolver.resolveFromCandidates([
    { field: 'sensor', value: 'SensorXY', method: 'html_table', keyPath: 'table.sensor' }
  ]);
  const inferredDpi = rows.find((r) => r.field === 'max_dpi' && r.method === 'component_db_inference');
  assert.ok(inferredDpi, 'should infer fields when fuzzy match passes looser threshold');
  assert.equal(inferredDpi.value, '26000');
});

test('ComponentResolver: default threshold (no authored value) uses 0.7', () => {
  const engine = buildEngine({
    sensor: sensorField(),
    max_dpi: {
      required_level: 'expected',
      difficulty: 'easy',
      availability: 'always',
      contract: { type: 'number', shape: 'scalar' },
      evidence: { required: false }
    }
  });
  const resolver = new ComponentResolver(engine);
  // "SensorXYZ" → score 7/9 = 0.778 → above default 0.7 → match
  const rows = resolver.resolveFromCandidates([
    { field: 'sensor', value: 'SensorXYZ', method: 'html_table', keyPath: 'table.sensor' }
  ]);
  const inferredDpi = rows.find((r) => r.field === 'max_dpi' && r.method === 'component_db_inference');
  assert.ok(inferredDpi, 'should infer fields at default 0.7 threshold');
});

// =========================================================================
// SECTION 4: Runtime clamp — invalid threshold values
// =========================================================================

test('normalizeCandidate: negative threshold clamped to 0 (accepts any match)', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { fuzzy_threshold: -0.5 } }
    })
  });
  // Any non-zero similarity should pass when threshold is clamped to 0
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, true);
});

test('normalizeCandidate: threshold > 1 clamped to 1 (only exact match)', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { fuzzy_threshold: 5.0 } }
    })
  });
  // Marginal match should fail when threshold clamped to 1
  const resultMarginal = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(resultMarginal.ok, false);
  // Exact match should pass when threshold is 1
  const resultExact = engine.normalizeCandidate('sensor', 'SensorX');
  assert.equal(resultExact.ok, true);
});

test('normalizeCandidate: NaN threshold falls back to default 0.75', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { fuzzy_threshold: 'not_a_number' } }
    })
  });
  // "SensorXY" → score 0.875 → above default 0.75 → accepted
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, 'SensorX');
});

test('normalizeCandidate: null threshold falls back to default 0.75', () => {
  const engine = buildEngine({
    sensor: sensorField({
      enum: { match: { fuzzy_threshold: null } }
    })
  });
  const result = engine.normalizeCandidate('sensor', 'SensorXY');
  assert.equal(result.ok, true);
  assert.equal(result.normalized, 'SensorX');
});
