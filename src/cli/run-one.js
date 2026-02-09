#!/usr/bin/env node
import { loadConfig } from '../config.js';
import { createStorage } from '../s3/storage.js';
import { parseArgs, asBool } from './args.js';
import { runProduct } from '../pipeline/runProduct.js';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = loadConfig({
    localMode: asBool(args.local, undefined),
    dryRun: asBool(args['dry-run'], undefined),
    writeMarkdownSummary: asBool(args['write-md'], true),
    localInputRoot: args['local-input-root'] || undefined,
    localOutputRoot: args['local-output-root'] || undefined
  });

  const storage = createStorage(config);
  const s3Key =
    args.s3key ||
    `${config.s3InputPrefix}/mouse/products/mouse-razer-viper-v3-pro.json`;

  const result = await runProduct({
    storage,
    config,
    s3Key
  });

  const output = {
    productId: result.productId,
    runId: result.runId,
    validated: result.summary.validated,
    reason: result.summary.reason,
    confidence: result.summary.confidence,
    completeness: result.summary.completeness,
    runBase: result.exportInfo.runBase,
    latestBase: result.exportInfo.latestBase
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
