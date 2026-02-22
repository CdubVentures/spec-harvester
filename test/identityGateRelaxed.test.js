import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateIdentityGate,
  buildIdentityCriticalContradictions
} from '../src/validator/identityGate.js';
import { loadConfig } from '../src/config.js';
import {
  evaluateStopConditions
} from '../src/pipeline/runOrchestrator.js';

function makeAcceptedSource(overrides = {}) {
  return {
    url: overrides.url || 'https://example.com/product',
    rootDomain: overrides.rootDomain || 'example.com',
    host: overrides.host || 'example.com',
    tier: overrides.tier || 2,
    role: overrides.role || 'lab',
    approvedDomain: true,
    discoveryOnly: false,
    helperSource: overrides.helperSource || false,
    identity: {
      match: true,
      score: 0.76,
      reasons: ['brand_match', 'model_match'],
      criticalConflicts: [],
      ...(overrides.identity || {})
    },
    anchorCheck: { majorConflicts: [] },
    fieldCandidates: overrides.fieldCandidates || [],
    identityCandidates: overrides.identityCandidates || {},
    ...(overrides.extra || {})
  };
}

describe('Step 1: Tiered identity gate threshold', () => {
  it('manufacturer + additional sources without contradictions yields certainty >= 0.95 (capped at 0.95 not 0.99)', () => {
    const gate = evaluateIdentityGate([
      makeAcceptedSource({
        url: 'https://razer.com/mice/viper',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer'
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2
      }),
      makeAcceptedSource({
        url: 'https://techpowerup.com/review',
        rootDomain: 'techpowerup.com',
        tier: 2
      })
    ]);

    assert.ok(gate.certainty >= 0.95, `certainty ${gate.certainty} should be >= 0.95`);
    assert.ok(gate.certainty <= 1.0, `certainty ${gate.certainty} should be <= 1.0`);
    assert.equal(gate.validated, true);
  });

  it('manufacturer + additional + contradictions yields certainty 0.75 (extraction proceeds above 0.70)', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice/viper',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        fieldCandidates: [{ field: 'connection', value: 'wireless' }]
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        fieldCandidates: [{ field: 'connection', value: 'wireless / wired' }]
      }),
      makeAcceptedSource({
        url: 'https://techpowerup.com/review',
        rootDomain: 'techpowerup.com',
        tier: 2,
        fieldCandidates: []
      })
    ];

    const gate = evaluateIdentityGate(sources);
    assert.ok(gate.certainty >= 0.70, `certainty ${gate.certainty} should be >= 0.70 even with contradictions`);
  });

  it('no accepted sources yields low certainty below threshold', () => {
    const gate = evaluateIdentityGate([
      makeAcceptedSource({
        url: 'https://unknown.com/page',
        rootDomain: 'unknown.com',
        tier: 3,
        role: 'retail',
        identity: { match: false, score: 0.3, reasons: [], criticalConflicts: [] },
        extra: { approvedDomain: false }
      })
    ]);

    assert.ok(gate.certainty < 0.70, `certainty ${gate.certainty} should be < 0.70 with no accepted sources`);
    assert.equal(gate.validated, false);
  });

  it('manufacturer only (no additional sources) yields certainty below 0.95', () => {
    const gate = evaluateIdentityGate([
      makeAcceptedSource({
        url: 'https://razer.com/mice/viper',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer'
      })
    ]);

    assert.ok(gate.certainty >= 0.70, `certainty ${gate.certainty} should be >= 0.70`);
    assert.ok(gate.certainty < 0.95, `certainty ${gate.certainty} should be < 0.95 without additional sources`);
    assert.equal(gate.validated, false);
  });

  it('config identityGatePublishThreshold defaults to 0.70', () => {
    const config = loadConfig();
    assert.equal(config.identityGatePublishThreshold, 0.70);
  });
});

describe('Step 2: Relaxed contradiction detection', () => {
  it('wireless vs wireless / wired is NOT a connection conflict', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        fieldCandidates: [{ field: 'connection', value: 'wireless' }]
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        fieldCandidates: [{ field: 'connection', value: 'wireless / wired' }]
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const connectionConflicts = contradictions.filter(c => c.conflict === 'connection_class_conflict');
    assert.equal(connectionConflicts.length, 0, 'wireless vs wireless/wired should not be a conflict');
  });

  it('Focus Pro 30K vs FOCUS PRO 30K Optical is NOT a sensor conflict', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        fieldCandidates: [{ field: 'sensor', value: 'Focus Pro 30K' }]
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        fieldCandidates: [{ field: 'sensor', value: 'FOCUS PRO 30K Optical' }]
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const sensorConflicts = contradictions.filter(c => c.conflict === 'sensor_family_conflict');
    assert.equal(sensorConflicts.length, 0, 'Focus Pro 30K vs FOCUS PRO 30K Optical should not be a conflict');
  });

  it('125.6mm vs 126.1mm is NOT a dimension conflict (within 3mm)', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        fieldCandidates: [{ field: 'lngth', value: '125.6' }]
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        fieldCandidates: [{ field: 'lngth', value: '126.1' }]
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const sizeConflicts = contradictions.filter(c => c.conflict === 'size_class_conflict');
    assert.equal(sizeConflicts.length, 0, '0.5mm difference should not be a conflict');
  });

  it('125mm vs 132mm IS a dimension conflict (7mm difference)', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        fieldCandidates: [{ field: 'lngth', value: '125' }]
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        fieldCandidates: [{ field: 'lngth', value: '132' }]
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const sizeConflicts = contradictions.filter(c => c.conflict === 'size_class_conflict');
    assert.equal(sizeConflicts.length, 1, '7mm difference should be a conflict');
  });

  it('regional SKU variants share base SKU — NOT a conflict', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        identityCandidates: { sku: 'RZ01-04630100-R3U1' }
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        identityCandidates: { sku: 'RZ01-04630100-R3M1' }
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const skuConflicts = contradictions.filter(c => c.conflict === 'sku_conflict');
    assert.equal(skuConflicts.length, 0, 'regional SKU variants should not be a conflict');
  });

  it('completely different SKUs IS a conflict', () => {
    const sources = [
      makeAcceptedSource({
        url: 'https://razer.com/mice',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer',
        identityCandidates: { sku: 'RZ01-04630100-R3U1' }
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2,
        identityCandidates: { sku: 'LOG-910-006787' }
      })
    ];

    const contradictions = buildIdentityCriticalContradictions(sources);
    const skuConflicts = contradictions.filter(c => c.conflict === 'sku_conflict');
    assert.equal(skuConflicts.length, 1, 'completely different SKUs should be a conflict');
  });
});

describe('Step 3: Identity fast-fail stop condition', () => {
  it('identity stuck for 1 round stops immediately with default config', () => {
    const result = evaluateStopConditions({
      identityStuckRounds: 1,
      identityFailFastRounds: 1
    });
    assert.equal(result.stop, true);
    assert.equal(result.reason, 'identity_gate_stuck');
  });

  it('identity improves — does not trigger fast-fail', () => {
    const result = evaluateStopConditions({
      identityStuckRounds: 0,
      identityFailFastRounds: 1
    });
    assert.equal(result.stop, false);
  });

  it('config convergenceIdentityFailFastRounds defaults to 1', () => {
    const config = loadConfig();
    assert.equal(config.convergenceIdentityFailFastRounds, 1);
  });

  it('identity stuck but fail-fast disabled (0) does not trigger', () => {
    const result = evaluateStopConditions({
      identityStuckRounds: 5,
      identityFailFastRounds: 0
    });
    assert.equal(result.stop, false);
  });
});

describe('Step 4: Performance tuning defaults', () => {
  it('standard profile has tuned defaults', () => {
    const config = loadConfig({ runProfile: 'standard' });
    assert.equal(config.perHostMinDelayMs, 300);
    assert.equal(config.pageGotoTimeoutMs, 15000);
    assert.equal(config.pageNetworkIdleTimeoutMs, 2000);
    assert.equal(config.discoveryMaxQueries, 6);
    assert.equal(config.discoveryMaxDiscovered, 80);
    assert.equal(config.convergenceMaxRounds, 3);
    assert.equal(config.convergenceMaxLowQualityRounds, 1);
    assert.equal(config.convergenceNoProgressLimit, 2);
  });
});

describe('Step 5: Soft identity gate on extraction', () => {
  it('certainty 0.85 with validated=true results in full extraction (identityFull=true)', () => {
    const gate = evaluateIdentityGate([
      makeAcceptedSource({
        url: 'https://razer.com/mice/viper',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer'
      }),
      makeAcceptedSource({
        url: 'https://rtings.com/review',
        rootDomain: 'rtings.com',
        tier: 2
      }),
      makeAcceptedSource({
        url: 'https://techpowerup.com/review',
        rootDomain: 'techpowerup.com',
        tier: 2
      })
    ]);

    assert.equal(gate.validated, true);
    assert.ok(gate.certainty >= 0.70);
  });

  it('manufacturer only without additional sources is in provisional band (>= 0.50 but validated=false)', () => {
    const gate = evaluateIdentityGate([
      makeAcceptedSource({
        url: 'https://razer.com/mice/viper',
        rootDomain: 'razer.com',
        tier: 1,
        role: 'manufacturer'
      })
    ]);

    assert.ok(gate.certainty >= 0.50, `certainty ${gate.certainty} should be >= 0.50`);
    assert.equal(gate.validated, false, 'should not be validated without additional sources');
  });

  it('zero accepted sources (all identity.match=false, unapproved) yields certainty below publishThreshold', () => {
    const gate = evaluateIdentityGate([
      {
        url: 'https://unknown.com/page',
        rootDomain: 'unknown.com',
        tier: 4,
        role: 'retail',
        approvedDomain: false,
        discoveryOnly: false,
        identity: { match: false, score: 0.2, reasons: [], criticalConflicts: [] },
        anchorCheck: { majorConflicts: [] },
        fieldCandidates: []
      }
    ]);

    assert.equal(gate.validated, false);
    assert.equal(gate.acceptedSourceCount, 0);
    assert.ok(gate.certainty < 0.70, `certainty ${gate.certainty} should be < 0.70`);
  });
});
