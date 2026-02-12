import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIdentityGate, evaluateSourceIdentity } from '../src/validator/identityGate.js';

test('evaluateSourceIdentity can match brand+model when variant is not provided', () => {
  const identity = evaluateSourceIdentity(
    {
      url: 'https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.html',
      title: 'PRO X SUPERLIGHT 2 Gaming Mouse',
      identityCandidates: {
        brand: 'Logitech',
        model: 'G Pro X Superlight 2'
      }
    },
    {
      brand: 'Logitech',
      model: 'G Pro X Superlight 2',
      variant: '',
      sku: '',
      mpn: '',
      gtin: ''
    }
  );

  assert.equal(identity.match, true);
  assert.equal(identity.score >= 0.7, true);
  assert.equal(identity.matchThreshold <= 0.7, true);
  assert.deepEqual(identity.criticalConflicts, []);
});

test('evaluateIdentityGate ignores weak contradictions from generic category pages', () => {
  const gate = evaluateIdentityGate([
    {
      url: 'https://www.logitechg.com/en-us/products/gaming-mice/pro-x-superlight-2.html',
      rootDomain: 'logitechg.com',
      tier: 1,
      role: 'manufacturer',
      approvedDomain: true,
      identity: {
        match: true,
        score: 0.74,
        reasons: ['brand_match', 'model_match'],
        criticalConflicts: []
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    },
    {
      url: 'https://www.rtings.com/mouse/reviews/logitech/g-pro-x-superlight-2',
      rootDomain: 'rtings.com',
      tier: 2,
      role: 'lab',
      approvedDomain: true,
      identity: {
        match: true,
        score: 0.76,
        reasons: ['brand_match', 'model_match'],
        criticalConflicts: []
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    },
    {
      url: 'https://www.techpowerup.com/review/logitech-g-pro-x-superlight-2/',
      rootDomain: 'techpowerup.com',
      tier: 2,
      role: 'database',
      approvedDomain: true,
      identity: {
        match: true,
        score: 0.73,
        reasons: ['brand_match', 'model_match'],
        criticalConflicts: []
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    },
    {
      url: 'https://www.logitechg.com/en-us/shop/c/gaming-mice',
      rootDomain: 'logitechg.com',
      tier: 1,
      role: 'manufacturer',
      approvedDomain: true,
      identity: {
        match: false,
        score: 0.2,
        reasons: ['brand_match'],
        criticalConflicts: ['model_mismatch']
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    }
  ]);

  assert.equal(gate.validated, true);
  assert.equal(gate.requirements.hasManufacturer, true);
  assert.equal(gate.requirements.additionalCredibleSources >= 2, true);
  assert.equal(gate.contradictions.length, 0);
});

test('evaluateIdentityGate allows helper-backed validation with manufacturer + one credible source', () => {
  const gate = evaluateIdentityGate([
    {
      url: 'https://www.razer.com/gaming-mice/razer-basilisk-v3-35k',
      rootDomain: 'razer.com',
      host: 'razer.com',
      tier: 1,
      role: 'manufacturer',
      approvedDomain: true,
      identity: {
        match: true,
        score: 0.78,
        reasons: ['brand_match', 'model_match'],
        criticalConflicts: []
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    },
    {
      url: 'helper_files://mouse/activeFiltering.json#138',
      rootDomain: 'helper-files.local',
      host: 'helper-files.local',
      tier: 2,
      role: 'database',
      approvedDomain: true,
      helperSource: true,
      identity: {
        match: true,
        score: 0.99,
        reasons: ['helper_supportive_match'],
        criticalConflicts: []
      },
      anchorCheck: { majorConflicts: [] },
      fieldCandidates: []
    }
  ]);

  assert.equal(gate.validated, true);
  assert.equal(gate.requirements.hasManufacturer, true);
  assert.equal(gate.requirements.hasTrustedHelper, true);
  assert.equal(gate.requirements.additionalCredibleSources, 1);
});
