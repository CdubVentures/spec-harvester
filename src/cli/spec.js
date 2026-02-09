#!/usr/bin/env node
import { loadConfig, loadDotEnvFile } from '../config.js';
import { createStorage, toPosixKey } from '../s3/storage.js';
import { parseArgs, asBool } from './args.js';
import { runProduct } from '../pipeline/runProduct.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { discoverCandidateSources } from '../discovery/searchDiscovery.js';
import { rebuildCategoryIndex } from '../indexer/rebuildIndex.js';
import { buildRunId } from '../utils/common.js';
import { EventLogger } from '../logger.js';
import { runS3Integration } from './s3-integration.js';
import {
  generateSourceExpansionPlans,
  loadSourceIntel,
  promotionSuggestionsKey
} from '../intel/sourceIntel.js';

function usage() {
  return [
    'Usage: node src/cli/spec.js <command> [options]',
    '',
    'Commands:',
    '  run-one --s3key <key> [--local] [--dry-run]',
    '  run-ad-hoc --category <category> --brand <brand> --model <model> [--variant <variant>] [--seed-urls <csv>] [--local]',
    '  run-batch --category <category> [--brand <brand>] [--local] [--dry-run]',
    '  discover --category <category> [--brand <brand>] [--local]',
    '  test-s3 [--fixture <path>] [--s3key <key>] [--dry-run]',
    '  sources-plan --category <category> [--local]',
    '  sources-report --category <category> [--top <n>] [--local]',
    '  rebuild-index --category <category> [--local]',
    '',
    'Global options:',
    '  --env <path>   Path to dotenv file (default: .env)'
  ].join('\n');
}

function buildConfig(args) {
  return loadConfig({
    localMode: asBool(args.local, undefined),
    dryRun: asBool(args['dry-run'], undefined),
    writeMarkdownSummary: asBool(args['write-md'], true),
    localInputRoot: args['local-input-root'] || undefined,
    localOutputRoot: args['local-output-root'] || undefined,
    discoveryEnabled: asBool(args['discovery-enabled'], undefined),
    searchProvider: args['search-provider'] || undefined,
    fetchCandidateSources: asBool(args['fetch-candidate-sources'], undefined)
  });
}

async function filterKeysByBrand(storage, keys, brand) {
  if (!brand) {
    return keys;
  }

  const expected = String(brand).trim().toLowerCase();
  const selected = [];
  for (const key of keys) {
    const job = await storage.readJsonOrNull(key);
    if (!job) {
      continue;
    }
    const currentBrand = String(job.identityLock?.brand || '').trim().toLowerCase();
    if (currentBrand === expected) {
      selected.push(key);
    }
  }
  return selected;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = [];
  let index = 0;

  async function runWorker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current], current);
    }
  }

  const count = Math.max(1, concurrency);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseCsvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonArg(name, value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid JSON for --${name}: ${error.message}`);
  }
}

async function commandRunOne(config, storage, args) {
  const s3Key =
    args.s3key || `${config.s3InputPrefix}/mouse/products/mouse-razer-viper-v3-pro.json`;

  const result = await runProduct({ storage, config, s3Key });
  return {
    command: 'run-one',
    productId: result.productId,
    runId: result.runId,
    validated: result.summary.validated,
    validated_reason: result.summary.validated_reason,
    confidence: result.summary.confidence,
    completeness_required_percent: result.summary.completeness_required_percent,
    coverage_overall_percent: result.summary.coverage_overall_percent,
    runBase: result.exportInfo.runBase,
    latestBase: result.exportInfo.latestBase
  };
}

async function commandRunAdHoc(config, storage, args) {
  const category = String(args.category || 'mouse').trim();
  const brand = String(args.brand || '').trim();
  const model = String(args.model || '').trim();
  const variant = String(args.variant || '').trim();

  if (!brand || !model) {
    throw new Error('run-ad-hoc requires --brand and --model');
  }

  const autoProductId = [category, slug(brand), slug(model), slug(variant)]
    .filter(Boolean)
    .join('-');
  const productId = String(args['product-id'] || autoProductId || `${category}-${Date.now()}`).trim();

  const identityLock = {
    brand,
    model,
    variant,
    sku: String(args.sku || '').trim(),
    mpn: String(args.mpn || '').trim(),
    gtin: String(args.gtin || '').trim()
  };

  const seedUrls = parseCsvList(args['seed-urls']);
  const anchors = parseJsonArg('anchors-json', args['anchors-json'], {});
  const requirements = parseJsonArg('requirements-json', args['requirements-json'], null);

  const job = {
    productId,
    category,
    identityLock,
    seedUrls,
    anchors
  };
  if (requirements) {
    job.requirements = requirements;
  }

  const s3Key =
    args.s3key || toPosixKey(config.s3InputPrefix, category, 'products', `${productId}.json`);

  await storage.writeObject(
    s3Key,
    Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );

  const result = await runProduct({ storage, config, s3Key });
  return {
    command: 'run-ad-hoc',
    s3Key,
    productId: result.productId,
    runId: result.runId,
    validated: result.summary.validated,
    validated_reason: result.summary.validated_reason,
    confidence: result.summary.confidence,
    completeness_required_percent: result.summary.completeness_required_percent,
    coverage_overall_percent: result.summary.coverage_overall_percent,
    runBase: result.exportInfo.runBase,
    latestBase: result.exportInfo.latestBase
  };
}

async function commandRunBatch(config, storage, args) {
  const category = args.category || 'mouse';
  const allKeys = await storage.listInputKeys(category);
  const keys = await filterKeysByBrand(storage, allKeys, args.brand);

  const runs = await runWithConcurrency(keys, config.concurrency, async (key) => {
    try {
      const result = await runProduct({ storage, config, s3Key: key });
      return {
        key,
        productId: result.productId,
        runId: result.runId,
        validated: result.summary.validated,
        validated_reason: result.summary.validated_reason
      };
    } catch (error) {
      return {
        key,
        error: error.message
      };
    }
  });

  return {
    command: 'run-batch',
    category,
    brand: args.brand || null,
    total_inputs: allKeys.length,
    selected_inputs: keys.length,
    concurrency: config.concurrency,
    runs
  };
}

async function commandDiscover(config, storage, args) {
  const category = args.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const allKeys = await storage.listInputKeys(category);
  const keys = await filterKeysByBrand(storage, allKeys, args.brand);
  const logger = new EventLogger();

  const runs = [];
  for (const key of keys) {
    const job = await storage.readJson(key);
    const runId = buildRunId();
    const result = await discoverCandidateSources({
      config: {
        ...config,
        discoveryEnabled: true
      },
      storage,
      categoryConfig,
      job,
      runId,
      logger,
      planningHints: {
        missingCriticalFields: categoryConfig.schema?.critical_fields || []
      }
    });

    runs.push({
      key,
      productId: job.productId,
      runId,
      candidates_key: result.candidatesKey,
      candidate_count: result.candidates.length
    });
  }

  return {
    command: 'discover',
    category,
    brand: args.brand || null,
    total_inputs: allKeys.length,
    selected_inputs: keys.length,
    runs
  };
}

async function commandSourcesReport(config, storage, args) {
  const category = args.category || 'mouse';
  const top = Math.max(1, Number.parseInt(args.top || '25', 10) || 25);

  const intel = await loadSourceIntel({ storage, config, category });
  const domains = Object.values(intel.data.domains || {}).sort(
    (a, b) => (b.planner_score || 0) - (a.planner_score || 0)
  );

  const suggestionKey = promotionSuggestionsKey(config, category);
  const suggestions = await storage.readJsonOrNull(suggestionKey);

  return {
    command: 'sources-report',
    category,
    domain_stats_key: intel.key,
    domain_count: domains.length,
    top_domains: domains.slice(0, top).map((item) => ({
      rootDomain: item.rootDomain,
      planner_score: item.planner_score,
      attempts: item.attempts,
      identity_match_rate: item.identity_match_rate,
      major_anchor_conflict_rate: item.major_anchor_conflict_rate,
      fields_accepted_count: item.fields_accepted_count,
      products_seen: item.products_seen,
      approved_attempts: item.approved_attempts,
      candidate_attempts: item.candidate_attempts
    })),
    promotion_suggestions_key: suggestionKey,
    promotion_suggestion_count: suggestions?.suggestion_count || 0
  };
}

async function commandSourcesPlan(config, storage, args) {
  const category = args.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const result = await generateSourceExpansionPlans({
    storage,
    config,
    category,
    categoryConfig
  });

  return {
    command: 'sources-plan',
    category,
    expansion_plan_key: result.expansionPlanKey,
    brand_plan_count: result.planCount,
    brand_plan_keys: result.brandPlanKeys
  };
}

async function commandRebuildIndex(config, storage, args) {
  const category = args.category || 'mouse';
  const result = await rebuildCategoryIndex({ storage, config, category });
  return {
    command: 'rebuild-index',
    category,
    index_key: result.indexKey,
    total_products: result.totalProducts
  };
}

async function commandTestS3() {
  const output = await runS3Integration(process.argv.slice(3));
  return {
    command: 'test-s3',
    ...output
  };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    process.stdout.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(rest);
  loadDotEnvFile(args.env || '.env');
  const config = buildConfig(args);
  const storage = createStorage(config);

  let output;
  if (command === 'run-one') {
    output = await commandRunOne(config, storage, args);
  } else if (command === 'run-ad-hoc') {
    output = await commandRunAdHoc(config, storage, args);
  } else if (command === 'run-batch') {
    output = await commandRunBatch(config, storage, args);
  } else if (command === 'discover') {
    output = await commandDiscover(config, storage, args);
  } else if (command === 'test-s3') {
    output = await commandTestS3();
  } else if (command === 'sources-plan') {
    output = await commandSourcesPlan(config, storage, args);
  } else if (command === 'sources-report') {
    output = await commandSourcesReport(config, storage, args);
  } else if (command === 'rebuild-index') {
    output = await commandRebuildIndex(config, storage, args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
});
