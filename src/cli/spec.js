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
import { startIntelGraphApi } from '../api/intelGraphApi.js';
import { runGoldenBenchmark } from '../benchmark/goldenBenchmark.js';
import { rankBatchWithBandit } from '../learning/banditScheduler.js';
import { ingestCsvFile } from '../ingest/csvIngestor.js';
import { compileCategoryWorkbook } from '../ingest/categoryCompile.js';
import { runWatchImports, runDaemon } from '../daemon/daemon.js';
import { runUntilComplete } from '../runner/runUntilComplete.js';
import { buildBillingReport } from '../billing/costLedger.js';
import { buildLearningReport } from '../learning/categoryBrain.js';
import { syncJobsFromActiveFiltering } from '../helperFiles/index.js';
import { runLlmHealthCheck } from '../llm/healthCheck.js';

function usage() {
  return [
    'Usage: node src/cli/spec.js <command> [options]',
    '',
    'Commands:',
    '  run-one --s3key <key> [--local] [--dry-run]',
    '  run-ad-hoc <category> <brand> <model> [<variant>] [--seed-urls <csv>] [--until-complete] [--mode aggressive|balanced] [--max-rounds <n>] [--local]',
    '  run-ad-hoc --category <category> --brand <brand> --model <model> [--variant <variant>] [--seed-urls <csv>] [--until-complete] [--mode aggressive|balanced] [--max-rounds <n>] [--local]',
    '  run-batch --category <category> [--brand <brand>] [--strategy <explore|exploit|mixed|bandit>] [--local] [--dry-run]',
    '  run-until-complete --s3key <key> [--max-rounds <n>] [--mode aggressive|balanced] [--local]',
    '  category-compile --category <category> [--workbook <path>] [--map <path>] [--local]',
    '  discover --category <category> [--brand <brand>] [--local]',
    '  ingest-csv --category <category> --path <csv> [--imports-root <path>] [--local]',
    '  watch-imports [--imports-root <path>] [--category <category>|--all] [--once] [--local]',
    '  daemon [--imports-root <path>] [--category <category>|--all] [--mode aggressive|balanced] [--once] [--local]',
    '  billing-report [--month YYYY-MM] [--local]',
    '  learning-report --category <category> [--local]',
    '  explain-unk --category <category> --brand <brand> --model <model> [--variant <variant>] [--product-id <id>] [--local]',
    '  llm-health [--provider deepseek|openai|gemini] [--model <name>] [--local]',
    '  test-s3 [--fixture <path>] [--s3key <key>] [--dry-run]',
    '  sources-plan --category <category> [--local]',
    '  sources-report --category <category> [--top <n>] [--top-paths <n>] [--local]',
    '  benchmark --category <category> [--fixture <path>] [--max-cases <n>] [--local]',
    '  rebuild-index --category <category> [--local]',
    '  intel-graph-api --category <category> [--host <host>] [--port <port>] [--local]',
    '',
    'Global options:',
    '  --env <path>   Path to dotenv file (default: .env)',
    '  --profile <standard|thorough|fast>   Runtime crawl profile (default: standard)',
    '  --thorough    Shortcut for --profile thorough'
  ].join('\n');
}

function buildConfig(args) {
  const profileOverride = asBool(args.thorough, false)
    ? 'thorough'
    : (args.profile || args['run-profile'] || undefined);
  return loadConfig({
    localMode: asBool(args.local, undefined),
    dryRun: asBool(args['dry-run'], undefined),
    writeMarkdownSummary: asBool(args['write-md'], true),
    localInputRoot: args['local-input-root'] || undefined,
    localOutputRoot: args['local-output-root'] || undefined,
    outputMode: args['output-mode'] || undefined,
    mirrorToS3: asBool(args['mirror-to-s3'], undefined),
    mirrorToS3Input: asBool(args['mirror-to-s3-input'], undefined),
    discoveryEnabled: asBool(args['discovery-enabled'], undefined),
    searchProvider: args['search-provider'] || undefined,
    fetchCandidateSources: asBool(args['fetch-candidate-sources'], undefined),
    batchStrategy: args.strategy || undefined,
    runProfile: profileOverride
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

function normalizeBatchStrategy(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'explore' || token === 'exploit' || token === 'mixed' || token === 'bandit') {
    return token;
  }
  return 'mixed';
}

async function collectBatchMetadata({ storage, config, category, key }) {
  const job = await storage.readJsonOrNull(key);
  const productId = job?.productId;
  const brand = String(job?.identityLock?.brand || '').trim().toLowerCase();

  if (!productId) {
    return {
      key,
      productId: '',
      brand,
      brandKey: slug(brand),
      hasHistory: false,
      validated: false,
      confidence: 0,
      missingCriticalCount: 0,
      fieldsBelowPassCount: 0,
      contradictionCount: 0,
      hypothesisQueueCount: 0
    };
  }

  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const summary = await storage.readJsonOrNull(`${latestBase}/summary.json`);
  return {
    key,
    productId,
    brand,
    brandKey: slug(brand),
    hasHistory: Boolean(summary),
    validated: Boolean(summary?.validated),
    confidence: Number.parseFloat(String(summary?.confidence || 0)) || 0,
    missingCriticalCount: (summary?.critical_fields_below_pass_target || []).length,
    fieldsBelowPassCount: (summary?.fields_below_pass_target || []).length,
    contradictionCount: summary?.constraint_analysis?.contradiction_count || 0,
    hypothesisQueueCount: (summary?.hypothesis_queue || []).length
  };
}

function buildBrandRewardIndex(domains) {
  const buckets = new Map();

  for (const domain of Object.values(domains || {})) {
    for (const [brandKey, brandEntry] of Object.entries(domain?.per_brand || {})) {
      if (!buckets.has(brandKey)) {
        buckets.set(brandKey, {
          weighted: 0,
          weight: 0
        });
      }
      const bucket = buckets.get(brandKey);
      const attempts = Math.max(1, Number.parseFloat(String(brandEntry?.attempts || 0)) || 1);
      const fieldRewardStrength = Number.parseFloat(String(brandEntry?.field_reward_strength || 0)) || 0;
      const plannerScore = Number.parseFloat(String(brandEntry?.planner_score || 0)) || 0;
      const blended = (fieldRewardStrength * 0.7) + ((plannerScore - 0.5) * 0.3);
      bucket.weighted += blended * attempts;
      bucket.weight += attempts;
    }
  }

  const index = {};
  for (const [brandKey, bucket] of buckets.entries()) {
    index[brandKey] = bucket.weight > 0
      ? Number.parseFloat((bucket.weighted / bucket.weight).toFixed(6))
      : 0;
  }
  return index;
}

function scoreForExploit(meta) {
  let score = 0;
  score += meta.validated ? 2 : 0;
  score += meta.confidence || 0;
  score += meta.hasHistory ? 0.5 : 0;
  score -= (meta.missingCriticalCount || 0) * 0.25;
  return score;
}

function scoreForExplore(meta) {
  let score = 0;
  score += meta.hasHistory ? 0 : 2;
  score += (meta.missingCriticalCount || 0) * 0.6;
  score += meta.validated ? 0 : 0.8;
  score += Math.max(0, 1 - (meta.confidence || 0));
  return score;
}

function interleaveLists(left, right) {
  const output = [];
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    if (i < left.length) {
      output.push(left[i]);
    }
    if (i < right.length) {
      output.push(right[i]);
    }
  }
  return output;
}

function orderBatchKeysByStrategy(keys, metadata, strategy, options = {}) {
  const rows = keys.map((key) => metadata.get(key)).filter(Boolean);
  if (strategy === 'bandit') {
    const ranked = rankBatchWithBandit({
      metadataRows: rows,
      brandRewardIndex: options.brandRewardIndex || {},
      seed: options.seed || new Date().toISOString().slice(0, 10),
      mode: 'balanced'
    });
    return {
      orderedKeys: ranked.orderedKeys,
      diagnostics: ranked.scored
    };
  }

  if (strategy === 'exploit') {
    return {
      orderedKeys: rows
      .sort((a, b) => scoreForExploit(b) - scoreForExploit(a) || a.key.localeCompare(b.key))
      .map((row) => row.key),
      diagnostics: []
    };
  }

  if (strategy === 'explore') {
    return {
      orderedKeys: rows
      .sort((a, b) => scoreForExplore(b) - scoreForExplore(a) || a.key.localeCompare(b.key))
      .map((row) => row.key),
      diagnostics: []
    };
  }

  const exploit = rows
    .slice()
    .sort((a, b) => scoreForExploit(b) - scoreForExploit(a) || a.key.localeCompare(b.key));
  const explore = rows
    .slice()
    .sort((a, b) => scoreForExplore(b) - scoreForExplore(a) || a.key.localeCompare(b.key));

  const seen = new Set();
  const mixed = [];
  for (const row of interleaveLists(exploit, explore)) {
    if (seen.has(row.key)) {
      continue;
    }
    seen.add(row.key);
    mixed.push(row.key);
  }
  return {
    orderedKeys: mixed,
    diagnostics: []
  };
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

async function assertCategorySchemaReady({ category, storage, config }) {
  let categoryConfig;
  try {
    categoryConfig = await loadCategoryConfig(category, { storage, config });
  } catch (error) {
    throw new Error(
      `Category '${category}' is not configured. Generate helper_files/${category}/_generated/field_rules.json first. (${error.message})`
    );
  }

  if (!Array.isArray(categoryConfig.fieldOrder) || categoryConfig.fieldOrder.length === 0) {
    throw new Error(`Category '${category}' has no field order in generated field rules.`);
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
    latestBase: result.exportInfo.latestBase,
    finalBase: result.finalExport?.final_base || null
  };
}

async function commandRunAdHoc(config, storage, args) {
  const positional = args._ || [];
  const category = String(args.category || positional[0] || 'mouse').trim();
  const brand = String(args.brand || positional[1] || '').trim();
  const model = String(args.model || positional[2] || '').trim();
  const variant = String(args.variant || positional.slice(3).join(' ') || '').trim();

  if (!brand || !model) {
    throw new Error('run-ad-hoc requires <category> <brand> <model> or --brand/--model');
  }

  await assertCategorySchemaReady({ category, storage, config });

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

  if (asBool(args['until-complete'], false)) {
    const mode = String(args.mode || config.accuracyMode || 'balanced').toLowerCase();
    const maxRounds = Math.max(1, Number.parseInt(String(args['max-rounds'] || '0'), 10) || 0);
    const completed = await runUntilComplete({
      storage,
      config,
      s3key: s3Key,
      maxRounds: maxRounds || undefined,
      mode
    });
    return {
      command: 'run-ad-hoc',
      until_complete: true,
      s3Key,
      productId: completed.productId,
      ...completed
    };
  }

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
    latestBase: result.exportInfo.latestBase,
    finalBase: result.finalExport?.final_base || null
  };
}

async function commandRunUntilComplete(config, storage, args) {
  const s3key = String(args.s3key || '').trim();
  if (!s3key) {
    throw new Error('run-until-complete requires --s3key <key>');
  }
  const maxRounds = Math.max(1, Number.parseInt(String(args['max-rounds'] || '0'), 10) || 0);
  const mode = String(args.mode || config.accuracyMode || 'balanced').toLowerCase();
  const result = await runUntilComplete({
    storage,
    config,
    s3key,
    maxRounds: maxRounds || undefined,
    mode
  });
  return {
    command: 'run-until-complete',
    ...result
  };
}

async function commandCategoryCompile(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('category-compile requires --category <category>');
  }
  const workbookPath = String(args.workbook || '').trim();
  const mapPath = String(args.map || '').trim();
  const result = await compileCategoryWorkbook({
    category,
    workbookPath,
    config,
    mapPath: mapPath || null
  });
  return {
    command: 'category-compile',
    ...result
  };
}

async function commandIngestCsv(config, storage, args) {
  const category = String(args.category || '').trim();
  const csvPath = String(args.path || '').trim();
  if (!category) {
    throw new Error('ingest-csv requires --category <category>');
  }
  if (!csvPath) {
    throw new Error('ingest-csv requires --path <csv>');
  }
  await assertCategorySchemaReady({ category, storage, config });
  const result = await ingestCsvFile({
    storage,
    config,
    category,
    csvPath,
    importsRoot: args['imports-root'] || config.importsRoot
  });
  return {
    command: 'ingest-csv',
    ...result
  };
}

async function commandWatchImports(config, storage, args) {
  const importsRoot = args['imports-root'] || config.importsRoot;
  const category = args.category || null;
  const all = asBool(args.all, !category);
  const once = asBool(args.once, false);
  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    context: {
      category
    }
  });
  const result = await runWatchImports({
    storage,
    config,
    importsRoot,
    category,
    all,
    once,
    logger
  });
  await logger.flush();
  return {
    command: 'watch-imports',
    ...result,
    events: logger.events.slice(-100)
  };
}

async function commandDaemon(config, storage, args) {
  const importsRoot = args['imports-root'] || config.importsRoot;
  const category = args.category || null;
  const all = asBool(args.all, !category);
  const mode = String(args.mode || config.accuracyMode || 'balanced').toLowerCase();
  const once = asBool(args.once, false);
  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    context: {
      category: category || 'all'
    }
  });

  const result = await runDaemon({
    storage,
    config,
    importsRoot,
    category,
    all,
    mode,
    once,
    logger
  });
  await logger.flush();
  return {
    command: 'daemon',
    ...result,
    events: logger.events.slice(-200)
  };
}

async function commandRunBatch(config, storage, args) {
  const category = args.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  let helperSync = null;
  if (config.helperFilesEnabled && config.helperAutoSeedTargets) {
    helperSync = await syncJobsFromActiveFiltering({
      storage,
      config,
      category,
      categoryConfig,
      limit: Math.max(0, Number.parseInt(String(config.helperActiveSyncLimit || '0'), 10) || 0)
    });
  }
  const allKeys = await storage.listInputKeys(category);
  const keys = await filterKeysByBrand(storage, allKeys, args.brand);
  const strategy = normalizeBatchStrategy(args.strategy || config.batchStrategy || 'mixed');
  const metadataRows = await runWithConcurrency(keys, config.concurrency, async (key) =>
    collectBatchMetadata({ storage, config, category, key })
  );
  const metadataByKey = new Map(metadataRows.map((row) => [row.key, row]));
  const intel = await loadSourceIntel({ storage, config, category });
  const brandRewardIndex = buildBrandRewardIndex(intel.data.domains || {});
  const schedule = orderBatchKeysByStrategy(keys, metadataByKey, strategy, {
    brandRewardIndex,
    seed: `${category}:${new Date().toISOString().slice(0, 10)}`
  });
  const orderedKeys = schedule.orderedKeys;

  const runs = await runWithConcurrency(orderedKeys, config.concurrency, async (key) => {
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
    helper_sync: helperSync,
    strategy,
    total_inputs: allKeys.length,
    selected_inputs: keys.length,
    concurrency: config.concurrency,
    scheduled_order: orderedKeys,
    bandit_preview: strategy === 'bandit'
      ? (schedule.diagnostics || []).slice(0, 25).map((row) => ({
        key: row.key,
        productId: row.productId,
        bandit_score: row.bandit_score,
        thompson: row.thompson,
        ucb: row.ucb,
        info_need: row.info_need,
        mean_reward: row.mean_reward,
        brand_reward: row.brandReward
      }))
      : [],
    runs
  };
}

async function commandDiscover(config, storage, args) {
  const category = args.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  let helperSync = null;
  if (config.helperFilesEnabled && config.helperAutoSeedTargets) {
    helperSync = await syncJobsFromActiveFiltering({
      storage,
      config,
      category,
      categoryConfig,
      limit: Math.max(0, Number.parseInt(String(config.helperActiveSyncLimit || '0'), 10) || 0)
    });
  }
  const allKeys = await storage.listInputKeys(category);
  const keys = await filterKeysByBrand(storage, allKeys, args.brand);
  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    context: {
      category
    }
  });

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
  await logger.flush();

  return {
    command: 'discover',
    category,
    brand: args.brand || null,
    helper_sync: helperSync,
    total_inputs: allKeys.length,
    selected_inputs: keys.length,
    runs
  };
}

async function commandSourcesReport(config, storage, args) {
  const category = args.category || 'mouse';
  const top = Math.max(1, Number.parseInt(args.top || '25', 10) || 25);
  const topPaths = Math.max(1, Number.parseInt(args['top-paths'] || '8', 10) || 8);

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
      candidate_attempts: item.candidate_attempts,
      top_paths: Object.values(item.per_path || {})
        .sort((a, b) => (b.planner_score || 0) - (a.planner_score || 0))
        .slice(0, topPaths)
        .map((pathRow) => ({
          path: pathRow.path || '/',
          planner_score: pathRow.planner_score || 0,
          attempts: pathRow.attempts || 0,
          identity_match_rate: pathRow.identity_match_rate || 0,
          major_anchor_conflict_rate: pathRow.major_anchor_conflict_rate || 0,
          fields_accepted_count: pathRow.fields_accepted_count || 0
        }))
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

async function commandBenchmark(config, storage, args) {
  const category = args.category || 'mouse';
  const fixturePath = args.fixture || null;
  const maxCases = Math.max(0, Number.parseInt(String(args['max-cases'] || '0'), 10) || 0);

  const result = await runGoldenBenchmark({
    storage,
    category,
    fixturePath,
    maxCases
  });

  return {
    command: 'benchmark',
    category,
    fixture_path: result.fixture_path,
    case_count: result.case_count,
    pass_case_count: result.pass_case_count,
    fail_case_count: result.fail_case_count,
    missing_case_count: result.missing_case_count,
    field_checks: result.field_checks,
    field_passed: result.field_passed,
    field_pass_rate: result.field_pass_rate,
    results: result.results
  };
}

async function commandIntelGraphApi(config, storage, args) {
  const category = args.category || 'mouse';
  const host = String(args.host || '0.0.0.0');
  const port = Math.max(1, Number.parseInt(String(args.port || '8787'), 10) || 8787);

  const started = await startIntelGraphApi({
    storage,
    config,
    category,
    host,
    port
  });

  return {
    command: 'intel-graph-api',
    category,
    host: started.host,
    port: started.port,
    graphql_url: started.graphqlUrl,
    health_url: started.healthUrl
  };
}

async function commandBillingReport(config, storage, args) {
  const month = args.month || new Date().toISOString().slice(0, 7);
  const report = await buildBillingReport({
    storage,
    month,
    config
  });
  return {
    command: 'billing-report',
    ...report
  };
}

async function commandLearningReport(_config, storage, args) {
  const category = String(args.category || 'mouse').trim();
  const report = await buildLearningReport({
    storage,
    category
  });
  return {
    command: 'learning-report',
    ...report
  };
}

async function commandExplainUnk(_config, storage, args) {
  const category = String(args.category || 'mouse').trim();
  const brand = String(args.brand || '').trim();
  const model = String(args.model || '').trim();
  const variant = String(args.variant || '').trim();
  const productId = String(
    args['product-id'] ||
    [category, slug(brand), slug(model), slug(variant)].filter(Boolean).join('-')
  ).trim();

  if (!productId) {
    throw new Error('explain-unk requires --product-id or --category/--brand/--model');
  }

  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const summary = await storage.readJsonOrNull(`${latestBase}/summary.json`);
  const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
  if (!summary && !normalized) {
    throw new Error(`No latest run found for productId '${productId}' in category '${category}'`);
  }

  const fieldReasoning = summary?.field_reasoning || {};
  const fields = normalized?.fields || {};
  const unknownFields = [];
  for (const [field, value] of Object.entries(fields)) {
    if (String(value || '').trim().toLowerCase() !== 'unk') {
      continue;
    }
    const row = fieldReasoning[field] || {};
    unknownFields.push({
      field,
      unknown_reason: row.unknown_reason || 'not_found_after_search',
      reasons: row.reasons || [],
      contradictions: row.contradictions || []
    });
  }

  return {
    command: 'explain-unk',
    category,
    productId,
    run_id: summary?.runId || summary?.run_id || null,
    validated: Boolean(summary?.validated),
    unknown_field_count: unknownFields.length,
    unknown_fields: unknownFields,
    searches_attempted: summary?.searches_attempted || [],
    urls_fetched_count: (summary?.urls_fetched || []).length,
    top_evidence_references: summary?.top_evidence_references || []
  };
}

async function commandLlmHealth(config, storage, args) {
  const provider = String(args.provider || '').trim().toLowerCase();
  const model = String(args.model || '').trim();
  const result = await runLlmHealthCheck({
    storage,
    config,
    provider,
    model
  });
  return {
    command: 'llm-health',
    ...result
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
  } else if (command === 'run-until-complete') {
    output = await commandRunUntilComplete(config, storage, args);
  } else if (command === 'category-compile') {
    output = await commandCategoryCompile(config, storage, args);
  } else if (command === 'run-batch') {
    output = await commandRunBatch(config, storage, args);
  } else if (command === 'discover') {
    output = await commandDiscover(config, storage, args);
  } else if (command === 'ingest-csv') {
    output = await commandIngestCsv(config, storage, args);
  } else if (command === 'watch-imports') {
    output = await commandWatchImports(config, storage, args);
  } else if (command === 'daemon') {
    output = await commandDaemon(config, storage, args);
  } else if (command === 'billing-report') {
    output = await commandBillingReport(config, storage, args);
  } else if (command === 'learning-report') {
    output = await commandLearningReport(config, storage, args);
  } else if (command === 'explain-unk') {
    output = await commandExplainUnk(config, storage, args);
  } else if (command === 'llm-health') {
    output = await commandLlmHealth(config, storage, args);
  } else if (command === 'test-s3') {
    output = await commandTestS3();
  } else if (command === 'sources-plan') {
    output = await commandSourcesPlan(config, storage, args);
  } else if (command === 'sources-report') {
    output = await commandSourcesReport(config, storage, args);
  } else if (command === 'rebuild-index') {
    output = await commandRebuildIndex(config, storage, args);
  } else if (command === 'benchmark') {
    output = await commandBenchmark(config, storage, args);
  } else if (command === 'intel-graph-api') {
    output = await commandIntelGraphApi(config, storage, args);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }

  if (output && typeof output === 'object') {
    output.run_profile = config.runProfile;
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
});
