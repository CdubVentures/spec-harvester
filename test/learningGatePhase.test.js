import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { evaluateFieldLearningGates, emitLearningGateEvents, populateLearningStores } from '../src/pipeline/learningGatePhase.js';
import {
  UrlMemoryStore,
  DomainFieldYieldStore,
  FieldAnchorsStore,
  ComponentLexiconStore
} from '../src/learning/learningStores.js';

function makeProvenance(overrides = {}) {
  return {
    confidence: 0.92,
    confirmations: 3,
    approved_confirmations: 2,
    evidence: [
      { url: 'https://razer.com/viper', tier: 1, quote: 'Focus Pro 35K sensor' },
      { url: 'https://rtings.com/mouse', tier: 2, quote: '35K DPI optical sensor' }
    ],
    ...overrides
  };
}

test('evaluateFieldLearningGates: skips fields with value unk', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor', 'weight'],
    fields: { sensor: 'Focus Pro 35K', weight: 'unk' },
    provenance: {
      sensor: makeProvenance(),
      weight: makeProvenance()
    },
    category: 'mouse',
    runId: 'run-1'
  });
  assert.equal(result.gateResults.length, 1);
  assert.equal(result.gateResults[0].field, 'sensor');
  assert.ok(!result.gateResults.some((g) => g.field === 'weight'));
});

test('evaluateFieldLearningGates: high confidence + tier 1 evidence passes gate', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor'],
    fields: { sensor: 'Focus Pro 35K' },
    provenance: {
      sensor: makeProvenance({ confidence: 0.95 })
    },
    category: 'mouse',
    runId: 'run-1'
  });
  assert.equal(result.gateResults.length, 1);
  assert.equal(result.gateResults[0].accepted, true);
  assert.equal(result.gateResults[0].reason, null);
  assert.equal(result.acceptedUpdates.length, 1);
  assert.equal(result.acceptedUpdates[0].field, 'sensor');
  assert.equal(result.acceptedUpdates[0].value, 'Focus Pro 35K');
  assert.equal(result.acceptedUpdates[0].sourceRunId, 'run-1');
});

test('evaluateFieldLearningGates: low confidence is rejected', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor'],
    fields: { sensor: 'Focus Pro 35K' },
    provenance: {
      sensor: makeProvenance({ confidence: 0.5 })
    },
    category: 'mouse',
    runId: 'run-1'
  });
  assert.equal(result.gateResults[0].accepted, false);
  assert.equal(result.gateResults[0].reason, 'confidence_below_threshold');
  assert.equal(result.acceptedUpdates.length, 0);
});

test('evaluateFieldLearningGates: no tier 1/2 evidence is rejected', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor'],
    fields: { sensor: 'Focus Pro 35K' },
    provenance: {
      sensor: makeProvenance({
        confidence: 0.95,
        evidence: [
          { url: 'https://forum.com/post', tier: 3 },
          { url: 'https://ebay.com/item', tier: 4 }
        ]
      })
    },
    category: 'mouse',
    runId: 'run-1'
  });
  assert.equal(result.gateResults[0].accepted, false);
  assert.equal(result.gateResults[0].reason, 'tier_criteria_not_met');
});

test('evaluateFieldLearningGates: component field without accepted review is rejected', () => {
  const mockFieldRulesEngine = {
    getRule: (field) => field === 'sensor' ? { parse_template: 'component_reference' } : null
  };
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor'],
    fields: { sensor: 'Focus Pro 35K' },
    provenance: {
      sensor: makeProvenance({ confidence: 0.95 })
    },
    category: 'mouse',
    runId: 'run-1',
    fieldRulesEngine: mockFieldRulesEngine
  });
  assert.equal(result.gateResults[0].accepted, false);
  assert.equal(result.gateResults[0].reason, 'component_not_accepted');
});

test('evaluateFieldLearningGates: empty fieldOrder returns empty arrays', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: [],
    fields: {},
    provenance: {},
    category: 'mouse',
    runId: 'run-1'
  });
  assert.deepStrictEqual(result.gateResults, []);
  assert.deepStrictEqual(result.acceptedUpdates, []);
});

test('evaluateFieldLearningGates: evidence refs extracted correctly into acceptedUpdates', () => {
  const result = evaluateFieldLearningGates({
    fieldOrder: ['sensor'],
    fields: { sensor: 'Focus Pro 35K' },
    provenance: {
      sensor: makeProvenance({
        confidence: 0.95,
        confirmations: 5,
        approved_confirmations: 3,
        evidence: [
          { url: 'https://razer.com/viper', tier: 1, quote: 'Focus Pro 35K sensor' },
          { url: 'https://rtings.com/mouse', tier: 2, quote: 'optical sensor' }
        ]
      })
    },
    category: 'mouse',
    runId: 'run-1'
  });
  const update = result.acceptedUpdates[0];
  assert.deepStrictEqual(update.evidenceRefs, [
    { url: 'https://razer.com/viper', tier: 1 },
    { url: 'https://rtings.com/mouse', tier: 2 }
  ]);
  assert.deepStrictEqual(update.acceptanceStats, { confirmations: 5, approved: 3 });
});

test('emitLearningGateEvents: emits one event per gate result', () => {
  const logged = [];
  const logger = {
    info: (event, payload) => logged.push({ event, payload })
  };
  const gateResults = [
    { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 3, tierHistory: [1, 2], accepted: true, reason: null },
    { field: 'weight', value: '58g', confidence: 0.6, refsFound: 1, tierHistory: [3], accepted: false, reason: 'confidence_below_threshold' }
  ];
  emitLearningGateEvents({ gateResults, logger, runId: 'run-1' });

  assert.equal(logged.length, 2);
  assert.equal(logged[0].event, 'learning_gate_result');
  assert.equal(logged[0].payload.field, 'sensor');
  assert.equal(logged[0].payload.accepted, true);
  assert.equal(logged[0].payload.source_run_id, 'run-1');
  assert.equal(logged[1].event, 'learning_gate_result');
  assert.equal(logged[1].payload.field, 'weight');
  assert.equal(logged[1].payload.accepted, false);
  assert.equal(logged[1].payload.reason, 'confidence_below_threshold');
});

test('emitLearningGateEvents: correct payload shape matches GUI endpoint', () => {
  const logged = [];
  const logger = {
    info: (event, payload) => logged.push({ event, payload })
  };
  emitLearningGateEvents({
    gateResults: [{ field: 'dpi', value: '35000', confidence: 0.91, refsFound: 2, tierHistory: [1], accepted: true, reason: null }],
    logger,
    runId: 'run-2'
  });
  const p = logged[0].payload;
  assert.ok('field' in p);
  assert.ok('value' in p);
  assert.ok('confidence' in p);
  assert.ok('refs_found' in p);
  assert.ok('tier_history' in p);
  assert.ok('accepted' in p);
  assert.ok('reason' in p);
  assert.ok('source_run_id' in p);
});

test('emitLearningGateEvents: zero events for empty gateResults', () => {
  const logged = [];
  const logger = {
    info: (event, payload) => logged.push({ event, payload })
  };
  emitLearningGateEvents({ gateResults: [], logger, runId: 'run-1' });
  assert.equal(logged.length, 0);
});

function makeStores() {
  const db = new Database(':memory:');
  return {
    db,
    urlMemory: new UrlMemoryStore(db),
    domainFieldYield: new DomainFieldYieldStore(db),
    fieldAnchors: new FieldAnchorsStore(db),
    componentLexicon: new ComponentLexiconStore(db)
  };
}

test('populateLearningStores: UrlMemoryStore.upsert called for accepted field evidence URLs', () => {
  const { db, ...stores } = makeStores();
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null }
    ],
    acceptedUpdates: [
      {
        field: 'sensor', value: 'Focus Pro 35K',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }, { url: 'https://rtings.com/mouse', tier: 2 }],
        acceptanceStats: { confirmations: 3, approved: 2 },
        sourceRunId: 'run-1'
      }
    ],
    provenance: {
      sensor: makeProvenance({ confidence: 0.95 })
    },
    category: 'mouse',
    runId: 'run-1',
    stores
  });
  const urls = stores.urlMemory.query({ field: 'sensor', category: 'mouse' });
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.url === 'https://razer.com/viper'));
  assert.ok(urls.some((u) => u.url === 'https://rtings.com/mouse'));
  db.close();
});

test('populateLearningStores: DomainFieldYieldStore.recordUsed for accepted, recordSeen for all', () => {
  const { db, ...stores } = makeStores();
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null },
      { field: 'weight', value: '58g', confidence: 0.5, refsFound: 1, tierHistory: [3], accepted: false, reason: 'confidence_below_threshold' }
    ],
    acceptedUpdates: [
      {
        field: 'sensor', value: 'Focus Pro 35K',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }],
        acceptanceStats: {},
        sourceRunId: 'run-1'
      }
    ],
    provenance: {
      sensor: makeProvenance({ confidence: 0.95, evidence: [{ url: 'https://razer.com/viper', tier: 1 }] }),
      weight: makeProvenance({ confidence: 0.5, evidence: [{ url: 'https://forum.com/post', tier: 3 }] })
    },
    category: 'mouse',
    runId: 'run-1',
    stores
  });
  const sensorYield = stores.domainFieldYield.getYield({ domain: 'razer.com', field: 'sensor', category: 'mouse' });
  assert.equal(sensorYield.used_count, 1);
  assert.equal(sensorYield.seen_count, 1);

  const weightYield = stores.domainFieldYield.getYield({ domain: 'forum.com', field: 'weight', category: 'mouse' });
  assert.equal(weightYield.used_count, 0);
  assert.equal(weightYield.seen_count, 1);
  db.close();
});

test('populateLearningStores: FieldAnchorsStore.insert with evidence quotes as phrases', () => {
  const { db, ...stores } = makeStores();
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null }
    ],
    acceptedUpdates: [
      {
        field: 'sensor', value: 'Focus Pro 35K',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }],
        acceptanceStats: {},
        sourceRunId: 'run-1'
      }
    ],
    provenance: {
      sensor: makeProvenance({
        confidence: 0.95,
        evidence: [
          { url: 'https://razer.com/viper', tier: 1, quote: 'Focus Pro 35K sensor' }
        ]
      })
    },
    category: 'mouse',
    runId: 'run-1',
    stores
  });
  const anchors = stores.fieldAnchors.query({ field: 'sensor', category: 'mouse' });
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].phrase, 'Focus Pro 35K sensor');
  assert.equal(anchors[0].source_url, 'https://razer.com/viper');
  db.close();
});

test('populateLearningStores: ComponentLexiconStore.insert only for component_reference fields', () => {
  const { db, ...stores } = makeStores();
  const mockFieldRulesEngine = {
    getRule: (field) => field === 'sensor' ? { parse_template: 'component_reference' } : null
  };
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null },
      { field: 'weight', value: '58g', confidence: 0.95, refsFound: 2, tierHistory: [1], accepted: true, reason: null }
    ],
    acceptedUpdates: [
      {
        field: 'sensor', value: 'Focus Pro 35K',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }],
        acceptanceStats: {},
        sourceRunId: 'run-1'
      },
      {
        field: 'weight', value: '58g',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }],
        acceptanceStats: {},
        sourceRunId: 'run-1'
      }
    ],
    provenance: {
      sensor: makeProvenance({ confidence: 0.95 }),
      weight: makeProvenance({ confidence: 0.95 })
    },
    category: 'mouse',
    runId: 'run-1',
    stores,
    fieldRulesEngine: mockFieldRulesEngine
  });
  const sensorLex = stores.componentLexicon.query({ field: 'sensor', category: 'mouse' });
  assert.equal(sensorLex.length, 1);
  assert.equal(sensorLex[0].value, 'Focus Pro 35K');

  const weightLex = stores.componentLexicon.query({ field: 'weight', category: 'mouse' });
  assert.equal(weightLex.length, 0);
  db.close();
});

test('populateLearningStores: no store calls for rejected fields except recordSeen', () => {
  const { db, ...stores } = makeStores();
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.5, refsFound: 1, tierHistory: [3], accepted: false, reason: 'confidence_below_threshold' }
    ],
    acceptedUpdates: [],
    provenance: {
      sensor: makeProvenance({ confidence: 0.5, evidence: [{ url: 'https://forum.com/post', tier: 3, quote: 'some quote' }] })
    },
    category: 'mouse',
    runId: 'run-1',
    stores
  });
  const urls = stores.urlMemory.query({ field: 'sensor', category: 'mouse' });
  assert.equal(urls.length, 0);

  const anchors = stores.fieldAnchors.query({ field: 'sensor', category: 'mouse' });
  assert.equal(anchors.length, 0);

  const forumYield = stores.domainFieldYield.getYield({ domain: 'forum.com', field: 'sensor', category: 'mouse' });
  assert.equal(forumYield.seen_count, 1);
  assert.equal(forumYield.used_count, 0);
  db.close();
});

test('populateLearningStores: stores receive correct category and sourceRunId', () => {
  const { db, ...stores } = makeStores();
  populateLearningStores({
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null }
    ],
    acceptedUpdates: [
      {
        field: 'sensor', value: 'Focus Pro 35K',
        evidenceRefs: [{ url: 'https://razer.com/viper', tier: 1 }],
        acceptanceStats: {},
        sourceRunId: 'run-42'
      }
    ],
    provenance: {
      sensor: makeProvenance({ confidence: 0.95, evidence: [{ url: 'https://razer.com/viper', tier: 1, quote: 'sensor text' }] })
    },
    category: 'keyboard',
    runId: 'run-42',
    stores
  });
  const urls = stores.urlMemory.query({ field: 'sensor', category: 'keyboard' });
  assert.equal(urls.length, 1);
  assert.equal(urls[0].source_run_id, 'run-42');

  const anchors = stores.fieldAnchors.query({ field: 'sensor', category: 'keyboard' });
  assert.equal(anchors[0].source_run_id, 'run-42');
  db.close();
});
