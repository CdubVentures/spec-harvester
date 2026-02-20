import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicSourceResults } from '../src/testing/testDataProvider.js';

test('deterministic test-mode sources keep distinct root domains', () => {
  const contractAnalysis = {
    scenarioDefs: [{ id: 1, name: 'happy_path' }],
    summary: { rangeConstraints: {} },
    _raw: {
      fields: {
        release_date: {
          contract: { type: 'string', shape: 'scalar' },
          parse: { template: 'date_field' },
          enum: {}
        },
        dpi: {
          contract: { type: 'number', shape: 'scalar' },
          parse: { template: 'number_with_unit' },
          enum: {}
        }
      },
      fieldKeys: ['release_date', 'dpi'],
      componentTypes: [],
      kvFields: {},
      listFields: [],
      knownValuesCatalogs: [],
      preserveAllFields: [],
      tierOverrideFields: [],
      rules: []
    }
  };

  const product = {
    productId: '_test_mouse-testco-scenario-01',
    identityLock: { brand: 'TestCo', model: 'Scenario 1', variant: 'happy_path' },
    _testCase: { id: 1, name: 'happy_path' }
  };

  const sources = buildDeterministicSourceResults({
    product,
    contractAnalysis,
    generationOptions: {
      sourcesPerScenario: 0,
      sharedFieldRatioPercent: 70,
      sameValueDuplicatePercent: 15
    }
  });

  assert.equal(sources.length, 5);
  for (const source of sources) {
    assert.ok(source.fieldCandidates.length > 0);
    assert.equal(source.rootDomain, source.host);
  }
  const uniqueRootDomains = new Set(sources.map((s) => s.rootDomain));
  assert.equal(uniqueRootDomains.size, sources.length);
});
