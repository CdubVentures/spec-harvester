#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { createStorage } from '../s3/storage.js';
import { runProduct } from '../pipeline/runProduct.js';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const config = loadConfig({
    localMode: true,
    dryRun: true,
    localInputRoot: 'sample_inputs',
    localOutputRoot: 'out',
    writeMarkdownSummary: false,
    discoveryEnabled: false
  });

  const storage = createStorage(config);
  const s3Key = 'specs/inputs/mouse/products/mouse-smoke-validation.json';
  const result = await runProduct({ storage, config, s3Key });

  const normalizedOutPath = path.resolve('out', 'normalized', 'spec.normalized.json');
  const summaryOutPath = path.resolve('out', 'logs', 'summary.json');

  await fs.mkdir(path.dirname(normalizedOutPath), { recursive: true });
  await fs.mkdir(path.dirname(summaryOutPath), { recursive: true });

  await fs.writeFile(normalizedOutPath, JSON.stringify(result.normalized, null, 2));
  await fs.writeFile(summaryOutPath, JSON.stringify(result.summary, null, 2));

  assert(result.summary.validated === false, 'Smoke assertion failed: expected validated=false');
  assert(
    result.summary.validated_reason === 'BELOW_CONFIDENCE_THRESHOLD',
    `Smoke assertion failed: expected BELOW_CONFIDENCE_THRESHOLD, got ${result.summary.validated_reason}`
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        smoke: 'local',
        productId: result.productId,
        runId: result.runId,
        validated: result.summary.validated,
        validated_reason: result.summary.validated_reason,
        confidence: result.summary.confidence,
        completeness_required_percent: result.summary.completeness_required_percent,
        coverage_overall_percent: result.summary.coverage_overall_percent,
        normalized_out: normalizedOutPath,
        summary_out: summaryOutPath
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
