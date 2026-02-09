#!/usr/bin/env node
import { loadConfig } from '../config.js';
import { createStorage } from '../s3/storage.js';
import { parseArgs, asBool } from './args.js';
import { runProduct } from '../pipeline/runProduct.js';

async function filterKeysByBrand(storage, keys, brand) {
  if (!brand) {
    return keys;
  }

  const out = [];
  const expected = String(brand).trim().toLowerCase();
  for (const key of keys) {
    try {
      const job = await storage.readJson(key);
      const jobBrand = String(job.identityLock?.brand || '').trim().toLowerCase();
      if (jobBrand === expected) {
        out.push(key);
      }
    } catch {
      // Skip malformed input files.
    }
  }
  return out;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function runOne() {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) {
        return;
      }
      const item = items[idx];
      results[idx] = await worker(item, idx);
    }
  }

  const threads = [];
  const n = Math.max(1, concurrency);
  for (let i = 0; i < n; i += 1) {
    threads.push(runOne());
  }
  await Promise.all(threads);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const category = args.category || 'mouse';

  const config = loadConfig({
    localMode: asBool(args.local, undefined),
    dryRun: asBool(args['dry-run'], undefined),
    writeMarkdownSummary: asBool(args['write-md'], true),
    localInputRoot: args['local-input-root'] || undefined,
    localOutputRoot: args['local-output-root'] || undefined
  });

  const storage = createStorage(config);
  const allKeys = await storage.listInputKeys(category);
  const keys = await filterKeysByBrand(storage, allKeys, args.brand);

  const startedAt = Date.now();
  const runResults = await runWithConcurrency(
    keys,
    config.concurrency,
    async (key) => {
      try {
        const result = await runProduct({ storage, config, s3Key: key });
        return {
          key,
          productId: result.productId,
          runId: result.runId,
          validated: result.summary.validated,
          reason: result.summary.reason
        };
      } catch (error) {
        return {
          key,
          error: error.message
        };
      }
    }
  );

  const output = {
    category,
    brand: args.brand || null,
    total_inputs: allKeys.length,
    selected_inputs: keys.length,
    concurrency: config.concurrency,
    duration_ms: Date.now() - startedAt,
    runs: runResults
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
