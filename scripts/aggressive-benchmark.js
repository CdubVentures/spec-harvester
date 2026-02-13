#!/usr/bin/env node
import path from 'node:path';
import { loadDotEnvFile, loadConfig } from '../src/config.js';
import { createStorage } from '../src/s3/storage.js';
import { runUntilComplete } from '../src/runner/runUntilComplete.js';

function parseArgs(argv = []) {
  const out = {};
  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = String(argv[idx] || '');
    if (!token.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[idx + 1];
    if (!next || String(next).startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = String(next);
    idx += 1;
  }
  return out;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBrand(value) {
  return String(value || '').trim().toLowerCase();
}

function pickBetterJob(existing, candidate) {
  if (!existing) {
    return candidate;
  }
  const existingVariant = String(existing?.identityLock?.variant || '').trim();
  const candidateVariant = String(candidate?.identityLock?.variant || '').trim();
  if (!existingVariant && candidateVariant) {
    return existing;
  }
  if (existingVariant && !candidateVariant) {
    return candidate;
  }
  if (String(candidate.productId || '').length < String(existing.productId || '').length) {
    return candidate;
  }
  return existing;
}

async function selectProducts({
  storage,
  category,
  count
}) {
  const preferredBrands = [
    'razer',
    'logitech',
    'corsair',
    'alienware',
    'asus',
    'cooler master',
    'pulsar',
    'steelseries',
    'glorious',
    'endgame'
  ];
  const keys = await storage.listInputKeys(category);
  const dedupedByBrandModel = new Map();

  for (const key of keys) {
    const job = await storage.readJsonOrNull(key);
    if (!job?.productId) {
      continue;
    }
    const brand = String(job?.identityLock?.brand || '').trim();
    const model = String(job?.identityLock?.model || '').trim();
    if (!brand || !model) {
      continue;
    }
    const mapKey = `${normalizeBrand(brand)}::${model.toLowerCase()}`;
    const existing = dedupedByBrandModel.get(mapKey);
    dedupedByBrandModel.set(mapKey, pickBetterJob(existing, {
      ...job,
      s3key: key
    }));
  }

  const rows = [...dedupedByBrandModel.values()];
  const preferred = [];
  const fallback = [];
  for (const row of rows) {
    const brand = normalizeBrand(row?.identityLock?.brand);
    if (preferredBrands.includes(brand)) {
      preferred.push(row);
    } else {
      fallback.push(row);
    }
  }
  preferred.sort((a, b) => String(a.productId || '').localeCompare(String(b.productId || '')));
  fallback.sort((a, b) => String(a.productId || '').localeCompare(String(b.productId || '')));
  return [...preferred, ...fallback].slice(0, Math.max(1, count));
}

function formatDurationMs(durationMs) {
  const seconds = Math.round(Number(durationMs || 0) / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

async function runWithConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function runWorker() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) {
        return;
      }
      out[idx] = await worker(items[idx], idx);
    }
  }
  const count = Math.max(1, concurrency);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnvFile(args.env || '.env');
  const category = String(args.category || 'mouse').trim();
  const products = Math.max(1, toInt(args.products, 20));
  const maxRounds = Math.max(1, toInt(args['max-rounds'], 4));
  const mode = String(args.mode || 'aggressive').trim().toLowerCase();
  const concurrency = Math.max(1, toInt(args.concurrency, 2));
  const maxRunSeconds = Math.max(120, toInt(args['max-run-seconds'], 900));
  const config = loadConfig({
    localMode: true,
    outputMode: 'local',
    maxRunSeconds,
    concurrency
  });
  const storage = createStorage(config);
  const selected = await selectProducts({
    storage,
    category,
    count: products
  });

  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  process.stdout.write(
    `Benchmark start ${startedAt} | category=${category} products=${selected.length} mode=${mode} max_rounds=${maxRounds} concurrency=${concurrency} max_run_seconds=${maxRunSeconds}\n`
  );

  const results = await runWithConcurrency(selected, concurrency, async (job, idx) => {
    const itemStart = Date.now();
    process.stdout.write(`[${idx + 1}/${selected.length}] start ${job.productId}\n`);
    try {
      const completed = await runUntilComplete({
        storage,
        config,
        s3key: job.s3key,
        maxRounds,
        mode
      });
      const runId = String(completed.final_run_id || '').trim();
      const summaryKey = runId
        ? path.posix.join(config.s3OutputPrefix, category, job.productId, 'runs', runId, 'logs', 'summary.json')
        : null;
      const summary = summaryKey ? (await storage.readJsonOrNull(summaryKey)) : null;
      const llm = summary?.llm || {};
      const elapsedMs = Date.now() - itemStart;
      const row = {
        product_id: job.productId,
        s3key: job.s3key,
        elapsed_ms: elapsedMs,
        elapsed_human: formatDurationMs(elapsedMs),
        complete: Boolean(completed.complete),
        exhausted: Boolean(completed.exhausted),
        stop_reason: completed.stop_reason || null,
        round_count: Number(completed.round_count || 0),
        final_run_id: completed.final_run_id || null,
        validated: Boolean(completed?.final_summary?.validated),
        confidence: toFloat(completed?.final_summary?.confidence, 0),
        missing_required_count: Array.isArray(completed?.final_summary?.missing_required_fields)
          ? completed.final_summary.missing_required_fields.length
          : null,
        critical_missing_count: Array.isArray(completed?.final_summary?.critical_fields_below_pass_target)
          ? completed.final_summary.critical_fields_below_pass_target.length
          : null,
        llm_call_count_run: Number(llm.call_count_run || 0),
        llm_cost_usd_run: toFloat(llm.cost_usd_run, 0),
        llm_verify_trigger: llm.verify_trigger || null,
        llm_verify_performed: Boolean(llm.verify_performed),
        aggressive_stage: summary?.aggressive_extraction?.stage || null
      };
      process.stdout.write(
        `[${idx + 1}/${selected.length}] done ${job.productId} | rounds=${row.round_count} validated=${row.validated} llm_calls=${row.llm_call_count_run} time=${row.elapsed_human}\n`
      );
      return row;
    } catch (error) {
      const elapsedMs = Date.now() - itemStart;
      process.stdout.write(
        `[${idx + 1}/${selected.length}] fail ${job.productId} | ${error.message}\n`
      );
      return {
        product_id: job.productId,
        s3key: job.s3key,
        elapsed_ms: elapsedMs,
        elapsed_human: formatDurationMs(elapsedMs),
        error: error.message
      };
    }
  });

  const durationMs = Date.now() - startMs;
  const successes = results.filter((row) => !row.error);
  const failures = results.filter((row) => row.error);
  const validatedCount = successes.filter((row) => row.validated).length;
  const completedCount = successes.filter((row) => row.complete).length;
  const totalLlmCalls = successes.reduce((sum, row) => sum + Number(row.llm_call_count_run || 0), 0);
  const totalLlmCost = successes.reduce((sum, row) => sum + toFloat(row.llm_cost_usd_run, 0), 0);
  const avgSeconds = successes.length > 0
    ? (successes.reduce((sum, row) => sum + Number(row.elapsed_ms || 0), 0) / successes.length) / 1000
    : 0;

  const report = {
    generated_at: new Date().toISOString(),
    category,
    mode,
    max_rounds: maxRounds,
    concurrency,
    selected_count: selected.length,
    duration_ms: durationMs,
    duration_human: formatDurationMs(durationMs),
    completed_count: completedCount,
    validated_count: validatedCount,
    failure_count: failures.length,
    total_llm_calls: totalLlmCalls,
    total_llm_cost_usd: Number(totalLlmCost.toFixed(6)),
    avg_seconds_per_product: Number(avgSeconds.toFixed(2)),
    results
  };

  const reportTs = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const reportKey = path.posix.join(config.s3OutputPrefix, '_reports', 'benchmarks', `aggressive_${category}_${reportTs}.json`);
  await storage.writeObject(
    reportKey,
    Buffer.from(JSON.stringify(report, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );

  process.stdout.write(
    `Benchmark done | duration=${report.duration_human} validated=${validatedCount}/${selected.length} completed=${completedCount}/${selected.length} failures=${failures.length} llm_calls=${totalLlmCalls} cost=$${report.total_llm_cost_usd}\n`
  );
  process.stdout.write(`Report key: ${reportKey}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
