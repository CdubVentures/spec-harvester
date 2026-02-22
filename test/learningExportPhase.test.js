import test from 'node:test';
import assert from 'node:assert/strict';
import { runLearningExportPhase } from '../src/pipeline/learningExportPhase.js';

function makeConfig(overrides = {}) {
  return {
    selfImproveEnabled: false,
    writeMarkdownSummary: false,
    fieldRulesEngineEnforceEvidence: false,
    ...overrides
  };
}

function makeMockStorage() {
  return {};
}

function makeMockLogger() {
  const events = [];
  return {
    events,
    warn: (type, data) => events.push({ type, ...data }),
    info: (type, data) => events.push({ type, ...data }),
    flush: async () => {}
  };
}

test('runLearningExportPhase returns exportInfo and finalExport', async () => {
  const summary = {};
  const result = await runLearningExportPhase({
    config: makeConfig(),
    storage: makeMockStorage(),
    category: 'mouse',
    productId: 'mouse-test-1',
    runId: 'run-001',
    job: { identityLock: {} },
    sourceResults: [],
    summary,
    learningProfile: null,
    discoveryResult: null,
    runBase: '',
    artifactsByHost: {},
    adapterArtifacts: [],
    normalized: { fields: {} },
    provenance: {},
    candidates: {},
    logger: makeMockLogger(),
    markdownSummary: '',
    rowTsv: '',
    runtimeFieldRulesEngine: null,
    fieldOrder: [],
    runtimeEvidencePack: null,
    trafficLight: {},
    persistLearningProfile: async () => null,
    exportRunArtifacts: async () => ({ key: 'test-export' }),
    writeFinalOutputs: async () => ({ key: 'test-final' }),
    writeProductReviewArtifacts: async () => ({
      keys: { candidatesKey: 'k1', reviewQueueKey: 'k2' },
      candidate_count: 5,
      review_field_count: 3
    }),
    writeCategoryReviewArtifacts: async () => ({ key: 'k3', count: 10 })
  });

  assert.ok(result.exportInfo, 'should return exportInfo');
  assert.ok(result.finalExport, 'should return finalExport');
  assert.equal(result.learning, null, 'learning should be null when disabled');
});

test('runLearningExportPhase calls persistLearningProfile when selfImproveEnabled', async () => {
  let persistCalled = false;
  const summary = {};
  const result = await runLearningExportPhase({
    config: makeConfig({ selfImproveEnabled: true }),
    storage: makeMockStorage(),
    category: 'mouse',
    productId: 'mouse-test-1',
    runId: 'run-001',
    job: { identityLock: {} },
    sourceResults: [],
    summary,
    learningProfile: null,
    discoveryResult: null,
    runBase: '',
    artifactsByHost: {},
    adapterArtifacts: [],
    normalized: { fields: {} },
    provenance: {},
    candidates: {},
    logger: makeMockLogger(),
    markdownSummary: '',
    rowTsv: '',
    runtimeFieldRulesEngine: null,
    fieldOrder: [],
    runtimeEvidencePack: null,
    trafficLight: {},
    persistLearningProfile: async () => {
      persistCalled = true;
      return { profileKey: 'pk1', learningRunKey: 'lrk1' };
    },
    exportRunArtifacts: async () => ({ key: 'test-export' }),
    writeFinalOutputs: async () => ({ key: 'test-final' }),
    writeProductReviewArtifacts: async () => ({
      keys: { candidatesKey: 'k1', reviewQueueKey: 'k2' },
      candidate_count: 5,
      review_field_count: 3
    }),
    writeCategoryReviewArtifacts: async () => ({ key: 'k3', count: 10 })
  });

  assert.ok(persistCalled, 'persistLearningProfile should be called');
  assert.deepStrictEqual(summary.learning, {
    profile_key: 'pk1',
    run_log_key: 'lrk1'
  });
  assert.deepStrictEqual(result.learning, { profileKey: 'pk1', learningRunKey: 'lrk1' });
});

test('runLearningExportPhase populates summary.review_artifacts', async () => {
  const summary = {};
  await runLearningExportPhase({
    config: makeConfig(),
    storage: makeMockStorage(),
    category: 'mouse',
    productId: 'mouse-test-1',
    runId: 'run-001',
    job: { identityLock: {} },
    sourceResults: [],
    summary,
    learningProfile: null,
    discoveryResult: null,
    runBase: '',
    artifactsByHost: {},
    adapterArtifacts: [],
    normalized: { fields: {} },
    provenance: {},
    candidates: {},
    logger: makeMockLogger(),
    markdownSummary: '',
    rowTsv: '',
    runtimeFieldRulesEngine: null,
    fieldOrder: [],
    runtimeEvidencePack: null,
    trafficLight: {},
    persistLearningProfile: async () => null,
    exportRunArtifacts: async () => ({ key: 'test-export' }),
    writeFinalOutputs: async () => ({ key: 'test-final' }),
    writeProductReviewArtifacts: async () => ({
      keys: { candidatesKey: 'k1', reviewQueueKey: 'k2' },
      candidate_count: 5,
      review_field_count: 3
    }),
    writeCategoryReviewArtifacts: async () => ({ key: 'k3', count: 10 })
  });

  assert.deepStrictEqual(summary.review_artifacts, {
    product_review_candidates_key: 'k1',
    product_review_queue_key: 'k2',
    category_review_queue_key: 'k3',
    candidate_count: 5,
    review_field_count: 3,
    queue_count: 10
  });
});

test('runLearningExportPhase handles review artifact errors gracefully', async () => {
  const summary = {};
  const logger = makeMockLogger();
  await runLearningExportPhase({
    config: makeConfig(),
    storage: makeMockStorage(),
    category: 'mouse',
    productId: 'mouse-test-1',
    runId: 'run-001',
    job: { identityLock: {} },
    sourceResults: [],
    summary,
    learningProfile: null,
    discoveryResult: null,
    runBase: '',
    artifactsByHost: {},
    adapterArtifacts: [],
    normalized: { fields: {} },
    provenance: {},
    candidates: {},
    logger,
    markdownSummary: '',
    rowTsv: '',
    runtimeFieldRulesEngine: null,
    fieldOrder: [],
    runtimeEvidencePack: null,
    trafficLight: {},
    persistLearningProfile: async () => null,
    exportRunArtifacts: async () => ({ key: 'test-export' }),
    writeFinalOutputs: async () => ({ key: 'test-final' }),
    writeProductReviewArtifacts: async () => { throw new Error('review write boom'); },
    writeCategoryReviewArtifacts: async () => ({ key: 'k3', count: 10 })
  });

  assert.ok(summary.review_artifacts.error, 'should capture error in summary');
  assert.equal(summary.review_artifacts.error, 'review write boom');
});

test('runLearningExportPhase populates summary.final_export', async () => {
  const summary = {};
  await runLearningExportPhase({
    config: makeConfig(),
    storage: makeMockStorage(),
    category: 'mouse',
    productId: 'mouse-test-1',
    runId: 'run-001',
    job: { identityLock: {} },
    sourceResults: [],
    summary,
    learningProfile: null,
    discoveryResult: null,
    runBase: '',
    artifactsByHost: {},
    adapterArtifacts: [],
    normalized: { fields: {} },
    provenance: {},
    candidates: {},
    logger: makeMockLogger(),
    markdownSummary: '',
    rowTsv: '',
    runtimeFieldRulesEngine: null,
    fieldOrder: [],
    runtimeEvidencePack: null,
    trafficLight: {},
    persistLearningProfile: async () => null,
    exportRunArtifacts: async () => ({ key: 'test-export' }),
    writeFinalOutputs: async () => ({ final_key: 'fk1' }),
    writeProductReviewArtifacts: async () => ({
      keys: { candidatesKey: 'k1', reviewQueueKey: 'k2' },
      candidate_count: 0,
      review_field_count: 0
    }),
    writeCategoryReviewArtifacts: async () => ({ key: 'k3', count: 0 })
  });

  assert.deepStrictEqual(summary.final_export, { final_key: 'fk1' });
});
