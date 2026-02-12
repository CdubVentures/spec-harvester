import { toPosixKey } from '../s3/storage.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
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

function parseSizes(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  const parsed = raw
    .map((value) => toInt(value, 0))
    .filter((value) => value > 0);
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [100, 500, 1000];
}

export function aggregateScaleMetrics(rows = []) {
  const total = rows.length;
  const validated = rows.filter((row) => row.validated).length;
  const requiredComplete = rows.filter((row) => row.missing_required_count === 0).length;
  const avgMissingRequired = total > 0
    ? rows.reduce((sum, row) => sum + row.missing_required_count, 0) / total
    : 0;
  const avgUnknownWeakness = total > 0
    ? rows.reduce((sum, row) => sum + row.unknown_due_weakness_count, 0) / total
    : 0;
  const avgConfidence = total > 0
    ? rows.reduce((sum, row) => sum + row.confidence, 0) / total
    : 0;
  const avgCoverage = total > 0
    ? rows.reduce((sum, row) => sum + row.coverage_overall, 0) / total
    : 0;
  const avgLlmCost = total > 0
    ? rows.reduce((sum, row) => sum + row.llm_cost_usd_run, 0) / total
    : 0;

  return {
    total_products: total,
    validated_count: validated,
    validated_rate: total > 0 ? round(validated / total, 6) : 0,
    required_complete_count: requiredComplete,
    required_complete_rate: total > 0 ? round(requiredComplete / total, 6) : 0,
    avg_missing_required_count: round(avgMissingRequired, 6),
    avg_unknown_due_weakness_count: round(avgUnknownWeakness, 6),
    avg_confidence: round(avgConfidence, 6),
    avg_coverage_overall: round(avgCoverage, 6),
    avg_llm_cost_usd_run: round(avgLlmCost, 8)
  };
}

async function readLatestSummary(storage, category, productId) {
  const summaryKey = storage.resolveOutputKey(category, productId, 'latest', 'summary.json');
  const summary = await storage.readJsonOrNull(summaryKey);
  return summary && typeof summary === 'object' ? summary : null;
}

function rowFromSummary({ productId, summary }) {
  return {
    product_id: productId,
    validated: Boolean(summary?.validated),
    confidence: toNumber(summary?.confidence, 0),
    coverage_overall: toNumber(summary?.coverage_overall, 0),
    completeness_required: toNumber(summary?.completeness_required, 0),
    missing_required_count: toArray(summary?.missing_required_fields).length,
    critical_missing_count: toArray(summary?.critical_fields_below_pass_target).length,
    unknown_due_weakness_count: unknownWeaknessCount(summary),
    llm_cost_usd_run: toNumber(summary?.llm?.cost_usd_run, 0),
    run_profile: String(summary?.run_profile || ''),
    validated_reason: String(summary?.validated_reason || summary?.reason || ''),
    summary_generated_at: String(summary?.generated_at || '')
  };
}

export async function buildScaleBenchmarkReport({
  storage,
  category,
  sizes = [100, 500, 1000]
}) {
  const normalizedSizes = parseSizes(sizes);
  const keys = await storage.listInputKeys(category);
  const productIds = keys
    .map((key) => String(key || ''))
    .filter((key) => key.endsWith('.json'))
    .map((key) => key.split('/').pop()?.replace(/\.json$/i, '') || '')
    .filter(Boolean)
    .sort();

  const rows = [];
  for (const productId of productIds) {
    const summary = await readLatestSummary(storage, category, productId);
    if (!summary) {
      continue;
    }
    rows.push(rowFromSummary({ productId, summary }));
  }

  const byScale = {};
  for (const size of normalizedSizes) {
    byScale[String(size)] = aggregateScaleMetrics(rows.slice(0, Math.min(size, rows.length)));
  }

  return {
    category,
    generated_at: new Date().toISOString(),
    input_product_count: productIds.length,
    products_with_latest_summary: rows.length,
    scales: normalizedSizes,
    by_scale: byScale,
    sample_rows: rows.slice(0, 50)
  };
}

export async function writeScaleBenchmarkReport({
  storage,
  config,
  category,
  report
}) {
  const date = new Date().toISOString().slice(0, 10);
  const key = storage.resolveOutputKey('_reports', 'scale', date, `${category}.json`);
  await storage.writeObject(
    key,
    Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  return {
    key: toPosixKey(key),
    report
  };
}
