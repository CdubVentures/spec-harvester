import test from 'node:test';
import assert from 'node:assert/strict';
import { runQaJudge } from '../src/review/qaJudge.js';

// ---------------------------------------------------------------------------
// Phase 03 — Testing: QA Judge Tests
// ---------------------------------------------------------------------------

function createMockStorage(files = {}) {
  return {
    resolveOutputKey: (...parts) => parts.filter(Boolean).join('/'),
    async readJsonOrNull(key) {
      return files[key] || null;
    }
  };
}

test('P03 judge: returns error when category missing', async () => {
  const storage = createMockStorage();
  const result = await runQaJudge({ storage, config: {}, category: '', productId: 'p1' });
  assert.equal(result.ok, false);
});

test('P03 judge: returns error when spec not found', async () => {
  const storage = createMockStorage();
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'nonexistent' });
  assert.equal(result.ok, false);
  assert.ok(result.error.includes('not found'));
});

test('P03 judge: audits complete product spec', async () => {
  const storage = createMockStorage({
    'mouse/p1/final/spec.json': {
      fields: {
        weight: '54',
        sensor: 'Focus Pro 4K',
        dpi: 'unk',
        polling_rate: '4000'
      }
    },
    'mouse/p1/final/provenance.json': {
      weight: { url: 'https://rtings.com', snippet_id: 's1', quote: '54g', source_id: 'rtings' },
      sensor: { url: 'https://razer.com', snippet_id: 's2', quote: 'Focus Pro', source_id: 'razer' },
      polling_rate: { url: 'https://razer.com', snippet_id: 's3', quote: '4000 Hz', source_id: 'razer' }
    }
  });
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'p1' });
  assert.equal(result.ok, true);
  assert.equal(result.summary.total_fields, 4);
  assert.equal(result.summary.known_fields, 3);
  assert.equal(result.summary.unknown_fields, 1);
  assert.ok(result.summary.coverage_ratio > 0.5);
  assert.equal(result.unknown_field_list.length, 1);
  assert.ok(result.unknown_field_list.includes('dpi'));
});

test('P03 judge: detects fields without provenance', async () => {
  const storage = createMockStorage({
    'mouse/p1/final/spec.json': {
      fields: {
        weight: '54',
        sensor: 'Focus Pro 4K'
      }
    },
    'mouse/p1/final/provenance.json': {
      weight: { url: 'https://rtings.com', snippet_id: 's1', quote: '54g', source_id: 'rtings' }
      // sensor has no provenance
    }
  });
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'p1' });
  assert.equal(result.ok, true);
  assert.ok(result.evidence_issues.length >= 1);
  assert.ok(result.evidence_issues.some((i) => i.field === 'sensor' && i.issue === 'no_provenance'));
});

test('P03 judge: detects provenance without source URL', async () => {
  const storage = createMockStorage({
    'mouse/p1/final/spec.json': {
      fields: { weight: '54' }
    },
    'mouse/p1/final/provenance.json': {
      weight: { quote: '54g' }
    }
  });
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'p1' });
  assert.equal(result.ok, true);
  assert.ok(result.evidence_issues.some((i) => i.field === 'weight' && i.issue === 'no_source_url'));
});

test('P03 judge: all unknown fields produce 0 coverage', async () => {
  const storage = createMockStorage({
    'mouse/p1/final/spec.json': {
      fields: { weight: 'unk', sensor: 'unk' }
    }
  });
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'p1' });
  assert.equal(result.ok, true);
  assert.equal(result.summary.coverage_ratio, 0);
  assert.equal(result.summary.known_fields, 0);
  assert.equal(result.evidence_issues.length, 0);
});

test('P03 judge: handles spec without nested fields key', async () => {
  // Some specs have fields at top level
  const storage = createMockStorage({
    'mouse/p1/final/spec.json': {
      weight: '54',
      sensor: 'unk'
    }
  });
  const result = await runQaJudge({ storage, config: {}, category: 'mouse', productId: 'p1' });
  assert.equal(result.ok, true);
  assert.ok(result.summary.total_fields >= 1);
});
