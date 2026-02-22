import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeEvidenceDecay, computeNeedSet } from '../src/indexlab/needsetEngine.js';

describe('computeEvidenceDecay', () => {
  it('returns 1.0 for same-day evidence', () => {
    const now = '2025-06-15T12:00:00.000Z';
    const result = computeEvidenceDecay({
      retrievedAt: '2025-06-15T10:00:00.000Z',
      now,
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.ok(result > 0.99);
    assert.ok(result <= 1.0);
  });

  it('returns ~0.5 at half-life (decayDays)', () => {
    const now = '2025-06-29T12:00:00.000Z';
    const result = computeEvidenceDecay({
      retrievedAt: '2025-06-15T12:00:00.000Z',
      now,
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.ok(result >= 0.48, `expected ~0.5, got ${result}`);
    assert.ok(result <= 0.52, `expected ~0.5, got ${result}`);
  });

  it('returns floor for very old evidence', () => {
    const now = '2025-09-15T12:00:00.000Z';
    const result = computeEvidenceDecay({
      retrievedAt: '2025-06-15T12:00:00.000Z',
      now,
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.equal(result, 0.3);
  });

  it('returns 1.0 when retrievedAt is missing', () => {
    const result = computeEvidenceDecay({
      retrievedAt: null,
      now: '2025-06-15T12:00:00.000Z',
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.equal(result, 1.0);
  });

  it('returns 1.0 when retrievedAt is empty string', () => {
    const result = computeEvidenceDecay({
      retrievedAt: '',
      now: '2025-06-15T12:00:00.000Z',
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.equal(result, 1.0);
  });

  it('returns 1.0 when retrievedAt is unparseable', () => {
    const result = computeEvidenceDecay({
      retrievedAt: 'not-a-date',
      now: '2025-06-15T12:00:00.000Z',
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.equal(result, 1.0);
  });

  it('clamps to floor not below it', () => {
    const result = computeEvidenceDecay({
      retrievedAt: '2020-01-01T00:00:00.000Z',
      now: '2025-06-15T12:00:00.000Z',
      decayDays: 14,
      decayFloor: 0.3
    });
    assert.equal(result, 0.3);
  });

  it('handles decayDays = 0 gracefully', () => {
    const result = computeEvidenceDecay({
      retrievedAt: '2025-06-14T12:00:00.000Z',
      now: '2025-06-15T12:00:00.000Z',
      decayDays: 0,
      decayFloor: 0.3
    });
    assert.equal(result, 1.0);
  });
});

describe('computeNeedSet with decay', () => {
  const baseFieldOrder = ['weight', 'sensor'];
  const baseFieldRules = {
    weight: { required_level: 'required', min_evidence_refs: 1 },
    sensor: { required_level: 'required', min_evidence_refs: 1 }
  };
  const baseIdentityContext = {
    status: 'locked',
    confidence: 0.95,
    extraction_gate_open: true,
    publishable: true
  };

  it('applies decay to effective confidence for stale evidence', () => {
    const provenance = {
      weight: {
        value: '58g',
        confidence: 0.9,
        pass_target: 0.8,
        meets_pass_target: true,
        evidence: [{ url: 'https://example.com', retrieved_at: '2025-03-01T00:00:00.000Z' }]
      },
      sensor: {
        value: 'PAW3950',
        confidence: 0.9,
        pass_target: 0.8,
        meets_pass_target: true,
        evidence: [{ url: 'https://example.com', retrieved_at: '2025-06-14T00:00:00.000Z' }]
      }
    };

    const result = computeNeedSet({
      runId: 'test-run',
      category: 'mouse',
      productId: 'test-mouse',
      fieldOrder: baseFieldOrder,
      provenance,
      fieldRules: baseFieldRules,
      identityContext: baseIdentityContext,
      now: '2025-06-15T00:00:00.000Z',
      decayConfig: { decayDays: 14, decayFloor: 0.3 }
    });

    const weightNeed = result.needs.find((n) => n.field_key === 'weight');
    assert.ok(weightNeed, 'weight should appear in NeedSet due to decayed confidence');
    assert.ok(weightNeed.effective_confidence < 0.9, 'effective confidence should be decayed below raw 0.9');

    const sensorNeed = result.needs.find((n) => n.field_key === 'sensor');
    assert.strictEqual(sensorNeed, undefined, 'sensor has recent evidence and meets pass_target — should NOT be in NeedSet');
  });

  it('behaves identically without decayConfig (regression)', () => {
    const provenance = {
      weight: {
        value: '58g',
        confidence: 0.9,
        pass_target: 0.8,
        meets_pass_target: true,
        evidence: [{ url: 'https://example.com', retrieved_at: '2025-03-01T00:00:00.000Z' }]
      }
    };

    const withoutDecay = computeNeedSet({
      runId: 'test-run',
      category: 'mouse',
      productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance,
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1 } },
      identityContext: baseIdentityContext,
      now: '2025-06-15T00:00:00.000Z'
    });

    assert.ok(!withoutDecay.needs.find((n) => n.field_key === 'weight'),
      'without decay, weight with 0.9 confidence should NOT appear in NeedSet when pass_target=0.8');
  });

  it('handles missing retrieved_at in evidence rows with decay enabled', () => {
    const provenance = {
      weight: {
        value: '58g',
        confidence: 0.9,
        pass_target: 0.8,
        meets_pass_target: true,
        evidence: [{ url: 'https://example.com' }]
      }
    };

    const result = computeNeedSet({
      runId: 'test-run',
      category: 'mouse',
      productId: 'test-mouse',
      fieldOrder: ['weight'],
      provenance,
      fieldRules: { weight: { required_level: 'required', min_evidence_refs: 1 } },
      identityContext: baseIdentityContext,
      now: '2025-06-15T00:00:00.000Z',
      decayConfig: { decayDays: 14, decayFloor: 0.3 }
    });

    assert.ok(!result.needs.find((n) => n.field_key === 'weight'),
      'missing retrieved_at should default to decay=1.0 (no decay)');
  });
});
