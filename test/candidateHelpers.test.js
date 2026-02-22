import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateScore,
  plausibilityBoost,
  buildCandidateFieldMap,
  dedupeCandidates,
  collectContributionFields,
  parseFirstNumber,
  hasKnownFieldValue,
  METHOD_PRIORITY
} from '../src/pipeline/helpers/candidateHelpers.js';

test('parseFirstNumber extracts number from string', () => {
  assert.equal(parseFirstNumber('35000 DPI'), 35000);
  assert.equal(parseFirstNumber('-5.2g'), -5.2);
  assert.equal(parseFirstNumber('no number'), null);
  assert.equal(parseFirstNumber(''), null);
});

test('hasKnownFieldValue rejects unk and empty values', () => {
  assert.ok(!hasKnownFieldValue('unk'));
  assert.ok(!hasKnownFieldValue(''));
  assert.ok(!hasKnownFieldValue('null'));
  assert.ok(!hasKnownFieldValue('undefined'));
  assert.ok(!hasKnownFieldValue('n/a'));
  assert.ok(hasKnownFieldValue('Focus Pro 35K'));
});

test('plausibilityBoost returns positive for in-range weight', () => {
  assert.equal(plausibilityBoost('weight', '55g'), 2);
});

test('plausibilityBoost returns negative for out-of-range weight', () => {
  assert.equal(plausibilityBoost('weight', '500g'), -6);
});

test('plausibilityBoost returns 0 for non-numeric value', () => {
  assert.equal(plausibilityBoost('weight', 'unknown'), 0);
});

test('candidateScore uses method priority and field matching', () => {
  const high = candidateScore({ field: 'sensor', value: 'Focus Pro', method: 'network_json', keyPath: 'data.sensor' });
  const low = candidateScore({ field: 'sensor', value: 'Focus Pro', method: 'dom', keyPath: 'body' });
  assert.ok(high > low);
});

test('METHOD_PRIORITY has expected structure', () => {
  assert.equal(METHOD_PRIORITY.network_json, 5);
  assert.equal(METHOD_PRIORITY.llm_extract, 1);
});

test('buildCandidateFieldMap picks highest scoring candidate per field', () => {
  const candidates = [
    { field: 'sensor', value: 'Focus Pro', method: 'dom', keyPath: 'body' },
    { field: 'sensor', value: 'Focus Pro 35K', method: 'network_json', keyPath: 'data.sensor' }
  ];
  const map = buildCandidateFieldMap(candidates);
  assert.equal(map.sensor, 'Focus Pro 35K');
});

test('buildCandidateFieldMap skips unk values', () => {
  const map = buildCandidateFieldMap([
    { field: 'sensor', value: 'unk', method: 'network_json', keyPath: 'data.sensor' }
  ]);
  assert.equal(map.sensor, undefined);
});

test('dedupeCandidates removes duplicates by field|value|method|keyPath', () => {
  const candidates = [
    { field: 'sensor', value: 'Focus Pro', method: 'dom', keyPath: 'body' },
    { field: 'sensor', value: 'Focus Pro', method: 'dom', keyPath: 'body' },
    { field: 'sensor', value: 'Focus Pro', method: 'network_json', keyPath: 'data' }
  ];
  const result = dedupeCandidates(candidates);
  assert.equal(result.length, 2);
});

test('collectContributionFields identifies llm and component fields', () => {
  const result = collectContributionFields({
    fieldOrder: ['sensor', 'dpi', 'weight'],
    normalized: { fields: { sensor: 'Focus Pro', dpi: '35000', weight: 'unk' } },
    provenance: {
      sensor: { evidence: [{ method: 'llm_extract' }] },
      dpi: { evidence: [{ method: 'component_db' }] },
      weight: { evidence: [] }
    }
  });
  assert.deepStrictEqual(result.llmFields, ['sensor']);
  assert.deepStrictEqual(result.componentFields, ['dpi']);
});
