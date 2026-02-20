import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFieldBatches,
  resolveBatchModel
} from '../src/llm/fieldBatching.js';

test('buildFieldBatches groups fields into at most seven batches', () => {
  const fields = [
    'brand', 'model', 'sku',
    'weight', 'lngth', 'width', 'height',
    'sensor', 'dpi', 'ips', 'acceleration', 'polling_rate',
    'switch', 'side_buttons',
    'connection', 'bluetooth',
    'sensor_latency', 'click_latency',
    'rgb', 'onboard_memory', 'coating'
  ];

  const batches = buildFieldBatches({
    targetFields: fields,
    maxBatches: 7,
    fieldRules: {
      sensor_latency: { priority: { required_level: 'expected', difficulty: 'instrumented' } },
      click_latency: { priority: { required_level: 'expected', difficulty: 'hard' } },
      coating: { priority: { required_level: 'expected', difficulty: 'easy' } }
    }
  });

  assert.equal(Array.isArray(batches), true);
  assert.equal(batches.length <= 7, true);
  assert.equal(batches.flatMap((row) => row.fields).includes('sensor_latency'), true);
  assert.equal(batches.flatMap((row) => row.fields).includes('weight'), true);
});

test('resolveBatchModel routes hard/instrumented batches to reasoning model', () => {
  const easy = resolveBatchModel({
    batch: {
      id: 'physical',
      fields: ['weight'],
      difficulty: { hard: 0, instrumented: 0 }
    },
    config: {
      llmModelFast: 'gemini-2.0-flash',
      llmModelExtract: 'deepseek-reasoner'
    }
  });
  assert.equal(easy.model, 'gemini-2.0-flash');
  assert.equal(easy.reasoningMode, false);

  const hard = resolveBatchModel({
    batch: {
      id: 'lab_measured',
      fields: ['sensor_latency'],
      difficulty: { hard: 0, instrumented: 1 }
    },
    config: {
      llmModelFast: 'gemini-2.0-flash',
      llmModelExtract: 'deepseek-reasoner'
    }
  });
  assert.equal(hard.model, 'deepseek-reasoner');
  assert.equal(hard.reasoningMode, true);
});

test('resolveBatchModel supports runtime forced-high field escalation', () => {
  const forced = resolveBatchModel({
    batch: {
      id: 'physical',
      fields: ['weight'],
      difficulty: { hard: 0, instrumented: 0 }
    },
    config: {
      llmModelFast: 'gpt-5-low',
      llmModelReasoning: 'gpt-5-high'
    },
    forcedHighFields: ['weight']
  });
  assert.equal(forced.model, 'gpt-5-high');
  assert.equal(forced.reasoningMode, true);
  assert.equal(forced.reason, 'extract_forced_high_batch');
});
