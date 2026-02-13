import test from 'node:test';
import assert from 'node:assert/strict';
import { CandidateMerger } from '../src/scoring/candidateMerger.js';

function buildEngineStub() {
  return {
    getFieldRule(field) {
      if (field === 'weight') {
        return { data_type: 'number' };
      }
      if (field === 'sensor_latency') {
        return { source_dependent: true, data_type: 'number' };
      }
      return {};
    }
  };
}

function c(field, value, patch = {}) {
  return {
    field,
    value,
    method: 'llm_extract',
    source: {
      tier: 'tier2_lab',
      url: 'https://lab.example'
    },
    confidence: 0.8,
    ...patch
  };
}

test('CandidateMerger marks unanimous agreement when all values match', () => {
  const merger = new CandidateMerger(buildEngineStub());
  const merged = merger.mergeCandidates({
    deterministicCandidates: [c('dpi', '32000', { method: 'spec_table_match' })],
    llmCandidates: [c('dpi', '32000')],
    componentCandidates: []
  });
  assert.equal(merged.byField.dpi.agreement, 'unanimous');
  assert.equal(merged.byField.dpi.value, '32000');
});

test('CandidateMerger resolves numeric conflicts within tolerance', () => {
  const merger = new CandidateMerger(buildEngineStub());
  const merged = merger.mergeCandidates({
    deterministicCandidates: [c('weight', '60', { method: 'spec_table_match' })],
    llmCandidates: [c('weight', '62')],
    componentCandidates: []
  });
  assert.equal(merged.byField.weight.agreement, 'within_tolerance');
});

test('CandidateMerger preserves source-dependent conflicts for review', () => {
  const merger = new CandidateMerger(buildEngineStub());
  const merged = merger.mergeCandidates({
    deterministicCandidates: [c('sensor_latency', '1.2')],
    llmCandidates: [c('sensor_latency', '2.0')],
    componentCandidates: []
  });
  assert.equal(merged.byField.sensor_latency.agreement, 'source_dependent');
  assert.equal(merged.byField.sensor_latency.needs_review, true);
});

test('CandidateMerger marks unresolved close-score conflicts for human review', () => {
  const merger = new CandidateMerger(buildEngineStub());
  const merged = merger.mergeCandidates({
    deterministicCandidates: [c('connection', 'wired', { confidence: 0.7 })],
    llmCandidates: [c('connection', 'wireless', { confidence: 0.69 })],
    componentCandidates: []
  });
  assert.equal(merged.byField.connection.agreement, 'conflict');
  assert.equal(merged.byField.connection.needs_review, true);
});

