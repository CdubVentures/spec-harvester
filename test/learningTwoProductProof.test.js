import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ComponentLexiconStore,
  FieldAnchorsStore,
  UrlMemoryStore,
  DomainFieldYieldStore
} from '../src/learning/learningStores.js';
import { populateLearningStores } from '../src/pipeline/learningGatePhase.js';
import { readLearningHintsFromStores } from '../src/learning/learningReadback.js';

function makeDb() {
  return new Database(':memory:');
}

function makeStores(db) {
  return {
    urlMemory: new UrlMemoryStore(db),
    domainFieldYield: new DomainFieldYieldStore(db),
    fieldAnchors: new FieldAnchorsStore(db),
    componentLexicon: new ComponentLexiconStore(db)
  };
}

function makeFieldRulesEngine(componentFields = []) {
  return {
    getRule: (field) => ({
      parse_template: componentFields.includes(field) ? 'component_reference' : 'text'
    })
  };
}

function makeProductAResults() {
  return {
    gateResults: [
      { field: 'sensor', value: 'Focus Pro 35K', confidence: 0.95, refsFound: 3, tierHistory: [1, 2], accepted: true, reason: null },
      { field: 'dpi', value: '35000', confidence: 0.92, refsFound: 2, tierHistory: [1], accepted: true, reason: null },
      { field: 'polling_rate', value: '4000', confidence: 0.88, refsFound: 2, tierHistory: [1, 2], accepted: true, reason: null },
      { field: 'weight', value: '55g', confidence: 0.90, refsFound: 3, tierHistory: [1, 2, 3], accepted: true, reason: null },
      { field: 'switch', value: 'Razer Gen-3 Optical', confidence: 0.93, refsFound: 2, tierHistory: [1], accepted: true, reason: null },
      { field: 'connection', value: 'USB-C / 2.4GHz', confidence: 0.70, refsFound: 1, tierHistory: [3], accepted: false, reason: 'confidence_below_threshold' }
    ],
    acceptedUpdates: [
      { field: 'sensor', value: 'Focus Pro 35K', evidenceRefs: [{ url: 'https://razer.com/viper-v3-pro', tier: 1 }, { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2 }, { url: 'https://techpowerup.com/review/razer-viper-v3-pro', tier: 2 }], acceptanceStats: { confirmations: 3, approved: 3 }, sourceRunId: 'run-product-a' },
      { field: 'dpi', value: '35000', evidenceRefs: [{ url: 'https://razer.com/viper-v3-pro', tier: 1 }, { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2 }], acceptanceStats: { confirmations: 2, approved: 2 }, sourceRunId: 'run-product-a' },
      { field: 'polling_rate', value: '4000', evidenceRefs: [{ url: 'https://razer.com/viper-v3-pro', tier: 1 }, { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2 }], acceptanceStats: { confirmations: 2, approved: 2 }, sourceRunId: 'run-product-a' },
      { field: 'weight', value: '55g', evidenceRefs: [{ url: 'https://razer.com/viper-v3-pro', tier: 1 }, { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2 }, { url: 'https://amazon.com/razer-viper-v3-pro', tier: 3 }], acceptanceStats: { confirmations: 3, approved: 3 }, sourceRunId: 'run-product-a' },
      { field: 'switch', value: 'Razer Gen-3 Optical', evidenceRefs: [{ url: 'https://razer.com/viper-v3-pro', tier: 1 }, { url: 'https://techpowerup.com/review/razer-viper-v3-pro', tier: 2 }], acceptanceStats: { confirmations: 2, approved: 2 }, sourceRunId: 'run-product-a' }
    ]
  };
}

function makeProductAProvenance() {
  return {
    sensor: {
      confidence: 0.95,
      confirmations: 3,
      approved_confirmations: 3,
      evidence: [
        { url: 'https://razer.com/viper-v3-pro', tier: 1, quote: 'Razer Focus Pro 35K optical sensor' },
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2, quote: 'Focus Pro 35K sensor with 35000 DPI' },
        { url: 'https://techpowerup.com/review/razer-viper-v3-pro', tier: 2, quote: '35K DPI Focus Pro sensor' }
      ]
    },
    dpi: {
      confidence: 0.92,
      confirmations: 2,
      approved_confirmations: 2,
      evidence: [
        { url: 'https://razer.com/viper-v3-pro', tier: 1, quote: 'Up to 35,000 DPI' },
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2, quote: 'Maximum DPI: 35000' }
      ]
    },
    polling_rate: {
      confidence: 0.88,
      confirmations: 2,
      approved_confirmations: 2,
      evidence: [
        { url: 'https://razer.com/viper-v3-pro', tier: 1, quote: '4000Hz polling rate' },
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2, quote: 'Polling rate up to 4000 Hz' }
      ]
    },
    weight: {
      confidence: 0.90,
      confirmations: 3,
      approved_confirmations: 3,
      evidence: [
        { url: 'https://razer.com/viper-v3-pro', tier: 1, quote: 'Weight: 55g' },
        { url: 'https://rtings.com/mouse/reviews/razer/viper-v3-pro', tier: 2, quote: '55 grams without cable' },
        { url: 'https://amazon.com/razer-viper-v3-pro', tier: 3, quote: '55g ultralight' }
      ]
    },
    switch: {
      confidence: 0.93,
      confirmations: 2,
      approved_confirmations: 2,
      evidence: [
        { url: 'https://razer.com/viper-v3-pro', tier: 1, quote: 'Razer Gen-3 Optical Switches' },
        { url: 'https://techpowerup.com/review/razer-viper-v3-pro', tier: 2, quote: 'Gen-3 optical mouse switches' }
      ]
    },
    connection: {
      confidence: 0.70,
      confirmations: 1,
      evidence: [
        { url: 'https://amazon.com/razer-viper-v3-pro', tier: 3, quote: 'USB-C and wireless' }
      ]
    }
  };
}

test('populateLearningStores fills all 4 stores from Product A consensus', () => {
  const db = makeDb();
  const stores = makeStores(db);
  const productA = makeProductAResults();
  const provenance = makeProductAProvenance();

  populateLearningStores({
    gateResults: productA.gateResults,
    acceptedUpdates: productA.acceptedUpdates,
    provenance,
    category: 'mouse',
    runId: 'run-product-a',
    stores,
    fieldRulesEngine: makeFieldRulesEngine(['sensor', 'switch'])
  });

  const urls = stores.urlMemory.query({ field: 'sensor', category: 'mouse' });
  assert.ok(urls.length >= 2, `Expected >=2 URL memory entries for sensor, got ${urls.length}`);

  const anchors = stores.fieldAnchors.query({ field: 'sensor', category: 'mouse' });
  assert.ok(anchors.length >= 2, `Expected >=2 anchor entries for sensor, got ${anchors.length}`);

  const sensorYield = stores.domainFieldYield.getYield({ domain: 'razer.com', field: 'sensor', category: 'mouse' });
  assert.ok(sensorYield.used_count >= 1, 'Expected razer.com sensor yield used_count >= 1');

  const lexicon = stores.componentLexicon.query({ field: 'sensor', category: 'mouse' });
  assert.ok(lexicon.some((r) => r.value === 'Focus Pro 35K'), 'Expected sensor component lexicon entry');

  db.close();
});

test('readLearningHintsFromStores extracts anchor phrases for field', () => {
  const db = makeDb();
  const stores = makeStores(db);
  const productA = makeProductAResults();
  const provenance = makeProductAProvenance();

  populateLearningStores({
    gateResults: productA.gateResults,
    acceptedUpdates: productA.acceptedUpdates,
    provenance,
    category: 'mouse',
    runId: 'run-product-a',
    stores,
    fieldRulesEngine: makeFieldRulesEngine(['sensor', 'switch'])
  });

  const hints = readLearningHintsFromStores({
    stores,
    category: 'mouse',
    focusFields: ['sensor', 'dpi', 'weight']
  });

  assert.ok(hints.anchorsByField.sensor.length >= 1, 'Expected anchor hints for sensor');
  assert.ok(hints.anchorsByField.dpi.length >= 1, 'Expected anchor hints for dpi');
  assert.ok(hints.highYieldDomains.length >= 0, 'Expected domain yield data');
  assert.ok(hints.knownUrls.sensor.length >= 1, 'Expected known URL hints for sensor');

  db.close();
});

test('readLearningHintsFromStores returns domain yield rankings', () => {
  const db = makeDb();
  const stores = makeStores(db);
  const productA = makeProductAResults();
  const provenance = makeProductAProvenance();

  populateLearningStores({
    gateResults: productA.gateResults,
    acceptedUpdates: productA.acceptedUpdates,
    provenance,
    category: 'mouse',
    runId: 'run-product-a',
    stores,
    fieldRulesEngine: makeFieldRulesEngine(['sensor', 'switch'])
  });

  const hints = readLearningHintsFromStores({
    stores,
    category: 'mouse',
    focusFields: ['sensor', 'dpi', 'polling_rate', 'weight', 'switch']
  });

  const razerYield = hints.domainYields.find((d) => d.domain === 'razer.com');
  assert.ok(razerYield, 'Expected razer.com in domain yields');
  assert.ok(razerYield.totalUsed >= 3, `Expected razer.com totalUsed >= 3, got ${razerYield.totalUsed}`);

  db.close();
});

test('two-product proof: Product B benefits from Product A learning stores', () => {
  const db = makeDb();
  const stores = makeStores(db);
  const productA = makeProductAResults();
  const provenanceA = makeProductAProvenance();

  populateLearningStores({
    gateResults: productA.gateResults,
    acceptedUpdates: productA.acceptedUpdates,
    provenance: provenanceA,
    category: 'mouse',
    runId: 'run-product-a',
    stores,
    fieldRulesEngine: makeFieldRulesEngine(['sensor', 'switch'])
  });

  const hintsForB = readLearningHintsFromStores({
    stores,
    category: 'mouse',
    focusFields: ['sensor', 'dpi', 'polling_rate', 'weight', 'switch']
  });

  assert.ok(hintsForB.anchorsByField.sensor.length >= 2,
    'Product B should receive sensor anchor hints from Product A');
  assert.ok(hintsForB.knownUrls.sensor.length >= 2,
    'Product B should receive known URLs from Product A');

  const razerYield = hintsForB.domainYields.find((d) => d.domain === 'razer.com');
  assert.ok(razerYield && razerYield.totalUsed >= 3,
    'Product B should see razer.com as high-yield domain from Product A data');

  const rtingsYield = hintsForB.domainYields.find((d) => d.domain === 'rtings.com');
  assert.ok(rtingsYield && rtingsYield.totalUsed >= 2,
    'Product B should see rtings.com yield data from Product A');

  assert.ok(hintsForB.componentValues.sensor?.length >= 1,
    'Product B should have component lexicon from Product A for sensor field');

  db.close();
});

test('readLearningHintsFromStores returns empty gracefully when stores have no data', () => {
  const db = makeDb();
  const stores = makeStores(db);

  const hints = readLearningHintsFromStores({
    stores,
    category: 'mouse',
    focusFields: ['sensor', 'dpi']
  });

  assert.deepStrictEqual(hints.anchorsByField, { sensor: [], dpi: [] });
  assert.deepStrictEqual(hints.knownUrls, { sensor: [], dpi: [] });
  assert.deepStrictEqual(hints.componentValues, { sensor: [], dpi: [] });
  assert.deepStrictEqual(hints.domainYields, []);
  assert.deepStrictEqual(hints.highYieldDomains, []);

  db.close();
});

test('readLearningHintsFromStores respects decay on old anchors', () => {
  const db = makeDb();
  const stores = makeStores(db);

  stores.fieldAnchors.insert({
    field: 'sensor',
    category: 'mouse',
    phrase: 'old anchor phrase',
    sourceUrl: 'https://example.com',
    sourceRunId: 'old-run'
  });
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE field_anchors SET created_at = ? WHERE phrase = ?')
    .run(ninetyDaysAgo, 'old anchor phrase');

  stores.fieldAnchors.insert({
    field: 'sensor',
    category: 'mouse',
    phrase: 'fresh anchor phrase',
    sourceUrl: 'https://example.com/new',
    sourceRunId: 'new-run'
  });

  const hints = readLearningHintsFromStores({
    stores,
    category: 'mouse',
    focusFields: ['sensor']
  });

  const activeAnchors = hints.anchorsByField.sensor.filter((a) => a.decayStatus === 'active');
  const decayedAnchors = hints.anchorsByField.sensor.filter((a) => a.decayStatus === 'decayed');
  assert.ok(activeAnchors.length >= 1, 'Expected at least 1 active anchor');
  assert.ok(decayedAnchors.length >= 1, 'Expected at least 1 decayed anchor');

  db.close();
});
