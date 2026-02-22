import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyProvenance,
  ensureProvenanceField,
  mergePhase08Rows,
  buildPhase08SummaryFromBatches,
  tsvRowFromFields
} from '../src/pipeline/helpers/provenanceHelpers.js';

test('createEmptyProvenance creates entries for all fields', () => {
  const result = createEmptyProvenance(['sensor', 'dpi'], { sensor: 'Focus Pro', dpi: '35000' });
  assert.equal(result.sensor.value, 'Focus Pro');
  assert.equal(result.dpi.value, '35000');
  assert.equal(result.sensor.confirmations, 0);
  assert.deepStrictEqual(result.sensor.evidence, []);
});

test('ensureProvenanceField creates missing field entry', () => {
  const prov = {};
  const result = ensureProvenanceField(prov, 'sensor', 'unk');
  assert.equal(result.value, 'unk');
  assert.equal(prov.sensor.pass_target, 1);
});

test('ensureProvenanceField returns existing field entry', () => {
  const prov = { sensor: { value: 'Focus Pro', confirmations: 3, evidence: [] } };
  const result = ensureProvenanceField(prov, 'sensor');
  assert.equal(result.value, 'Focus Pro');
  assert.equal(result.confirmations, 3);
});

test('mergePhase08Rows deduplicates by field_key|snippet_id|url', () => {
  const existing = [{ field_key: 'sensor', snippet_id: 's1', url: 'https://a.com' }];
  const incoming = [
    { field_key: 'sensor', snippet_id: 's1', url: 'https://a.com' },
    { field_key: 'dpi', snippet_id: 's2', url: 'https://b.com' }
  ];
  const result = mergePhase08Rows(existing, incoming);
  assert.equal(result.length, 2);
});

test('mergePhase08Rows respects maxRows', () => {
  const existing = [{ field_key: 'a', snippet_id: '1', url: 'u1' }];
  const incoming = [
    { field_key: 'b', snippet_id: '2', url: 'u2' },
    { field_key: 'c', snippet_id: '3', url: 'u3' }
  ];
  const result = mergePhase08Rows(existing, incoming, 2);
  assert.equal(result.length, 2);
});

test('buildPhase08SummaryFromBatches computes statistics', () => {
  const rows = [
    { status: 'ok', raw_candidate_count: 10, accepted_candidate_count: 8, dropped_invalid_refs: 1, dropped_missing_refs: 0, dropped_evidence_verifier: 0, min_refs_satisfied_count: 5, min_refs_total: 8 },
    { status: 'failed', raw_candidate_count: 5, accepted_candidate_count: 0, dropped_invalid_refs: 2, dropped_missing_refs: 1, dropped_evidence_verifier: 0, min_refs_satisfied_count: 0, min_refs_total: 3 }
  ];
  const result = buildPhase08SummaryFromBatches(rows);
  assert.equal(result.batch_count, 2);
  assert.equal(result.batch_error_count, 1);
  assert.equal(result.raw_candidate_count, 15);
  assert.equal(result.accepted_candidate_count, 8);
});

test('buildPhase08SummaryFromBatches handles empty input', () => {
  const result = buildPhase08SummaryFromBatches([]);
  assert.equal(result.batch_count, 0);
  assert.equal(result.schema_fail_rate, 0);
});

test('tsvRowFromFields joins field values with tab', () => {
  const result = tsvRowFromFields(['sensor', 'dpi', 'weight'], { sensor: 'Focus Pro', dpi: '35000' });
  assert.equal(result, 'Focus Pro\t35000\tunk');
});
