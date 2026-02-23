import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMinEvidenceRefs,
  sendModeIncludesPrime,
  selectPreferredRouteRow,
  deriveRouteMatrixPolicy,
  resolveRuntimeControlKey,
  resolveIndexingResumeKey,
  defaultRuntimeOverrides,
  normalizeRuntimeOverrides,
  applyRuntimeOverridesToPlanner
} from '../src/pipeline/helpers/runtimeHelpers.js';

// --- parseMinEvidenceRefs ---

test('parseMinEvidenceRefs parses valid integer', () => {
  assert.equal(parseMinEvidenceRefs('3'), 3);
  assert.equal(parseMinEvidenceRefs(5), 5);
});

test('parseMinEvidenceRefs returns minimum of 1', () => {
  assert.equal(parseMinEvidenceRefs('0'), 1);
  assert.equal(parseMinEvidenceRefs('-5'), 1);
});

test('parseMinEvidenceRefs falls back for non-numeric', () => {
  assert.equal(parseMinEvidenceRefs('abc', 2), 2);
  assert.equal(parseMinEvidenceRefs(undefined, 4), 4);
  assert.equal(parseMinEvidenceRefs(null, 1), 1);
});

test('parseMinEvidenceRefs uses default fallback of 1', () => {
  assert.equal(parseMinEvidenceRefs('abc'), 1);
});

// --- sendModeIncludesPrime ---

test('sendModeIncludesPrime returns true when value contains prime', () => {
  assert.equal(sendModeIncludesPrime('scalar value + prime sources'), true);
  assert.equal(sendModeIncludesPrime('PRIME'), true);
  assert.equal(sendModeIncludesPrime('  Prime  '), true);
});

test('sendModeIncludesPrime returns false when value lacks prime', () => {
  assert.equal(sendModeIncludesPrime('scalar value only'), false);
  assert.equal(sendModeIncludesPrime(''), false);
  assert.equal(sendModeIncludesPrime(), false);
});

// --- selectPreferredRouteRow ---

test('selectPreferredRouteRow returns null for empty rows', () => {
  assert.equal(selectPreferredRouteRow([], 'field'), null);
  assert.equal(selectPreferredRouteRow(), null);
});

test('selectPreferredRouteRow filters by scope', () => {
  const rows = [
    { scope: 'field', effort: 2, llm_output_min_evidence_refs_required: 1 },
    { scope: 'component', effort: 3, llm_output_min_evidence_refs_required: 2 }
  ];
  const result = selectPreferredRouteRow(rows, 'field');
  assert.equal(result.effort, 2);
});

test('selectPreferredRouteRow prefers higher effort', () => {
  const rows = [
    { scope: 'field', effort: 1, llm_output_min_evidence_refs_required: 1 },
    { scope: 'field', effort: 5, llm_output_min_evidence_refs_required: 1 }
  ];
  const result = selectPreferredRouteRow(rows, 'field');
  assert.equal(result.effort, 5);
});

test('selectPreferredRouteRow breaks tie by min evidence refs', () => {
  const rows = [
    { scope: 'field', effort: 3, llm_output_min_evidence_refs_required: 1 },
    { scope: 'field', effort: 3, llm_output_min_evidence_refs_required: 4 }
  ];
  const result = selectPreferredRouteRow(rows, 'field');
  assert.equal(result.llm_output_min_evidence_refs_required, 4);
});

// --- deriveRouteMatrixPolicy ---

test('deriveRouteMatrixPolicy returns defaults with no route rows', () => {
  const result = deriveRouteMatrixPolicy();
  assert.equal(result.scalar_linked_send, 'scalar value + prime sources');
  assert.equal(result.component_values_send, 'component values + prime sources');
  assert.equal(result.min_evidence_refs_effective, 1);
  assert.equal(result.prime_sources_visual_send, true);
});

test('deriveRouteMatrixPolicy computes min refs from field rules', () => {
  const result = deriveRouteMatrixPolicy({
    routeRows: [],
    categoryConfig: {
      fieldRules: {
        fields: {
          sensor: { evidence: { min_evidence_refs: 3 } },
          weight: { evidence: { min_evidence_refs: 2 } }
        }
      }
    }
  });
  assert.equal(result.min_evidence_refs_effective, 3);
});

test('deriveRouteMatrixPolicy picks max from route rows and field rules', () => {
  const result = deriveRouteMatrixPolicy({
    routeRows: [
      { scope: 'field', effort: 2, llm_output_min_evidence_refs_required: 5 }
    ],
    categoryConfig: {
      fieldRules: {
        fields: {
          sensor: { evidence: { min_evidence_refs: 2 } }
        }
      }
    }
  });
  assert.equal(result.min_evidence_refs_effective, 5);
});

// --- resolveRuntimeControlKey ---

test('resolveRuntimeControlKey uses default path', () => {
  const storage = { resolveOutputKey: (...args) => args.join('/') };
  const result = resolveRuntimeControlKey(storage, {});
  assert.equal(result, '_runtime/control/runtime_overrides.json');
});

test('resolveRuntimeControlKey uses custom path', () => {
  const storage = { resolveOutputKey: (...args) => args.join('/') };
  const result = resolveRuntimeControlKey(storage, { runtimeControlFile: 'custom/path.json' });
  assert.equal(result, 'custom/path.json');
});

test('resolveRuntimeControlKey passes through fully qualified s3 prefix path', () => {
  const storage = { resolveOutputKey: (...args) => args.join('/') };
  const result = resolveRuntimeControlKey(storage, {
    runtimeControlFile: 'specs/outputs/control.json',
    s3OutputPrefix: 'specs/outputs'
  });
  assert.equal(result, 'specs/outputs/control.json');
});

// --- resolveIndexingResumeKey ---

test('resolveIndexingResumeKey builds correct key', () => {
  const storage = { resolveOutputKey: (...args) => args.join('/') };
  const result = resolveIndexingResumeKey(storage, 'mouse', 'viper-v3');
  assert.equal(result, '_runtime/indexing_resume/mouse/viper-v3.json');
});

// --- defaultRuntimeOverrides ---

test('defaultRuntimeOverrides returns expected shape', () => {
  const d = defaultRuntimeOverrides();
  assert.equal(d.pause, false);
  assert.equal(d.max_urls_per_product, null);
  assert.equal(d.max_queries_per_product, null);
  assert.deepEqual(d.blocked_domains, []);
  assert.deepEqual(d.force_high_fields, []);
  assert.equal(d.disable_llm, false);
  assert.equal(d.disable_search, false);
  assert.equal(d.notes, '');
});

// --- normalizeRuntimeOverrides ---

test('normalizeRuntimeOverrides normalizes valid payload', () => {
  const result = normalizeRuntimeOverrides({
    pause: true,
    max_urls_per_product: '10',
    blocked_domains: ['www.example.com', 'TEST.COM', ''],
    force_high_fields: ['sensor', '', 'weight'],
    disable_llm: 1,
    notes: 'test note'
  });
  assert.equal(result.pause, true);
  assert.equal(result.max_urls_per_product, 10);
  assert.deepEqual(result.blocked_domains, ['example.com', 'test.com']);
  assert.deepEqual(result.force_high_fields, ['sensor', 'weight']);
  assert.equal(result.disable_llm, true);
  assert.equal(result.notes, 'test note');
});

test('normalizeRuntimeOverrides handles null/empty input', () => {
  const result = normalizeRuntimeOverrides();
  assert.equal(result.pause, false);
  assert.equal(result.max_urls_per_product, null);
  assert.deepEqual(result.blocked_domains, []);
});

test('normalizeRuntimeOverrides deduplicates blocked domains', () => {
  const result = normalizeRuntimeOverrides({
    blocked_domains: ['example.com', 'www.example.com', 'example.com']
  });
  assert.deepEqual(result.blocked_domains, ['example.com']);
});

// --- applyRuntimeOverridesToPlanner ---

test('applyRuntimeOverridesToPlanner sets maxUrls', () => {
  const planner = { maxUrls: 100, blockHost: () => {} };
  applyRuntimeOverridesToPlanner(planner, { max_urls_per_product: 50 });
  assert.equal(planner.maxUrls, 50);
});

test('applyRuntimeOverridesToPlanner calls blockHost for each domain', () => {
  const blocked = [];
  const planner = { blockHost: (host, reason) => blocked.push({ host, reason }) };
  applyRuntimeOverridesToPlanner(planner, { blocked_domains: ['a.com', 'b.com'] });
  assert.equal(blocked.length, 2);
  assert.equal(blocked[0].host, 'a.com');
  assert.equal(blocked[1].reason, 'runtime_override_blocked_domain');
});

test('applyRuntimeOverridesToPlanner does nothing for null planner', () => {
  applyRuntimeOverridesToPlanner(null, { max_urls_per_product: 10 });
  applyRuntimeOverridesToPlanner(undefined, {});
});
