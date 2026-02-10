import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCostLedgerEntry,
  buildBillingReport,
  readBillingSnapshot
} from '../src/billing/costLedger.js';
import { computeLlmCostUsd, normalizeUsage } from '../src/billing/costRates.js';

function makeMemoryStorage() {
  const map = new Map();

  return {
    resolveOutputKey(...parts) {
      return ['specs/outputs', ...parts].join('/');
    },
    async readTextOrNull(key) {
      const row = map.get(key);
      return row ? row.toString('utf8') : null;
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

test('cost ledger appends entries and rolls up month totals', async () => {
  const storage = makeMemoryStorage();
  const config = {
    s3OutputPrefix: 'specs/outputs'
  };

  const usage1 = normalizeUsage({
    prompt_tokens: 1200,
    completion_tokens: 400
  });
  const usage2 = normalizeUsage({
    prompt_tokens: 1000,
    completion_tokens: 300
  });

  const cost1 = computeLlmCostUsd({
    usage: usage1,
    rates: {
      llmCostInputPer1M: 0.28,
      llmCostOutputPer1M: 0.42
    }
  }).costUsd;
  const cost2 = computeLlmCostUsd({
    usage: usage2,
    rates: {
      llmCostInputPer1M: 0.28,
      llmCostOutputPer1M: 0.42
    }
  }).costUsd;

  await appendCostLedgerEntry({
    storage,
    config,
    entry: {
      ts: '2026-02-09T01:00:00.000Z',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      category: 'mouse',
      productId: 'mouse-a',
      runId: 'run-a',
      reason: 'extract',
      prompt_tokens: usage1.promptTokens,
      completion_tokens: usage1.completionTokens,
      total_tokens: usage1.totalTokens,
      cost_usd: cost1
    }
  });
  await appendCostLedgerEntry({
    storage,
    config,
    entry: {
      ts: '2026-02-09T01:30:00.000Z',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      category: 'mouse',
      productId: 'mouse-a',
      runId: 'run-b',
      reason: 'plan',
      prompt_tokens: usage2.promptTokens,
      completion_tokens: usage2.completionTokens,
      total_tokens: usage2.totalTokens,
      cost_usd: cost2
    }
  });

  const snapshot = await readBillingSnapshot({
    storage,
    month: '2026-02',
    productId: 'mouse-a'
  });
  assert.equal(snapshot.monthly_calls, 2);
  assert.equal(snapshot.product_calls, 2);
  assert.equal(snapshot.monthly_cost_usd > 0, true);
  assert.equal(snapshot.product_cost_usd > 0, true);

  const report = await buildBillingReport({
    storage,
    month: '2026-02'
  });
  assert.equal(report.totals.calls, 2);
  assert.equal(report.by_category.mouse.calls, 2);
  assert.equal(report.by_product['mouse-a'].calls, 2);
  assert.equal(report.by_reason.extract.calls, 1);
  assert.equal(report.by_reason.plan.calls, 1);
});
