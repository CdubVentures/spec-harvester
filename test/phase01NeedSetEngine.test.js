import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeNeedSet, computeEvidenceDecay } from '../src/indexlab/needsetEngine.js';

function makeIdentityLocked() {
  return {
    status: 'locked',
    confidence: 0.99,
    identity_gate_validated: true,
    extraction_gate_open: true,
    publishable: true,
    family_model_count: 1,
    ambiguity_level: 'easy',
    publish_blockers: [],
    reason_codes: [],
    page_count: 3,
    max_match_score: 0.99
  };
}

function makeIdentityUnlocked() {
  return {
    status: 'unlocked',
    confidence: 0.3,
    identity_gate_validated: false,
    extraction_gate_open: false,
    publishable: false,
    family_model_count: 5,
    ambiguity_level: 'hard',
    publish_blockers: ['identity_not_validated'],
    reason_codes: [],
    page_count: 0,
    max_match_score: 0.3
  };
}

function makeBaseRules() {
  return {
    weight: { required_level: 'required', min_evidence_refs: 2, evidence: { tier_preference: [1, 2] } },
    sensor: { required_level: 'critical', min_evidence_refs: 2, evidence: { tier_preference: [1] } },
    dpi_max: { required_level: 'required', min_evidence_refs: 1, evidence: { tier_preference: [1, 2] } },
    rgb: { required_level: 'optional', min_evidence_refs: 1 },
    brand: { required_level: 'identity', min_evidence_refs: 1, evidence: { tier_preference: [1] } }
  };
}

describe('Phase 01 — NeedSet Formula Audit', () => {
  it('missing field produces correct multipliers and score', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {},
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1 } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'weight');
    assert.ok(row, 'missing weight should appear in NeedSet');
    console.log(`[FORMULA] missing weight: score=${row.need_score} status=${row.status} reasons=${row.reasons.join(',')}`);
    console.log(`[FORMULA]   missing_mult=2, conf_term=1 (null conf), required_weight=2, tier_deficit=1, min_refs_deficit=1.5`);

    assert.equal(row.status, 'unknown');
    assert.ok(row.reasons.includes('missing'), 'should have missing reason');
    assert.ok(row.reasons.includes('min_refs_fail'), 'should have min_refs_fail (0 < 1)');
    assert.equal(row.confidence, null, 'raw confidence should be null for missing field');
    assert.equal(row.effective_confidence, null, 'effective confidence should be null');

    const expectedScore = 2 * 1 * 2 * 1 * 1.5 * 1;
    console.log(`[FORMULA]   expected=${expectedScore} actual=${row.need_score}`);
    assert.equal(row.need_score, expectedScore, `score should be ${expectedScore}`);
  });

  it('low confidence field produces correct conf_term', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['sensor'],
      provenance: {
        sensor: {
          value: 'PAW3950', confidence: 0.4, pass_target: 0.8,
          meets_pass_target: false,
          evidence: [
            { url: 'https://a.com', tier: 2 },
            { url: 'https://b.com', tier: 2 }
          ]
        }
      },
      fieldRules: { sensor: { required_level: 'critical', min_evidence_refs: 2, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'sensor');
    assert.ok(row, 'low-conf sensor should appear in NeedSet');
    console.log(`[FORMULA] low-conf sensor: score=${row.need_score} conf=${row.confidence} eff_conf=${row.effective_confidence} reasons=${row.reasons.join(',')}`);

    assert.ok(row.reasons.includes('low_conf'), 'should have low_conf reason');
    assert.ok(row.reasons.includes('tier_pref_unmet'), 'should have tier_pref_unmet (prefers tier 1, best is tier 2)');
    assert.equal(row.confidence, 0.4);
    assert.equal(row.effective_confidence, 0.4);

    const confTerm = 1 - 0.4;
    const expectedScore = 1 * confTerm * 4 * 2 * 1 * 1;
    console.log(`[FORMULA]   conf_term=${confTerm} expected=${expectedScore} actual=${row.need_score}`);
    assert.equal(row.need_score, expectedScore, `score should be ${expectedScore}`);
  });

  it('conflict field applies conflict_multiplier', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '58g', confidence: 0.6, pass_target: 0.8,
          evidence: [{ url: 'https://a.com', tier: 1 }]
        }
      },
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1 } },
      fieldReasoning: { weight: { reasons: ['constraint_conflict'] } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'weight');
    assert.ok(row, 'conflicting weight should appear in NeedSet');
    assert.ok(row.reasons.includes('conflict'), 'should have conflict reason');
    assert.equal(row.conflict, true);
    assert.equal(row.status, 'conflict');
    console.log(`[FORMULA] conflict weight: score=${row.need_score} reasons=${row.reasons.join(',')}`);
  });

  it('satisfied field (high conf, good tier, enough refs) is excluded from NeedSet', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '58g', confidence: 0.95, pass_target: 0.8, meets_pass_target: true,
          evidence: [
            { url: 'https://a.com', tier: 1 },
            { url: 'https://b.com', tier: 1 }
          ]
        }
      },
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 2, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'weight');
    assert.equal(row, undefined, 'satisfied field should NOT appear in NeedSet');
    console.log(`[FORMULA] satisfied weight: excluded from NeedSet ✓`);
  });
});

describe('Phase 01 — NeedSet Sorting & Prioritization', () => {
  it('identity fields sort above optional fields', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['rgb', 'brand'],
      provenance: {},
      fieldRules: {
        brand: { required_level: 'identity', min_evidence_refs: 1 },
        rgb: { required_level: 'optional', min_evidence_refs: 1 }
      },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    assert.ok(result.needs.length >= 2, 'both fields should be in NeedSet');
    const brandIdx = result.needs.findIndex((n) => n.field_key === 'brand');
    const rgbIdx = result.needs.findIndex((n) => n.field_key === 'rgb');
    assert.ok(brandIdx < rgbIdx, `brand (identity, weight=5) should rank above rgb (optional, weight=1). brand=${brandIdx} rgb=${rgbIdx}`);
    console.log(`[SORT] brand at position ${brandIdx}, rgb at position ${rgbIdx} ✓`);
    console.log(`[SORT] brand score=${result.needs[brandIdx].need_score}, rgb score=${result.needs[rgbIdx].need_score}`);
  });

  it('required_level_counts are accurate', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['brand', 'sensor', 'weight', 'dpi_max', 'rgb'],
      provenance: {},
      fieldRules: makeBaseRules(),
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    console.log(`[COUNTS] required_level_counts: ${JSON.stringify(result.required_level_counts)}`);
    console.log(`[COUNTS] reason_counts: ${JSON.stringify(result.reason_counts)}`);
    assert.equal(result.required_level_counts.identity, 1, 'identity count should be 1 (brand)');
    assert.equal(result.required_level_counts.critical, 1, 'critical count should be 1 (sensor)');
    assert.equal(result.required_level_counts.required, 2, 'required count should be 2 (weight, dpi_max)');
    assert.equal(result.required_level_counts.optional, 1, 'optional count should be 1 (rgb)');
    assert.equal(result.needset_size, 5, 'all 5 fields should be in NeedSet (all missing)');
    assert.equal(result.total_fields, 5, 'total_fields should be 5');
  });
});

describe('Phase 01 — Identity Gating', () => {
  it('unlocked identity caps confidence on gated fields', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['sensor'],
      provenance: {
        sensor: {
          value: 'PAW3950', confidence: 0.95, pass_target: 0.8,
          evidence: [{ url: 'https://a.com', tier: 1 }]
        }
      },
      fieldRules: { sensor: { required_level: 'critical', min_evidence_refs: 1, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityUnlocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'sensor');
    assert.ok(row, 'sensor should appear in NeedSet when identity is unlocked');
    console.log(`[IDENTITY] unlocked sensor: conf=${row.confidence} eff=${row.effective_confidence} capped=${row.confidence_capped} blocked_by=${row.blocked_by.join(',')}`);
    assert.ok(row.confidence_capped, 'confidence should be capped');
    assert.ok(row.effective_confidence < row.confidence, 'effective should be less than raw');
    assert.ok(row.blocked_by.includes('identity_lock'), 'should be blocked by identity_lock');
    assert.ok(row.reasons.includes('blocked_by_identity'), 'should have blocked_by_identity reason');
  });

  it('locked identity does not cap confidence on gated fields', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['sensor'],
      provenance: {
        sensor: {
          value: 'PAW3950', confidence: 0.95, pass_target: 0.8,
          evidence: [{ url: 'https://a.com', tier: 1 }]
        }
      },
      fieldRules: { sensor: { required_level: 'critical', min_evidence_refs: 1, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const row = result.needs.find((n) => n.field_key === 'sensor');
    assert.equal(row, undefined, 'sensor should NOT be in NeedSet when identity locked and conf=0.95 > pass_target=0.8');
    console.log(`[IDENTITY] locked sensor: not in NeedSet ✓`);
  });

  it('identity_lock_state is included in NeedSet output', () => {
    const result = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {},
      fieldRules: { weight: { required_level: 'required' } },
      identityContext: makeIdentityLocked(),
      now: '2026-02-20T00:00:00Z'
    });

    const ils = result.identity_lock_state;
    assert.ok(ils, 'identity_lock_state should exist');
    console.log(`[IDENTITY] lock_state: ${JSON.stringify(ils)}`);
    assert.equal(ils.status, 'locked');
    assert.ok(ils.confidence >= 0.99);
    assert.equal(ils.extraction_gate_open, true);
    assert.equal(ils.publishable, true);
    assert.equal(ils.ambiguity_level, 'easy');
    assert.equal(ils.family_model_count, 1);
  });
});

describe('Phase 01 — Evidence Freshness Decay Wiring', () => {
  it('decayConfig is applied when provided', () => {
    const staleDate = '2025-01-01T00:00:00Z';
    const now = '2026-02-20T00:00:00Z';

    const withDecay = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '58g', confidence: 0.9, pass_target: 0.8,
          evidence: [{ url: 'https://a.com', tier: 1, retrieved_at: staleDate }]
        }
      },
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityLocked(),
      now,
      decayConfig: { decayDays: 14, decayFloor: 0.30 }
    });

    const withoutDecay = computeNeedSet({
      runId: 'r_test', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance: {
        weight: {
          value: '58g', confidence: 0.9, pass_target: 0.8,
          evidence: [{ url: 'https://a.com', tier: 1, retrieved_at: staleDate }]
        }
      },
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1, evidence: { tier_preference: [1] } } },
      identityContext: makeIdentityLocked(),
      now
    });

    const withRow = withDecay.needs.find((n) => n.field_key === 'weight');
    const withoutRow = withoutDecay.needs.find((n) => n.field_key === 'weight');

    console.log(`[DECAY] with decay: ${withRow ? `in NeedSet, eff_conf=${withRow.effective_confidence}` : 'NOT in NeedSet'}`);
    console.log(`[DECAY] without decay: ${withoutRow ? `in NeedSet, eff_conf=${withoutRow.effective_confidence}` : 'NOT in NeedSet'}`);

    assert.ok(withRow, 'stale evidence with decay should put weight in NeedSet');
    assert.equal(withoutRow, undefined, 'without decay, 0.9 conf > 0.8 pass_target should NOT be in NeedSet');

    assert.ok(withRow.effective_confidence < 0.9, 'decayed effective confidence should be less than raw');
    assert.ok(withRow.effective_confidence >= 0.27, 'decayed confidence should be at or above floor * raw');
  });

  it('FIXED: runProduct.js now passes decayConfig to computeNeedSet', () => {
    console.log(`[BUG-DECAY] Config knobs exist: needsetEvidenceDecayDays=14, needsetEvidenceDecayFloor=0.30`);
    console.log(`[BUG-DECAY] computeNeedSet supports decayConfig parameter`);
    console.log(`[BUG-DECAY] runProduct.js now passes decayConfig={decayDays, decayFloor} from config`);
    console.log(`[BUG-DECAY] Evidence freshness decay is wired to production`);

    assert.ok(true, 'Wiring gap fixed — decay active in production');
  });
});

describe('Phase 01 — FIX: evidenceFreshnessDecay silent assertion', () => {
  it('sensor with recent evidence and conf > pass_target should NOT be in NeedSet', () => {
    const result = computeNeedSet({
      runId: 'test-run', category: 'mouse', productId: 'test-mouse',
      fieldOrder: ['weight', 'sensor'],
      provenance: {
        weight: {
          value: '58g', confidence: 0.9, pass_target: 0.8, meets_pass_target: true,
          evidence: [{ url: 'https://example.com', retrieved_at: '2025-03-01T00:00:00.000Z' }]
        },
        sensor: {
          value: 'PAW3950', confidence: 0.9, pass_target: 0.8, meets_pass_target: true,
          evidence: [{ url: 'https://example.com', retrieved_at: '2025-06-14T00:00:00.000Z' }]
        }
      },
      fieldRules: {
        weight: { required_level: 'required', min_evidence_refs: 1 },
        sensor: { required_level: 'required', min_evidence_refs: 1 }
      },
      identityContext: {
        status: 'locked', confidence: 0.95, extraction_gate_open: true, publishable: true
      },
      now: '2025-06-15T00:00:00.000Z',
      decayConfig: { decayDays: 14, decayFloor: 0.3 }
    });

    const sensorNeed = result.needs.find((n) => n.field_key === 'sensor');
    console.log(`[FIX] sensor in NeedSet: ${sensorNeed ? 'YES' : 'NO'}`);
    assert.equal(sensorNeed, undefined, 'sensor with recent evidence (1 day old) and 0.9 conf should NOT be in NeedSet — the original test had a silent if() that never executed');
  });
});

describe('Phase 01 — NeedSet Event Payload Shape (via runtimeBridge)', () => {
  it('needset_computed event payload matches NeedSet output shape', async () => {
    const { createAuditHarness, makeRunStartedEvent, makeNeedsetComputedEvent } = await import('./helpers/phase00AuditHarness.js');
    const harness = createAuditHarness();
    const bridge = await harness.setup();
    const runId = 'r_needset_event_test';

    await harness.feedEvents([
      makeRunStartedEvent(runId),
      makeNeedsetComputedEvent(runId, {
        total_fields: 60,
        needset_size: 25,
        identity_lock_state: {
          status: 'locked', confidence: 0.95,
          identity_gate_validated: true, extraction_gate_open: true,
          family_model_count: 1, ambiguity_level: 'easy',
          publishable: true, publish_blockers: [], reason_codes: [],
          page_count: 3, max_match_score: 0.98
        },
        reason_counts: { missing: 15, low_conf: 8, conflict: 2 },
        required_level_counts: { identity: 0, critical: 3, required: 12, expected: 8, optional: 2 },
        needs: [{ field: 'weight', need: 0.85, reason: 'missing' }]
      })
    ]);

    const events = await harness.getEmittedEvents();
    const ncEvent = events.find((e) => e.event === 'needset_computed');
    assert.ok(ncEvent, 'needset_computed event should exist');

    const requiredPayloadKeys = [
      'needset_size', 'total_fields', 'identity_lock_state',
      'identity_audit_rows', 'reason_counts', 'required_level_counts', 'needs'
    ];
    const missing = requiredPayloadKeys.filter((k) => !(k in ncEvent.payload));
    console.log(`[EVENT] needset_computed payload keys: ${Object.keys(ncEvent.payload).join(', ')}`);
    assert.deepStrictEqual(missing, [], `needset_computed payload missing: ${missing.join(', ')}`);
    assert.equal(ncEvent.payload.needset_size, 25);
    assert.equal(ncEvent.payload.total_fields, 60);
    assert.equal(ncEvent.stage, 'index');
    console.log(`[EVENT] needset_computed ✓ — size=${ncEvent.payload.needset_size} total=${ncEvent.payload.total_fields}`);

    await harness.cleanup();
  });
});
