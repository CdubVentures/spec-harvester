import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainFieldMatrix, findFieldCoverageGaps } from '../src/intel/domainFieldMatrix.js';

// ---------------------------------------------------------------------------
// IP04-4A — Domain x Field Matrix Tests
// ---------------------------------------------------------------------------

const SAMPLE_DOMAINS = {
  'rtings.com': {
    rootDomain: 'rtings.com',
    planner_score: 0.92,
    attempts: 50,
    identity_match_rate: 0.95,
    field_rewards: {
      'weight::extract': { accepted: 40, attempted: 45, score: 0.88 },
      'sensor::extract': { accepted: 35, attempted: 45, score: 0.78 },
      'dpi::extract': { accepted: 30, attempted: 45, score: 0.67 }
    }
  },
  'razer.com': {
    rootDomain: 'razer.com',
    planner_score: 0.85,
    attempts: 20,
    identity_match_rate: 0.99,
    field_rewards: {
      'weight::extract': { accepted: 15, attempted: 18, score: 0.83 },
      'polling_rate::extract': { accepted: 18, attempted: 20, score: 0.90 }
    }
  }
};

test('matrix: builds domain x field matrix from source intel', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  assert.equal(result.domain_count, 2);
  assert.ok(result.matrix['rtings.com']);
  assert.ok(result.matrix['razer.com']);
  assert.ok(result.matrix['rtings.com']['weight']);
  assert.equal(result.matrix['rtings.com']['weight'].accepted, 40);
});

test('matrix: computes yield rates per domain-field', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  const wr = result.matrix['rtings.com']['weight'];
  assert.ok(wr.yield_rate > 0.8);
  assert.ok(wr.yield_rate <= 1.0);
});

test('matrix: domain summary aggregates field counts', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  assert.equal(result.domain_summary['rtings.com'].fields_contributed, 3);
  assert.equal(result.domain_summary['razer.com'].fields_contributed, 2);
});

test('matrix: field summary tracks contributing domains', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  assert.equal(result.field_summary['weight'].domains_contributing, 2);
  assert.equal(result.field_summary['polling_rate'].domains_contributing, 1);
});

test('matrix: top domains per field sorted by yield rate', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  const topWeight = result.top_domains_per_field['weight'];
  assert.ok(topWeight.length >= 2);
  assert.ok(topWeight[0].yield_rate >= topWeight[1].yield_rate);
});

test('matrix: handles empty domains', () => {
  const result = buildDomainFieldMatrix({ domains: {} });
  assert.equal(result.domain_count, 0);
  assert.equal(result.field_count, 0);
});

test('matrix: respects fieldOrder for top_domains_per_field', () => {
  const result = buildDomainFieldMatrix({
    domains: SAMPLE_DOMAINS,
    fieldOrder: ['weight', 'sensor']
  });
  assert.ok(result.top_domains_per_field['weight']);
  assert.ok(result.top_domains_per_field['sensor']);
});

test('coverage gaps: finds fields with no contributing domains', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  const gaps = findFieldCoverageGaps({
    fieldSummary: result.field_summary,
    fieldOrder: ['weight', 'sensor', 'battery_life', 'switches']
  });
  assert.equal(gaps.total_gaps, 2); // battery_life and switches have no data
  assert.ok(gaps.gaps.some((g) => g.field === 'battery_life'));
});

test('coverage gaps: flags single-source dependencies', () => {
  const result = buildDomainFieldMatrix({ domains: SAMPLE_DOMAINS });
  const gaps = findFieldCoverageGaps({ fieldSummary: result.field_summary });
  assert.ok(gaps.weak.some((w) => w.field === 'polling_rate' && w.reason === 'single_source_dependency'));
});
