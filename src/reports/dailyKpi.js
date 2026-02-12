function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function toDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function unknownWeaknessCount(summary = {}) {
  const weakReasons = new Set([
    'parse_failure',
    'not_found_after_search'
  ]);
  let count = 0;
  for (const row of Object.values(summary?.field_reasoning || {})) {
    const reason = String(row?.unknown_reason || '').trim();
    if (weakReasons.has(reason)) {
      count += 1;
    }
  }
  return count;
}

function defaultReport({ category, dateKey }) {
  return {
    category,
    date: dateKey,
    updated_at: new Date().toISOString(),
    totals: {
      products_run: 0,
      avg_round_count: 0
    },
    fast_pass: {
      attempts: 0,
      success_count: 0,
      success_rate: 0,
      avg_cost_usd: 0,
      avg_urls_fetched: 0
    },
    final: {
      avg_missing_required_count: 0,
      avg_unknown_due_weakness_count: 0
    },
    latest_runs: []
  };
}

function runningAverage(currentAvg, currentCount, nextValue) {
  const base = Number(currentAvg || 0);
  const count = Math.max(0, Number.parseInt(String(currentCount || 0), 10) || 0);
  const value = Number(nextValue || 0);
  return round(((base * count) + value) / Math.max(1, count + 1), 8);
}

export async function updateDailyFastPassKpi({
  storage,
  category,
  runResult,
  date = new Date()
}) {
  const dateKey = toDateKey(date);
  const key = storage.resolveOutputKey('_reports', 'daily', dateKey, `${category}.json`);
  const existing = await storage.readJsonOrNull(key);
  const report = existing && typeof existing === 'object'
    ? existing
    : defaultReport({ category, dateKey });

  const rounds = toArray(runResult?.rounds);
  const round0 = rounds.find((row) => Number.parseInt(String(row?.round || 0), 10) === 0) || null;
  const finalSummary = runResult?.final_summary || {};
  const fastPassAttempt = round0 !== null;
  const fastPassSuccess = fastPassAttempt && Number(round0.missing_required_count || 0) === 0;
  const fastPassCostUsd = Number(round0?.llm_cost_usd_run || 0);
  const fastPassUrlsFetched = Number(round0?.urls_fetched_count || 0);
  const finalMissingRequired = toArray(finalSummary?.missing_required_fields).length;
  const finalWeakUnknown = unknownWeaknessCount(finalSummary);

  const previousTotal = Number.parseInt(String(report.totals?.products_run || 0), 10) || 0;
  const previousFastAttempts = Number.parseInt(String(report.fast_pass?.attempts || 0), 10) || 0;

  report.updated_at = new Date().toISOString();
  report.totals = report.totals || {};
  report.fast_pass = report.fast_pass || {};
  report.final = report.final || {};
  report.latest_runs = toArray(report.latest_runs);

  report.totals.avg_round_count = runningAverage(
    report.totals.avg_round_count,
    previousTotal,
    rounds.length
  );
  report.totals.products_run = previousTotal + 1;

  if (fastPassAttempt) {
    report.fast_pass.avg_cost_usd = runningAverage(
      report.fast_pass.avg_cost_usd,
      previousFastAttempts,
      fastPassCostUsd
    );
    report.fast_pass.avg_urls_fetched = runningAverage(
      report.fast_pass.avg_urls_fetched,
      previousFastAttempts,
      fastPassUrlsFetched
    );
  }
  report.fast_pass.attempts = previousFastAttempts + (fastPassAttempt ? 1 : 0);
  report.fast_pass.success_count =
    (Number.parseInt(String(report.fast_pass.success_count || 0), 10) || 0) +
    (fastPassSuccess ? 1 : 0);
  report.fast_pass.success_rate = report.fast_pass.attempts > 0
    ? round(report.fast_pass.success_count / report.fast_pass.attempts, 6)
    : 0;

  report.final.avg_missing_required_count = runningAverage(
    report.final.avg_missing_required_count,
    previousTotal,
    finalMissingRequired
  );
  report.final.avg_unknown_due_weakness_count = runningAverage(
    report.final.avg_unknown_due_weakness_count,
    previousTotal,
    finalWeakUnknown
  );

  report.latest_runs.unshift({
    ts: new Date().toISOString(),
    product_id: runResult?.productId || '',
    final_run_id: runResult?.final_run_id || null,
    round_count: rounds.length,
    fast_pass_success: fastPassSuccess,
    fast_pass_cost_usd: round(fastPassCostUsd, 8),
    fast_pass_urls_fetched: fastPassUrlsFetched,
    final_missing_required_count: finalMissingRequired,
    final_unknown_due_weakness_count: finalWeakUnknown,
    stop_reason: runResult?.stop_reason || null
  });
  report.latest_runs = report.latest_runs.slice(0, 200);

  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );

  return {
    key,
    report
  };
}
