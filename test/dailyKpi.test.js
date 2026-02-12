import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDailyFastPassKpi } from '../src/reports/dailyKpi.js';

function makeStorage() {
  const map = new Map();
  return {
    map,
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
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

test('updateDailyFastPassKpi writes and rolls up daily metrics', async () => {
  const storage = makeStorage();
  const first = await updateDailyFastPassKpi({
    storage,
    category: 'mouse',
    date: '2026-02-10T12:00:00.000Z',
    runResult: {
      productId: 'mouse-a',
      final_run_id: 'run-a',
      stop_reason: 'complete',
      rounds: [
        {
          round: 0,
          missing_required_count: 0,
          llm_cost_usd_run: 0.0012,
          urls_fetched_count: 7
        }
      ],
      final_summary: {
        missing_required_fields: [],
        field_reasoning: {
          weight: { unknown_reason: null }
        }
      }
    }
  });

  assert.ok(first.key.endsWith('/_reports/daily/2026-02-10/mouse.json'));
  assert.equal(first.report.totals.products_run, 1);
  assert.equal(first.report.fast_pass.success_count, 1);

  const second = await updateDailyFastPassKpi({
    storage,
    category: 'mouse',
    date: '2026-02-10T13:00:00.000Z',
    runResult: {
      productId: 'mouse-b',
      final_run_id: 'run-b',
      stop_reason: 'required_search_exhausted_no_new_fields',
      rounds: [
        {
          round: 0,
          missing_required_count: 2,
          llm_cost_usd_run: 0,
          urls_fetched_count: 4
        }
      ],
      final_summary: {
        missing_required_fields: ['fields.weight'],
        field_reasoning: {
          weight: { unknown_reason: 'parse_failure' }
        }
      }
    }
  });

  assert.equal(second.report.totals.products_run, 2);
  assert.equal(second.report.fast_pass.attempts, 2);
  assert.equal(second.report.fast_pass.success_count, 1);
  assert.equal(second.report.latest_runs.length, 2);
  assert.equal(second.report.final.avg_unknown_due_weakness_count > 0, true);
});
