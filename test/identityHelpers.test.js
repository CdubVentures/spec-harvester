import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunIdentityFingerprint,
  bestIdentityFromSources,
  isIdentityLockedField,
  helperSupportsProvisionalFill,
  deriveNeedSetIdentityState,
  resolveExtractionGateOpen,
  buildNeedSetIdentityAuditRows
} from '../src/pipeline/helpers/identityHelpers.js';

// --- isIdentityLockedField ---

test('isIdentityLockedField returns true for identity fields', () => {
  assert.equal(isIdentityLockedField('id'), true);
  assert.equal(isIdentityLockedField('brand'), true);
  assert.equal(isIdentityLockedField('model'), true);
  assert.equal(isIdentityLockedField('base_model'), true);
  assert.equal(isIdentityLockedField('category'), true);
  assert.equal(isIdentityLockedField('sku'), true);
});

test('isIdentityLockedField returns false for non-identity fields', () => {
  assert.equal(isIdentityLockedField('weight'), false);
  assert.equal(isIdentityLockedField('sensor'), false);
  assert.equal(isIdentityLockedField('dpi'), false);
  assert.equal(isIdentityLockedField(''), false);
});

// --- buildRunIdentityFingerprint ---

test('buildRunIdentityFingerprint produces sha256-prefixed deterministic hash', () => {
  const result = buildRunIdentityFingerprint({
    category: 'mouse',
    productId: 'viper-v3-pro',
    identityLock: { brand: 'Razer', model: 'Viper V3 Pro' }
  });
  assert.ok(result.startsWith('sha256:'));
  assert.equal(result.length, 7 + 64);
});

test('buildRunIdentityFingerprint is deterministic for same input', () => {
  const args = { category: 'mouse', productId: 'test', identityLock: { brand: 'A', model: 'B' } };
  assert.equal(buildRunIdentityFingerprint(args), buildRunIdentityFingerprint(args));
});

test('buildRunIdentityFingerprint differs for different inputs', () => {
  const a = buildRunIdentityFingerprint({ category: 'mouse', productId: 'a' });
  const b = buildRunIdentityFingerprint({ category: 'mouse', productId: 'b' });
  assert.notEqual(a, b);
});

test('buildRunIdentityFingerprint handles empty input', () => {
  const result = buildRunIdentityFingerprint();
  assert.ok(result.startsWith('sha256:'));
});

// --- bestIdentityFromSources ---

test('bestIdentityFromSources prefers identity-matched sources', () => {
  const sources = [
    { identity: { match: false, score: 0.9 }, identityCandidates: { brand: 'Wrong' }, tier: 1 },
    { identity: { match: true, score: 0.8 }, identityCandidates: { brand: 'Correct' }, tier: 2 }
  ];
  const result = bestIdentityFromSources(sources);
  assert.equal(result.brand, 'Correct');
});

test('bestIdentityFromSources sorts by identity score when match is equal', () => {
  const sources = [
    { identity: { match: true, score: 0.7 }, identityCandidates: { brand: 'Low' }, tier: 1 },
    { identity: { match: true, score: 0.9 }, identityCandidates: { brand: 'High' }, tier: 2 }
  ];
  const result = bestIdentityFromSources(sources);
  assert.equal(result.brand, 'High');
});

test('bestIdentityFromSources falls back to tier when scores equal', () => {
  const sources = [
    { identity: { match: true, score: 0.8 }, identityCandidates: { brand: 'Tier3' }, tier: 3 },
    { identity: { match: true, score: 0.8 }, identityCandidates: { brand: 'Tier1' }, tier: 1 }
  ];
  const result = bestIdentityFromSources(sources);
  assert.equal(result.brand, 'Tier1');
});

test('bestIdentityFromSources returns empty object for empty input', () => {
  assert.deepEqual(bestIdentityFromSources([]), {});
  assert.deepEqual(bestIdentityFromSources(null), {});
});

test('bestIdentityFromSources prefers variant match with identityLock', () => {
  const sources = [
    { identity: { match: true, score: 0.8 }, identityCandidates: { brand: 'R', variant: 'Black' }, tier: 1 },
    { identity: { match: true, score: 0.8 }, identityCandidates: { brand: 'R', variant: 'White' }, tier: 1 }
  ];
  const result = bestIdentityFromSources(sources, { variant: 'White' });
  assert.equal(result.variant, 'White');
});

// --- helperSupportsProvisionalFill ---

test('helperSupportsProvisionalFill returns false when no top match', () => {
  assert.equal(helperSupportsProvisionalFill({}, { brand: 'Razer', model: 'Viper' }), false);
  assert.equal(helperSupportsProvisionalFill(null, { brand: 'Razer', model: 'Viper' }), false);
});

test('helperSupportsProvisionalFill returns false when identityLock missing brand/model', () => {
  const ctx = { supportive_matches: [{ brand: 'Razer', model: 'Viper' }] };
  assert.equal(helperSupportsProvisionalFill(ctx, {}), false);
  assert.equal(helperSupportsProvisionalFill(ctx, { brand: 'Razer' }), false);
});

test('helperSupportsProvisionalFill returns true when brand+model match and no variant constraint', () => {
  const ctx = { supportive_matches: [{ brand: 'Razer', model: 'Viper' }] };
  assert.equal(helperSupportsProvisionalFill(ctx, { brand: 'Razer', model: 'Viper' }), true);
});

test('helperSupportsProvisionalFill returns false when brand mismatch', () => {
  const ctx = { supportive_matches: [{ brand: 'Logitech', model: 'Viper' }] };
  assert.equal(helperSupportsProvisionalFill(ctx, { brand: 'Razer', model: 'Viper' }), false);
});

test('helperSupportsProvisionalFill checks variant overlap', () => {
  const ctx = { supportive_matches: [{ brand: 'Razer', model: 'Viper', variant: 'Pro Wireless' }] };
  assert.equal(helperSupportsProvisionalFill(ctx, { brand: 'Razer', model: 'Viper', variant: 'Pro' }), true);
});

test('helperSupportsProvisionalFill uses active_match fallback', () => {
  const ctx = { active_match: { brand: 'Razer', model: 'Viper' } };
  assert.equal(helperSupportsProvisionalFill(ctx, { brand: 'Razer', model: 'Viper' }), true);
});

// --- deriveNeedSetIdentityState ---

test('deriveNeedSetIdentityState returns locked when validated and high confidence', () => {
  assert.equal(deriveNeedSetIdentityState({ identityGate: { validated: true }, identityConfidence: 0.95 }), 'locked');
  assert.equal(deriveNeedSetIdentityState({ identityGate: { validated: true }, identityConfidence: 1.0 }), 'locked');
});

test('deriveNeedSetIdentityState returns conflict when reason codes include conflict', () => {
  assert.equal(deriveNeedSetIdentityState({
    identityGate: { reasonCodes: ['brand_conflict'] },
    identityConfidence: 0.5
  }), 'conflict');
});

test('deriveNeedSetIdentityState returns conflict on IDENTITY_CONFLICT status', () => {
  assert.equal(deriveNeedSetIdentityState({
    identityGate: { status: 'IDENTITY_CONFLICT' },
    identityConfidence: 0.5
  }), 'conflict');
});

test('deriveNeedSetIdentityState returns provisional at 0.70+ confidence', () => {
  assert.equal(deriveNeedSetIdentityState({
    identityGate: {},
    identityConfidence: 0.70
  }), 'provisional');
  assert.equal(deriveNeedSetIdentityState({
    identityGate: {},
    identityConfidence: 0.85
  }), 'provisional');
});

test('deriveNeedSetIdentityState returns unlocked below 0.70', () => {
  assert.equal(deriveNeedSetIdentityState({
    identityGate: {},
    identityConfidence: 0.5
  }), 'unlocked');
  assert.equal(deriveNeedSetIdentityState(), 'unlocked');
});

// --- resolveExtractionGateOpen ---

test('resolveExtractionGateOpen returns true when validated', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B' },
    identityGate: { validated: true }
  }), true);
});

test('resolveExtractionGateOpen returns false on hard conflict', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B' },
    identityGate: { reasonCodes: ['brand_conflict'] }
  }), false);
});

test('resolveExtractionGateOpen returns false on IDENTITY_CONFLICT status', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B' },
    identityGate: { status: 'IDENTITY_CONFLICT' }
  }), false);
});

test('resolveExtractionGateOpen returns false when variant is present but not validated', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B', variant: 'C' },
    identityGate: {}
  }), false);
});

test('resolveExtractionGateOpen returns false for hard ambiguity level', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B', ambiguity_level: 'hard' },
    identityGate: {}
  }), false);
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'A', model: 'B', ambiguity_level: 'very_hard' },
    identityGate: {}
  }), false);
});

test('resolveExtractionGateOpen returns true for easy ambiguity with brand+model', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'Razer', model: 'Viper', ambiguity_level: 'easy' },
    identityGate: {}
  }), true);
});

test('resolveExtractionGateOpen returns false when brand or model missing', () => {
  assert.equal(resolveExtractionGateOpen({
    identityLock: { brand: 'Razer' },
    identityGate: {}
  }), false);
});

// --- buildNeedSetIdentityAuditRows ---

test('buildNeedSetIdentityAuditRows maps pages to audit rows', () => {
  const report = {
    pages: [
      { source_id: 's1', url: 'https://example.com', decision: 'accept', confidence: 0.9, reason_codes: ['ok'] },
      { source_id: 's2', url: 'https://example.org', decision: 'reject', confidence: 0.3, reason_codes: ['mismatch'] }
    ]
  };
  const rows = buildNeedSetIdentityAuditRows(report);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source_id, 's1');
  assert.equal(rows[0].decision, 'ACCEPT');
  assert.equal(rows[0].confidence, 0.9);
  assert.equal(rows[1].decision, 'REJECT');
});

test('buildNeedSetIdentityAuditRows respects limit', () => {
  const report = {
    pages: Array.from({ length: 50 }, (_, i) => ({ source_id: `s${i}`, url: `https://${i}.com` }))
  };
  const rows = buildNeedSetIdentityAuditRows(report, 5);
  assert.equal(rows.length, 5);
});

test('buildNeedSetIdentityAuditRows filters rows without source_id or url', () => {
  const report = { pages: [{ decision: 'accept' }, { source_id: 'x', decision: 'ok' }] };
  const rows = buildNeedSetIdentityAuditRows(report);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_id, 'x');
});

test('buildNeedSetIdentityAuditRows handles empty or missing report', () => {
  assert.deepEqual(buildNeedSetIdentityAuditRows(), []);
  assert.deepEqual(buildNeedSetIdentityAuditRows({}), []);
  assert.deepEqual(buildNeedSetIdentityAuditRows({ pages: [] }), []);
});
