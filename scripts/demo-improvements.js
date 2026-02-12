#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseJsonOutput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('Unable to parse CLI JSON output');
  }
}

function runCli(args) {
  const startedAt = Date.now();
  const proc = spawnSync('node', ['src/cli/spec.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  const durationMs = Date.now() - startedAt;
  if (proc.status !== 0) {
    throw new Error(
      `Command failed (${proc.status}): node src/cli/spec.js ${args.join(' ')}\n${proc.stderr || proc.stdout}`
    );
  }
  return {
    durationMs,
    output: parseJsonOutput(proc.stdout)
  };
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
  const category = process.argv[2] || 'mouse';
  const brand = process.argv[3] || 'Logitech';
  const model = process.argv[4] || 'G Pro X Superlight 2';

  const thorough = runCli([
    'run-ad-hoc',
    category,
    brand,
    model,
    '--until-complete',
    '--mode',
    'aggressive',
    '--max-rounds',
    '2',
    '--profile',
    'thorough',
    '--no-llm',
    '--local',
    '--dry-run'
  ]);

  const thoroughOut = thorough.output || {};
  const replaySourceRunId = String(thoroughOut.final_run_id || '').trim();
  const productId = String(thoroughOut.productId || '').trim();
  if (!replaySourceRunId || !productId) {
    throw new Error('Demo run did not return productId/final_run_id required for replay');
  }

  const replay = runCli([
    'replay-run',
    '--category',
    category,
    '--product-id',
    productId,
    '--run-id',
    replaySourceRunId,
    '--local',
    '--no-llm'
  ]);

  const replayOut = replay.output || {};
  const finalSummary = thoroughOut.final_summary || {};
  const missingRequiredCount = Array.isArray(finalSummary.missing_required_fields)
    ? finalSummary.missing_required_fields.length
    : 0;
  const requiredCompletionRate = missingRequiredCount === 0 ? 1 : 0;
  const weakUnknownThorough = toNumber(
    Object.values(finalSummary.field_reasoning || {}).filter(
      (row) => ['parse_failure', 'not_found_after_search'].includes(String(row?.unknown_reason || ''))
    ).length,
    0
  );
  const weakUnknownReplay = toNumber(replayOut.unknown_due_weakness_count, 0);
  const replayDurationMs = toNumber(replayOut.duration_ms, replay.durationMs);
  const thoroughDurationMs = thorough.durationMs;
  const speedup = replayDurationMs > 0 ? thoroughDurationMs / replayDurationMs : 0;

  const report = {
    generated_at: new Date().toISOString(),
    category,
    product_id: productId,
    baseline_run_id: replaySourceRunId,
    replay_run_id: replayOut.runId || null,
    metrics: {
      required_fields_completion_rate: requiredCompletionRate,
      average_time_per_product_ms: {
        thorough: thoroughDurationMs,
        replay: replayDurationMs
      },
      average_llm_cost_per_product_usd: {
        thorough: toNumber(finalSummary?.llm?.cost_usd_run, 0),
        replay: 0
      },
      unknown_due_to_weakness_count: {
        thorough: weakUnknownThorough,
        replay: weakUnknownReplay,
        improvement: weakUnknownThorough - weakUnknownReplay
      },
      dev_cycle_speedup_x: toNumber(speedup, 0)
    }
  };

  const outPath = path.resolve('out', '_reports', 'demo', 'demo-improvements.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify({ out_path: outPath, report }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
