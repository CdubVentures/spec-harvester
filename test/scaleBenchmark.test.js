import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateScaleMetrics,
  buildScaleBenchmarkReport,
  writeScaleBenchmarkReport
} from '../src/benchmark/scaleBenchmark.js';

function toBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}

function makeStorage(initial = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(initial)) {
    map.set(key, toBuffer(value));
  }

  return {
    map,
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    },
    async listInputKeys(category) {
      const prefix = `specs/inputs/${category}/products/`;
      return [...map.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort();
    },
    async readJsonOrNull(key) {
      const row = map.get(key);
      return row ? JSON.parse(row.toString('utf8')) : null;
    },
    async writeObject(key, body) {
      map.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
    }
  };
}

test('aggregateScaleMetrics computes required completion and averages', () => {
  const result = aggregateScaleMetrics([
    {
      validated: true,
      missing_required_count: 0,
      unknown_due_weakness_count: 0,
      confidence: 0.92,
      coverage_overall: 0.9,
      llm_cost_usd_run: 0.0012
    },
    {
      validated: false,
      missing_required_count: 2,
      unknown_due_weakness_count: 1,
      confidence: 0.44,
      coverage_overall: 0.5,
      llm_cost_usd_run: 0
    }
  ]);

  assert.equal(result.total_products, 2);
  assert.equal(result.required_complete_count, 1);
  assert.equal(result.required_complete_rate, 0.5);
  assert.equal(result.avg_missing_required_count, 1);
  assert.equal(result.avg_unknown_due_weakness_count, 0.5);
});

test('buildScaleBenchmarkReport reads latest summaries and writes benchmark report', async () => {
  const storage = makeStorage({
    'specs/inputs/mouse/products/mouse-a.json': JSON.stringify({ productId: 'mouse-a' }),
    'specs/inputs/mouse/products/mouse-b.json': JSON.stringify({ productId: 'mouse-b' }),
    'specs/outputs/mouse/mouse-a/latest/summary.json': JSON.stringify({
      validated: true,
      confidence: 0.91,
      coverage_overall: 0.88,
      completeness_required: 1,
      missing_required_fields: [],
      critical_fields_below_pass_target: [],
      field_reasoning: {
        weight: { unknown_reason: null }
      },
      llm: { cost_usd_run: 0.0011 }
    }),
    'specs/outputs/mouse/mouse-b/latest/summary.json': JSON.stringify({
      validated: false,
      confidence: 0.52,
      coverage_overall: 0.61,
      completeness_required: 0.5,
      missing_required_fields: ['fields.weight'],
      critical_fields_below_pass_target: ['fields.weight'],
      field_reasoning: {
        weight: { unknown_reason: 'parse_failure' }
      },
      llm: { cost_usd_run: 0 }
    })
  });

  const report = await buildScaleBenchmarkReport({
    storage,
    category: 'mouse',
    sizes: '1,2'
  });

  assert.equal(report.input_product_count, 2);
  assert.equal(report.products_with_latest_summary, 2);
  assert.deepEqual(report.scales, [1, 2]);
  assert.equal(report.by_scale['1'].total_products, 1);
  assert.equal(report.by_scale['2'].total_products, 2);

  const written = await writeScaleBenchmarkReport({
    storage,
    config: {},
    category: 'mouse',
    report
  });
  assert.equal(written.key.includes('/_reports/scale/'), true);
  assert.equal(storage.map.has(written.key), true);
});
