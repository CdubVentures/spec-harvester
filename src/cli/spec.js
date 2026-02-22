#!/usr/bin/env node
import { loadConfig, loadDotEnvFile, validateConfig } from '../config.js';
import { createStorage, toPosixKey } from '../s3/storage.js';
import { parseArgs, asBool } from './args.js';
import { runProduct } from '../pipeline/runProduct.js';
import { runConvergenceLoop, bridgeAsLogger } from '../pipeline/runOrchestrator.js';
import { computeNeedSet } from '../indexlab/needsetEngine.js';
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
import {
  clearQueueByStatus,
  listQueueProducts,
  loadQueueState,
  syncQueueFromInputs,
  upsertQueueProduct
} from '../queue/queueState.js';
import {
  buildReviewLayout,
  buildReviewQueue,
  buildProductReviewPayload,
  writeCategoryReviewArtifacts,
  writeProductReviewArtifacts
} from '../review/reviewGridData.js';
import {
  approveGreenOverrides,
  buildReviewMetrics,
  finalizeOverrides,
  setManualOverride,
  setOverrideFromCandidate
} from '../review/overrideWorkflow.js';
import { appendReviewSuggestion } from '../review/suggestions.js';
import { buildBillingReport } from '../billing/costLedger.js';
import { buildLearningReport } from '../learning/categoryBrain.js';
import { syncJobsFromActiveFiltering } from '../helperFiles/index.js';
import { runLlmHealthCheck } from '../llm/healthCheck.js';
import { CortexLifecycle } from '../llm/cortex_lifecycle.js';
import { buildCortexTaskPlan } from '../llm/cortex_router.js';
import { CortexClient } from '../llm/cortex_client.js';
import {
  bootstrapExpansionCategories,
  parseExpansionCategories,
  runFailureInjectionHarness,
  runFuzzSourceHealthHarness,
  runProductionHardeningReport,
  runQueueLoadHarness
} from '../phase10/expansionHardening.js';
import {
  buildAccuracyTrend,
  buildLlmMetrics,
  buildSourceHealth,
  publishProducts,
  readPublishedChangelog,
  readPublishedProvenance,
  runAccuracyBenchmarkReport
} from '../publish/publishingPipeline.js';
import {
  reconcileDriftedProduct,
  scanAndEnqueueDriftedProducts
} from '../publish/driftScheduler.js';
import { startReviewQueueWebSocket } from '../review/queueWebSocket.js';
import { verifyGeneratedFieldRules } from '../ingest/fieldRulesVerify.js';
import {
  compileRules,
  compileRulesAll,
  fieldReport,
  initCategory,
  listFields,
  readCompileReport,
  rulesDiff,
  watchCompileRules,
  validateRules
} from '../field-rules/compiler.js';
import {
  buildAccuracyReport,
  createGoldenFixture,
  createGoldenFromExcel,
  renderAccuracyReportMarkdown,
  validateGoldenFixtures
} from '../testing/goldenFiles.js';
import { generateTypesForCategory } from '../build/generate-types.js';
import { runQaJudge } from '../review/qaJudge.js';
import { computeCalibrationReport } from '../calibration/confidenceCalibrator.js';
import { reconcileOrphans } from '../catalog/reconciler.js';
import { IndexLabRuntimeBridge } from '../indexlab/runtimeBridge.js';
import fsNode from 'node:fs/promises';
import pathNode from 'node:path';

async function openSpecDbForCategory(config, category) {
  const normalizedCategory = String(category || '').trim();
  if (!normalizedCategory) return null;
  try {
    const { SpecDb } = await import('../db/specDb.js');
    const dbDir = pathNode.join(config.specDbDir || '.specfactory_tmp', normalizedCategory);
    await fsNode.mkdir(dbDir, { recursive: true });
    const dbPath = pathNode.join(dbDir, 'spec.sqlite');
    return new SpecDb({ dbPath, category: normalizedCategory });
  } catch {
    return null;
  }
}

function usage() {
  return [
    'Usage: node src/cli/spec.js <command> [options]',
    '',
    'Commands:',
    '  run-one --s3key <key> [--local] [--dry-run]',
    '  indexlab --category <category> --seed <product_id|s3key|url|title> [--product-id <id>] [--s3key <key>] [--brand <brand>] [--model <model>] [--variant <variant>] [--sku <sku>] [--fields <csv>] [--providers <csv>] [--out <dir>] [--convergence] [--max-rounds <n>] [--mode <mode>] [--local]',
    '  run-ad-hoc <category> <brand> <model> [<variant>] [--seed-urls <csv>] [--until-complete] [--mode uber_aggressive|aggressive|balanced] [--max-rounds <n>] [--local]',
    '  run-ad-hoc --category <category> --brand <brand> --model <model> [--variant <variant>] [--seed-urls <csv>] [--until-complete] [--mode uber_aggressive|aggressive|balanced] [--max-rounds <n>] [--local]',
    '  run-batch --category <category> [--brand <brand>] [--strategy <explore|exploit|mixed|bandit>] [--local] [--dry-run]',
    '  run-until-complete --s3key <key> [--max-rounds <n>] [--mode uber_aggressive|aggressive|balanced] [--local]',
    '  category-compile --category <category> [--workbook <path>] [--map <path>] [--local]',
    '  compile-rules --category <category> [--workbook <path>] [--map <path>] [--dry-run] [--watch] [--watch-seconds <n>] [--max-events <n>] [--local]',
    '  compile-rules --all [--dry-run] [--local]',
    '  compile-report --category <category> [--local]',
    '  rules-diff --category <category> [--local]',
    '  validate-rules --category <category> [--local]',
    '  init-category --category <category> [--template electronics] [--local]',
    '  list-fields --category <category> [--group <group>] [--required-level <level>] [--local]',
    '  field-report --category <category> [--format md|json] [--local]',
    '  field-rules-verify --category <category> [--fixture <path>] [--strict-bytes] [--local]',
    '  create-golden --category <category> --product-id <id> [--fields-json <json>] [--identity-json <json>] [--unknowns-json <json>] [--notes <text>] [--local]',
    '  create-golden --category <category> --from-excel [--count <n>] [--product-id <id>] [--local]',
    '  test-golden --category <category> [--local]',
    '  calibrate-confidence --category <category> [--product-id <id>] [--local]',
    '  accuracy-report --category <category> [--format md|json] [--max-cases <n>] [--local]',
    '  accuracy-benchmark --category <category> [--period weekly|daily] [--max-cases <n>] [--golden-files] [--local]',
    '  accuracy-trend --category <category> --field <field> [--period <n>d|week|month] [--local]',
    '  generate-types --category <category> [--out-dir <path>] [--local]',
    '  publish --category <category> [--product-id <id>] [--all-approved] [--format all|csv|xlsx|sqlite] [--local]',
    '  provenance --category <category> --product-id <id> [--field <field>|--full] [--local]',
    '  changelog --category <category> --product-id <id> [--local]',
    '  source-health --category <category> [--source <host_or_source_id>] [--period <n>d|week|month] [--local]',
    '  llm-metrics [--period <n>d|week|month] [--model <model>] [--local]',
    '  phase10-bootstrap [--categories monitor,keyboard] [--template electronics] [--helper-root <path>] [--categories-root <path>] [--golden-root <path>] [--local]',
    '  hardening-harness --category <category> [--products <n>] [--cycles <n>] [--fuzz-iterations <n>] [--seed <n>] [--failure-attempts <n>] [--local]',
    '  hardening-report [--root-dir <path>] [--local]',
    '  drift-scan --category <category> [--max-products <n>] [--enqueue true|false] [--local]',
    '  drift-reconcile --category <category> --product-id <id> [--auto-republish true|false] [--local]',
    '  discover --category <category> [--brand <brand>] [--local]',
    '  ingest-csv --category <category> --path <csv> [--imports-root <path>] [--local]',
    '  watch-imports [--imports-root <path>] [--category <category>|--all] [--once] [--local]',
    '  daemon [--imports-root <path>] [--category <category>|--all] [--mode uber_aggressive|aggressive|balanced] [--once] [--local]',
    '  queue add --category <category> --brand <brand> --model <model> [--variant <variant>] [--priority <1-5>] [--local]',
    '  queue add --category <category> --product-id <id> [--s3key <key>] [--priority <1-5>] [--local]',
    '  queue add-batch --category <category> --file <csv> [--imports-root <path>] [--local]',
    '  queue list --category <category> [--status <status>] [--limit <n>] [--local]',
    '  queue stats --category <category> [--local]',
    '  queue retry --category <category> --product-id <id> [--local]',
    '  queue pause --category <category> --product-id <id> [--local]',
    '  queue clear --category <category> --status <status> [--local]',
    '  review layout --category <category> [--local]',
    '  review queue --category <category> [--status needs_review|queued|...] [--limit <n>] [--local]',
    '  review product --category <category> --product-id <id> [--without-candidates] [--local]',
    '  review build --category <category> [--product-id <id>] [--status <status>] [--local]',
    '  review ws-queue --category <category> [--status <status>] [--limit <n>] [--host <host>] [--port <port>] [--poll-seconds <n>] [--duration-seconds <n>] [--local]',
    '  review override --category <category> --product-id <id> --field <field> --candidate-id <id> [--reason <text>] [--reviewer <id>] [--local]',
    '  review approve-greens --category <category> --product-id <id> [--reason <text>] [--reviewer <id>] [--local]',
    '  review manual-override --category <category> --product-id <id> --field <field> --value <value> --evidence-url <url> --evidence-quote <quote> [--reason <text>] [--reviewer <id>] [--local]',
    '  review finalize --category <category> --product-id <id> [--apply] [--draft] [--reviewer <id>] [--local]',
    '  review metrics --category <category> [--window-hours <n>] [--local]',
    '  review suggest --category <category> --type enum|component|alias --field <field> --value <value> --evidence-url <url> --evidence-quote <quote> [--canonical <value>] [--reason <text>] [--reviewer <id>] [--product-id <id>] [--local]',
    '  billing-report [--month YYYY-MM] [--local]',
    '  learning-report --category <category> [--local]',
    '  explain-unk --category <category> --brand <brand> --model <model> [--variant <variant>] [--product-id <id>] [--local]',
    '  llm-health [--provider deepseek|openai|gemini] [--model <name>] [--local]',
    '  cortex-start [--local]',
    '  cortex-stop [--local]',
    '  cortex-restart [--local]',
    '  cortex-status [--local]',
    '  cortex-ensure [--local]',
    '  cortex-route-plan [--tasks-json <json>] [--context-json <json>] [--local]',
    '  cortex-run-pass [--tasks-json <json>] [--context-json <json>] [--local]',
    '  test-s3 [--fixture <path>] [--s3key <key>] [--dry-run]',
    '  sources-plan --category <category> [--local]',
    '  sources-report --category <category> [--top <n>] [--top-paths <n>] [--local]',
    '  benchmark --category <category> [--fixture <path>] [--max-cases <n>] [--local]',
    '  benchmark-golden --category <category> [--fixture <path>] [--max-cases <n>] [--local]',
    '  rebuild-index --category <category> [--local]',
    '  intel-graph-api --category <category> [--host <host>] [--port <port>] [--local]',
    '  product-reconcile --category <category> [--dry-run] [--local]',
    '  seed-db --category <category> [--local]',
    '  migrate-to-sqlite --category <category> [--phase <1-9>] [--local]',
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
  const overrides = {
    writeMarkdownSummary: asBool(args['write-md'], true),
    localInputRoot: args['local-input-root'] || undefined,
    localOutputRoot: args['local-output-root'] || undefined,
    outputMode: args['output-mode'] || undefined,
    batchStrategy: args.strategy || undefined,
    runProfile: profileOverride
  };
  if (args.local !== undefined) overrides.localMode = asBool(args.local);
  if (args['dry-run'] !== undefined) overrides.dryRun = asBool(args['dry-run']);
  if (args['mirror-to-s3'] !== undefined) overrides.mirrorToS3 = asBool(args['mirror-to-s3']);
  if (args['mirror-to-s3-input'] !== undefined) overrides.mirrorToS3Input = asBool(args['mirror-to-s3-input']);
  if (args['discovery-enabled'] !== undefined) overrides.discoveryEnabled = asBool(args['discovery-enabled']);
  if (args['search-provider']) overrides.searchProvider = args['search-provider'];
  if (args['fetch-candidate-sources'] !== undefined) overrides.fetchCandidateSources = asBool(args['fetch-candidate-sources']);
  return loadConfig(overrides);
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

function looksHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
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

async function commandIndexLab(config, storage, args) {
  const category = String(args.category || 'mouse').trim();
  const seed = String(args.seed || '').trim();
  const outRoot = String(args.out || pathNode.join('artifacts', 'indexlab')).trim();
  const productIdArg = String(args['product-id'] || '').trim();
  const fields = parseCsvList(args.fields);
  const providerTokens = parseCsvList(args.providers).map((entry) => entry.toLowerCase());

  const buildInputKey = (pid) => {
    const normalized = String(pid || '').trim().replace(/\.json$/i, '');
    if (!normalized) return '';
    return toPosixKey(config.s3InputPrefix, category, 'products', `${normalized}.json`);
  };

  let s3Key = String(args.s3key || '').trim();
  if (!s3Key && productIdArg) {
    s3Key = buildInputKey(productIdArg);
  }

  if (!s3Key && seed) {
    if (seed.endsWith('.json') || seed.includes('/')) {
      s3Key = seed;
    } else if (!seed.includes(' ') && !looksHttpUrl(seed)) {
      s3Key = buildInputKey(seed);
    }
  }

  if (!s3Key) {
    const seedIsUrl = looksHttpUrl(seed);
    const brand = String(args.brand || 'unknown').trim() || 'unknown';
    const model = String(args.model || args.sku || '').trim() || 'unknown-model';
    const variant = String(args.variant || '').trim();
    const sku = String(args.sku || '').trim();
    const title = String(args.title || (!seedIsUrl ? seed : '')).trim();
    const generatedProductId = productIdArg
      || [category, slug(brand), slug(model), slug(variant), `indexlab-${Date.now()}`]
        .filter(Boolean)
        .join('-');
    const job = {
      productId: generatedProductId,
      category,
      identityLock: {
        brand,
        model,
        variant,
        sku,
        title
      },
      seedUrls: seedIsUrl ? [seed] : parseCsvList(args['seed-urls'])
    };
    if (fields.length > 0) {
      job.requirements = {
        requiredFields: fields
      };
    }
    s3Key = buildInputKey(generatedProductId);
    await storage.writeObject(
      s3Key,
      Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
      { contentType: 'application/json' }
    );
  }

  const bridge = new IndexLabRuntimeBridge({
    outRoot,
    context: {
      category,
      s3Key
    }
  });
  const runConfig = {
    ...config,
    onRuntimeEvent: (row) => bridge.onRuntimeEvent(row)
  };
  const discoveryEnabledArg = asBool(args['discovery-enabled'], undefined);
  const searchProviderArg = String(args['search-provider'] || '').trim().toLowerCase();
  if (providerTokens.length === 1) {
    runConfig.searchProvider = providerTokens[0];
  } else if (providerTokens.length > 1) {
    runConfig.searchProvider = 'dual';
  }
  if (searchProviderArg) {
    runConfig.searchProvider = searchProviderArg;
  }
  if (typeof discoveryEnabledArg === 'boolean') {
    runConfig.discoveryEnabled = discoveryEnabledArg;
  } else if (String(runConfig.searchProvider || '').trim().toLowerCase() !== 'none') {
    runConfig.discoveryEnabled = true;
  }

  const convergenceEnabled = asBool(args.convergence, asBool(config.convergenceEnabled, false));
  const convergenceMaxRounds = Math.max(1, Number.parseInt(String(args['max-rounds'] || '0'), 10) || 0) || undefined;
  const convergenceMode = String(args.mode || config.accuracyMode || 'balanced').toLowerCase();

  let result;
  if (convergenceEnabled) {
    const job = await storage.readJson(s3Key);
    const loopResult = await runConvergenceLoop({
      runProductFn: runProduct,
      computeNeedSetFn: computeNeedSet,
      storage,
      config: runConfig,
      s3Key,
      job,
      maxRounds: convergenceMaxRounds,
      mode: convergenceMode,
      logger: bridgeAsLogger(bridge)
    });
    result = loopResult.final_result;
  } else {
    result = await runProduct({ storage, config: runConfig, s3Key });
  }

  bridge.setContext({
    category,
    productId: result.productId,
    s3Key
  });
  await bridge.finalize({
    status: 'completed',
    run_id: result.runId,
    run_base: result.exportInfo?.runBase || '',
    latest_base: result.exportInfo?.latestBase || ''
  });

  return {
    command: 'indexlab',
    category,
    productId: result.productId,
    runId: result.runId,
    s3Key,
    validated: result.summary.validated,
    confidence: result.summary.confidence,
    completeness_required_percent: result.summary.completeness_required_percent,
    coverage_overall_percent: result.summary.coverage_overall_percent,
    runBase: result.exportInfo.runBase,
    latestBase: result.exportInfo.latestBase,
    indexlab: {
      out_root: pathNode.resolve(outRoot),
      run_dir: pathNode.resolve(outRoot, result.runId),
      events_path: pathNode.resolve(outRoot, result.runId, 'run_events.ndjson'),
      run_meta_path: pathNode.resolve(outRoot, result.runId, 'run.json')
    }
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

async function commandCompileRules(config, _storage, args) {
  const all = asBool(args.all, false);
  const watch = asBool(args.watch, false);
  const workbookPath = String(args.workbook || '').trim();
  const mapPath = String(args.map || '').trim();
  const dryRun = asBool(args['dry-run'], false);
  if (all) {
    if (watch) {
      throw new Error('compile-rules --all does not support --watch');
    }
    const result = await compileRulesAll({
      dryRun,
      config
    });
    return {
      command: 'compile-rules',
      mode: 'all',
      ...result
    };
  }

  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('compile-rules requires --category <category> or --all');
  }
  if (watch) {
    const watchSeconds = Math.max(0, Number.parseInt(String(args['watch-seconds'] || '0'), 10) || 0);
    const maxEvents = Math.max(0, Number.parseInt(String(args['max-events'] || '0'), 10) || 0);
    const debounceMs = Math.max(50, Number.parseInt(String(args['debounce-ms'] || '500'), 10) || 500);
    const watchResult = await watchCompileRules({
      category,
      config,
      workbookPath,
      mapPath: mapPath || null,
      watchSeconds,
      maxEvents,
      debounceMs
    });
    return {
      command: 'compile-rules',
      mode: 'watch',
      ...watchResult
    };
  }
  const result = await compileRules({
    category,
    workbookPath,
    dryRun,
    config,
    mapPath: mapPath || null
  });
  return {
    command: 'compile-rules',
    ...result
  };
}

async function commandCompileReport(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('compile-report requires --category <category>');
  }
  const result = await readCompileReport({
    category,
    config
  });
  return {
    command: 'compile-report',
    ...result
  };
}

async function commandRulesDiff(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('rules-diff requires --category <category>');
  }
  const result = await rulesDiff({
    category,
    config
  });
  return {
    command: 'rules-diff',
    ...result
  };
}

async function commandCreateGolden(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('create-golden requires --category <category>');
  }
  const fromExcel = asBool(args['from-excel'], false);
  if (fromExcel) {
    const count = Math.max(1, Number.parseInt(String(args.count || '50'), 10) || 50);
    const productId = String(args['product-id'] || '').trim();
    const result = await createGoldenFromExcel({
      category,
      count,
      productId,
      config
    });
    return {
      command: 'create-golden',
      mode: 'from-excel',
      ...result
    };
  }

  const productId = String(args['product-id'] || '').trim();
  if (!productId) {
    throw new Error('create-golden requires --product-id <id> when --from-excel is not set');
  }
  const identity = parseJsonArg('identity-json', args['identity-json'], {});
  const fields = parseJsonArg('fields-json', args['fields-json'], {});
  const expectedUnknowns = parseJsonArg('unknowns-json', args['unknowns-json'], {});
  const notes = String(args.notes || '').trim();

  const result = await createGoldenFixture({
    category,
    productId,
    identity,
    fields,
    expectedUnknowns,
    notes,
    config
  });
  return {
    command: 'create-golden',
    mode: 'single',
    ...result
  };
}

async function commandTestGolden(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('test-golden requires --category <category>');
  }
  const result = await validateGoldenFixtures({
    category,
    config
  });
  return {
    command: 'test-golden',
    ...result
  };
}

async function commandQaJudge(config, storage, args) {
  const category = String(args.category || '').trim();
  const productId = String(args['product-id'] || args.product || '').trim();
  if (!category || !productId) {
    throw new Error('qa-judge requires --category <category> --product-id <id>');
  }
  return runQaJudge({
    storage,
    config,
    category,
    productId
  });
}

async function commandCalibrateConfidence(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('calibrate-confidence requires --category <category>');
  }
  const productId = String(args['product-id'] || '').trim();

  // Collect predictions from latest run summaries
  const predictions = [];
  const productIds = [];

  if (productId) {
    productIds.push(productId);
  } else {
    const allKeys = await storage.listInputKeys(category);
    for (const key of allKeys) {
      const job = await storage.readJsonOrNull(key);
      if (job?.productId) productIds.push(job.productId);
    }
  }

  for (const pid of productIds) {
    const latestBase = storage.resolveOutputKey(category, pid, 'latest');
    const summary = await storage.readJsonOrNull(`${latestBase}/summary.json`);
    const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
    if (!normalized?.fields) continue;

    for (const [field, value] of Object.entries(normalized.fields)) {
      const token = String(value ?? '').trim().toLowerCase();
      if (token === 'unk' || token === '') continue;
      const confidence = Number.parseFloat(
        String(summary?.field_confidence?.[field] ?? summary?.confidence ?? 0.5)
      ) || 0.5;
      predictions.push({ field, value, confidence, product_id: pid });
    }
  }

  // Load ground truth from golden files
  const goldenDir = `fixtures/golden/${category}`;
  const goldenKeys = await storage.listKeys?.(goldenDir) || [];
  const groundTruth = {};
  for (const gk of goldenKeys) {
    if (!gk.endsWith('.json')) continue;
    const golden = await storage.readJsonOrNull(gk);
    if (!golden?.expected_fields) continue;
    for (const [field, value] of Object.entries(golden.expected_fields)) {
      if (!groundTruth[field]) groundTruth[field] = value;
    }
  }

  const report = computeCalibrationReport({ predictions, groundTruth });
  return {
    command: 'calibrate-confidence',
    category,
    product_count: productIds.length,
    ...report
  };
}

async function commandAccuracyReport(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('accuracy-report requires --category <category>');
  }
  const format = String(args.format || 'json').trim().toLowerCase();
  const maxCases = Math.max(0, Number.parseInt(String(args['max-cases'] || '0'), 10) || 0);
  const report = await buildAccuracyReport({
    category,
    storage,
    config,
    maxCases
  });
  if (format === 'md') {
    return {
      command: 'accuracy-report',
      format: 'md',
      category: report.category,
      report_markdown: renderAccuracyReportMarkdown(report),
      report
    };
  }
  return {
    command: 'accuracy-report',
    format: 'json',
    ...report
  };
}

async function commandAccuracyBenchmark(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('accuracy-benchmark requires --category <category>');
  }
  const maxCases = Math.max(0, Number.parseInt(String(args['max-cases'] || '0'), 10) || 0);
  const period = String(args.period || 'weekly').trim().toLowerCase();
  const report = await runAccuracyBenchmarkReport({
    storage,
    config,
    category,
    period,
    maxCases
  });
  return {
    command: 'accuracy-benchmark',
    ...report
  };
}

async function commandAccuracyTrend(_config, storage, args) {
  const category = String(args.category || '').trim();
  const field = String(args.field || '').trim();
  if (!category || !field) {
    throw new Error('accuracy-trend requires --category <category> and --field <field>');
  }
  const period = String(args.period || '90d').trim();
  const result = await buildAccuracyTrend({
    storage,
    category,
    field,
    periodDays: period
  });
  return {
    command: 'accuracy-trend',
    ...result
  };
}

async function commandPublish(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('publish requires --category <category>');
  }
  const productIds = [];
  const singleProductId = String(args['product-id'] || '').trim();
  if (singleProductId) {
    productIds.push(singleProductId);
  }
  for (const productId of parseCsvList(args['product-ids'])) {
    productIds.push(productId);
  }
  const result = await publishProducts({
    storage,
    config,
    category,
    productIds,
    allApproved: asBool(args['all-approved'], false),
    format: String(args.format || 'all').trim().toLowerCase()
  });
  return {
    command: 'publish',
    ...result
  };
}

async function commandProvenance(_config, storage, args) {
  const category = String(args.category || '').trim();
  const productId = String(args['product-id'] || '').trim();
  if (!category || !productId) {
    throw new Error('provenance requires --category <category> and --product-id <id>');
  }
  const field = String(args.field || '').trim();
  const full = asBool(args.full, false);
  const result = await readPublishedProvenance({
    storage,
    category,
    productId,
    field,
    full
  });
  return {
    command: 'provenance',
    ...result
  };
}

async function commandChangelog(_config, storage, args) {
  const category = String(args.category || '').trim();
  const productId = String(args['product-id'] || '').trim();
  if (!category || !productId) {
    throw new Error('changelog requires --category <category> and --product-id <id>');
  }
  const result = await readPublishedChangelog({
    storage,
    category,
    productId
  });
  return {
    command: 'changelog',
    ...result
  };
}

async function commandSourceHealth(_config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('source-health requires --category <category>');
  }
  const result = await buildSourceHealth({
    storage,
    category,
    source: String(args.source || '').trim(),
    periodDays: String(args.period || '30d').trim()
  });
  return {
    command: 'source-health',
    ...result
  };
}

async function commandLlmMetrics(config, storage, args) {
  const result = await buildLlmMetrics({
    storage,
    config,
    period: String(args.period || 'week').trim(),
    model: String(args.model || '').trim()
  });
  return {
    command: 'llm-metrics',
    ...result
  };
}

async function commandPhase10Bootstrap(config, _storage, args) {
  const categories = parseExpansionCategories(args.categories, ['monitor', 'keyboard']);
  const template = String(args.template || 'electronics').trim() || 'electronics';
  const helperRoot = String(args['helper-root'] || config.helperFilesRoot || 'helper_files').trim();
  const categoriesRoot = String(args['categories-root'] || 'categories').trim();
  const goldenRoot = String(args['golden-root'] || 'fixtures/golden').trim();
  const result = await bootstrapExpansionCategories({
    config: {
      ...config,
      helperFilesRoot: helperRoot,
      categoriesRoot
    },
    categories,
    template,
    goldenRoot
  });
  return {
    command: 'phase10-bootstrap',
    ...result
  };
}

async function commandHardeningHarness(config, storage, args) {
  const category = String(args.category || 'mouse').trim() || 'mouse';
  const products = Math.max(1, Number.parseInt(String(args.products || '200'), 10) || 200);
  const cycles = Math.max(1, Number.parseInt(String(args.cycles || '100'), 10) || 100);
  const fuzzIterations = Math.max(1, Number.parseInt(String(args['fuzz-iterations'] || '200'), 10) || 200);
  const seed = Math.max(1, Number.parseInt(String(args.seed || '1337'), 10) || 1337);
  const failureAttempts = Math.max(1, Number.parseInt(String(args['failure-attempts'] || '3'), 10) || 3);

  const queueLoad = await runQueueLoadHarness({
    storage,
    category,
    productCount: products,
    selectCycles: cycles
  });
  const failureInjection = await runFailureInjectionHarness({
    storage,
    category,
    maxAttempts: failureAttempts
  });
  const fuzzSourceHealth = await runFuzzSourceHealthHarness({
    storage,
    category,
    iterations: fuzzIterations,
    seed
  });
  return {
    command: 'hardening-harness',
    category,
    queue_load: queueLoad,
    failure_injection: failureInjection,
    fuzz_source_health: fuzzSourceHealth,
    passed: Boolean(queueLoad.select_cycles_completed > 0 && failureInjection.passed && fuzzSourceHealth.passed)
  };
}

async function commandHardeningReport(_config, _storage, args) {
  const rootDir = String(args['root-dir'] || process.cwd()).trim() || process.cwd();
  const report = await runProductionHardeningReport({
    rootDir
  });
  return {
    command: 'hardening-report',
    ...report
  };
}

async function commandDriftScan(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('drift-scan requires --category <category>');
  }
  const maxProducts = Math.max(1, Number.parseInt(String(args['max-products'] || '250'), 10) || 250);
  const result = await scanAndEnqueueDriftedProducts({
    storage,
    config,
    category,
    maxProducts,
    queueOnChange: asBool(args.enqueue, true)
  });
  return {
    command: 'drift-scan',
    ...result
  };
}

async function commandDriftReconcile(config, storage, args) {
  const category = String(args.category || '').trim();
  const productId = String(args['product-id'] || '').trim();
  if (!category || !productId) {
    throw new Error('drift-reconcile requires --category <category> and --product-id <id>');
  }
  const result = await reconcileDriftedProduct({
    storage,
    config,
    category,
    productId,
    autoRepublish: asBool(args['auto-republish'], true)
  });
  return {
    command: 'drift-reconcile',
    ...result
  };
}

async function commandProductReconcile(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('product-reconcile requires --category <category>');
  }
  const dryRun = asBool(args['dry-run'], true);
  const result = await reconcileOrphans({
    storage,
    category,
    config,
    dryRun
  });
  return result;
}

async function commandGenerateTypes(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('generate-types requires --category <category>');
  }
  const outDir = String(args['out-dir'] || '').trim();
  const result = await generateTypesForCategory({
    category,
    config,
    outDir
  });
  return {
    command: 'generate-types',
    ...result
  };
}

async function commandValidateRules(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('validate-rules requires --category <category>');
  }
  const result = await validateRules({
    category,
    config
  });
  return {
    command: 'validate-rules',
    ...result
  };
}

async function commandInitCategory(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('init-category requires --category <category>');
  }
  const template = String(args.template || 'electronics').trim() || 'electronics';
  const result = await initCategory({
    category,
    template,
    config
  });
  return {
    command: 'init-category',
    ...result
  };
}

async function commandListFields(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('list-fields requires --category <category>');
  }
  const result = await listFields({
    category,
    config,
    group: String(args.group || ''),
    requiredLevel: String(args['required-level'] || '')
  });
  return {
    command: 'list-fields',
    ...result
  };
}

async function commandFieldReport(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('field-report requires --category <category>');
  }
  const format = String(args.format || 'md').trim().toLowerCase();
  const result = await fieldReport({
    category,
    config,
    format
  });
  return {
    command: 'field-report',
    ...result
  };
}

async function commandFieldRulesVerify(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) {
    throw new Error('field-rules-verify requires --category <category>');
  }
  const fixturePath = String(args.fixture || '').trim();
  const strictBytes = asBool(args['strict-bytes'], false);
  const result = await verifyGeneratedFieldRules({
    category,
    config,
    fixturePath,
    strictBytes
  });
  return {
    command: 'field-rules-verify',
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

function parseQueuePriority(value, fallback = 3) {
  const parsed = Number.parseInt(String(value || ''), 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(1, Math.min(5, resolved));
}

function queueStatusSummary(products = {}) {
  const status = {};
  const priority = {};
  for (const row of Object.values(products || {})) {
    const statusKey = String(row?.status || 'pending').trim().toLowerCase() || 'pending';
    const priorityKey = String(Math.max(1, Math.min(5, Number.parseInt(String(row?.priority || '3'), 10) || 3)));
    status[statusKey] = (status[statusKey] || 0) + 1;
    priority[priorityKey] = (priority[priorityKey] || 0) + 1;
  }
  return {
    status,
    priority
  };
}

async function commandQueue(config, storage, args) {
  const category = String(args.category || 'mouse').trim() || 'mouse';
  const action = String(args._?.[0] || '').trim().toLowerCase();
  if (!action) {
    throw new Error('queue requires a subcommand: add|add-batch|list|stats|retry|pause|clear');
  }

  if (action === 'add') {
    const brand = String(args.brand || '').trim();
    const model = String(args.model || '').trim();
    const variant = String(args.variant || '').trim();
    const productId = String(
      args['product-id'] || [category, slug(brand), slug(model), slug(variant)].filter(Boolean).join('-')
    ).trim();
    if (!productId) {
      throw new Error('queue add requires --product-id or --brand/--model');
    }

    const s3key = String(
      args.s3key || toPosixKey(config.s3InputPrefix, category, 'products', `${productId}.json`)
    ).trim();
    if (!s3key) {
      throw new Error('queue add could not resolve s3key');
    }

    const hasJobPayload = await storage.objectExists(s3key);
    if (!hasJobPayload) {
      if (!brand || !model) {
        throw new Error('queue add requires an existing --s3key job or --brand/--model to create one');
      }
      const identityLock = {
        brand,
        model,
        variant,
        sku: String(args.sku || '').trim(),
        mpn: String(args.mpn || '').trim(),
        gtin: String(args.gtin || '').trim()
      };
      const job = {
        productId,
        category,
        identityLock,
        seedUrls: parseCsvList(args['seed-urls']),
        anchors: parseJsonArg('anchors-json', args['anchors-json'], {})
      };
      const requirements = parseJsonArg('requirements-json', args['requirements-json'], null);
      if (requirements && typeof requirements === 'object') {
        job.requirements = requirements;
      }
      await storage.writeObject(
        s3key,
        Buffer.from(JSON.stringify(job, null, 2), 'utf8'),
        { contentType: 'application/json' }
      );
    }

    const priority = parseQueuePriority(args.priority, 3);
    const product = await upsertQueueProduct({
      storage,
      category,
      productId,
      s3key,
      patch: {
        status: 'pending',
        priority,
        retry_count: 0,
        next_retry_at: '',
        next_action_hint: 'fast_pass',
        priority_reason: String(args['priority-reason'] || 'manual_add').trim() || 'manual_add'
      }
    });
    return {
      command: 'queue',
      action,
      category,
      product: product.product
    };
  }

  if (action === 'add-batch') {
    const csvPath = String(args.file || args.path || '').trim();
    if (!csvPath) {
      throw new Error('queue add-batch requires --file <csv>');
    }
    const result = await ingestCsvFile({
      storage,
      config,
      category,
      csvPath,
      importsRoot: args['imports-root'] || config.importsRoot
    });
    return {
      command: 'queue',
      action,
      category,
      ...result
    };
  }

  if (action === 'list') {
    const sync = asBool(args.sync, false);
    if (sync) {
      await syncQueueFromInputs({ storage, category });
    }
    const status = String(args.status || '').trim().toLowerCase();
    const limit = Math.max(1, Number.parseInt(String(args.limit || '100'), 10) || 100);
    const rows = await listQueueProducts({
      storage,
      category,
      status,
      limit
    });
    return {
      command: 'queue',
      action,
      category,
      status: status || null,
      count: rows.length,
      products: rows
    };
  }

  if (action === 'stats') {
    const sync = asBool(args.sync, false);
    if (sync) {
      await syncQueueFromInputs({ storage, category });
    }
    const loaded = await loadQueueState({ storage, category });
    const products = loaded.state.products || {};
    return {
      command: 'queue',
      action,
      category,
      total_products: Object.keys(products).length,
      ...queueStatusSummary(products)
    };
  }

  if (action === 'retry' || action === 'pause') {
    const productId = String(args['product-id'] || '').trim();
    if (!productId) {
      throw new Error(`queue ${action} requires --product-id <id>`);
    }
    const loaded = await loadQueueState({ storage, category });
    const existing = loaded.state.products?.[productId];
    if (!existing) {
      throw new Error(`queue ${action} could not find product '${productId}'`);
    }
    const nextStatus = action === 'retry' ? 'pending' : 'paused';
    const nextActionHint = action === 'retry' ? 'retry_manual' : 'manual_pause';
    const patched = await upsertQueueProduct({
      storage,
      category,
      productId,
      s3key: String(existing.s3key || '').trim(),
      patch: {
        status: nextStatus,
        next_action_hint: nextActionHint,
        last_error: action === 'retry' ? '' : existing.last_error || '',
        retry_count: action === 'retry' ? 0 : existing.retry_count,
        next_retry_at: action === 'retry' ? '' : existing.next_retry_at
      }
    });
    return {
      command: 'queue',
      action,
      category,
      product: patched.product
    };
  }

  if (action === 'clear') {
    const status = String(args.status || '').trim().toLowerCase();
    if (!status) {
      throw new Error('queue clear requires --status <status>');
    }
    const result = await clearQueueByStatus({
      storage,
      category,
      status
    });
    return {
      command: 'queue',
      action,
      category,
      status,
      ...result
    };
  }

  throw new Error(`Unknown queue subcommand: ${action}`);
}

async function commandReview(config, storage, args) {
  const category = String(args.category || 'mouse').trim() || 'mouse';
  const action = String(args._?.[0] || '').trim().toLowerCase();
  if (!action) {
    throw new Error('review requires a subcommand: layout|queue|product|build|ws-queue|override|approve-greens|manual-override|finalize|metrics|suggest');
  }

  if (action === 'layout') {
    const layout = await buildReviewLayout({ storage, config, category });
    return {
      command: 'review',
      action,
      ...layout
    };
  }

  if (action === 'queue') {
    const status = String(args.status || 'needs_review').trim().toLowerCase();
    const limit = Math.max(1, Number.parseInt(String(args.limit || '100'), 10) || 100);
    const specDb = await openSpecDbForCategory(config, category);
    let items;
    try {
      items = await buildReviewQueue({
        storage,
        config,
        category,
        status,
        limit,
        specDb
      });
    } finally {
      try { specDb?.close(); } catch { /* no-op */ }
    }
    return {
      command: 'review',
      action,
      category,
      status,
      count: items.length,
      items
    };
  }

  if (action === 'product') {
    const productId = String(args['product-id'] || '').trim();
    if (!productId) {
      throw new Error('review product requires --product-id <id>');
    }
    const includeCandidates = !asBool(args['without-candidates'], false) && !asBool(args['selected-only'], false);
    const specDb = await openSpecDbForCategory(config, category);
    let payload;
    try {
      payload = await buildProductReviewPayload({
        storage,
        config,
        category,
        productId,
        includeCandidates,
        specDb
      });
    } finally {
      try { specDb?.close(); } catch { /* no-op */ }
    }
    return {
      command: 'review',
      action,
      category,
      ...payload
    };
  }

  if (action === 'build') {
    const productId = String(args['product-id'] || '').trim();
    const status = String(args.status || 'needs_review').trim().toLowerCase();
    const limit = Math.max(1, Number.parseInt(String(args.limit || '500'), 10) || 500);
    const product = productId
      ? await writeProductReviewArtifacts({
        storage,
        config,
        category,
        productId
      })
      : null;
    const queue = await writeCategoryReviewArtifacts({
      storage,
      config,
      category,
      status,
      limit
    });
    return {
      command: 'review',
      action,
      category,
      product: product || null,
      queue
    };
  }

  if (action === 'ws-queue') {
    const status = String(args.status || 'needs_review').trim().toLowerCase();
    const limit = Math.max(1, Number.parseInt(String(args.limit || '200'), 10) || 200);
    const host = String(args.host || '127.0.0.1').trim() || '127.0.0.1';
    const port = Math.max(1, Number.parseInt(String(args.port || '8789'), 10) || 8789);
    const pollSeconds = Math.max(1, Number.parseInt(String(args['poll-seconds'] || '5'), 10) || 5);
    const durationSeconds = Math.max(0, Number.parseInt(String(args['duration-seconds'] || '0'), 10) || 0);
    const wsServer = await startReviewQueueWebSocket({
      storage,
      config,
      category,
      status,
      limit,
      host,
      port,
      pollSeconds
    });

    let stopReason = 'duration_elapsed';
    if (durationSeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, durationSeconds * 1000));
    } else {
      stopReason = await new Promise((resolve) => {
        const onSigInt = () => {
          process.off('SIGTERM', onSigTerm);
          resolve('signal:SIGINT');
        };
        const onSigTerm = () => {
          process.off('SIGINT', onSigInt);
          resolve('signal:SIGTERM');
        };
        process.once('SIGINT', onSigInt);
        process.once('SIGTERM', onSigTerm);
      });
    }
    await wsServer.stop();
    return {
      command: 'review',
      action,
      category,
      status,
      limit,
      host,
      port: wsServer.port,
      poll_seconds: wsServer.poll_seconds,
      ws_url: wsServer.ws_url,
      health_url: wsServer.health_url,
      stop_reason: stopReason
    };
  }

  if (action === 'override') {
    const productId = String(args['product-id'] || '').trim();
    const field = String(args.field || '').trim();
    const candidateId = String(args['candidate-id'] || '').trim();
    if (!productId || !field || !candidateId) {
      throw new Error('review override requires --product-id --field --candidate-id');
    }
    const specDb = await openSpecDbForCategory(config, category);
    let result;
    try {
      result = await setOverrideFromCandidate({
        storage,
        config,
        category,
        productId,
        field,
        candidateId,
        reason: String(args.reason || '').trim(),
        reviewer: String(args.reviewer || '').trim(),
        specDb
      });
    } finally {
      try { specDb?.close(); } catch { /* no-op */ }
    }
    return {
      command: 'review',
      action,
      category,
      ...result
    };
  }

  if (action === 'approve-greens') {
    const productId = String(args['product-id'] || '').trim();
    if (!productId) {
      throw new Error('review approve-greens requires --product-id <id>');
    }
    const result = await approveGreenOverrides({
      storage,
      config,
      category,
      productId,
      reason: String(args.reason || '').trim(),
      reviewer: String(args.reviewer || '').trim()
    });
    return {
      command: 'review',
      action,
      category,
      product_id: productId,
      ...result
    };
  }

  if (action === 'manual-override') {
    const productId = String(args['product-id'] || '').trim();
    const field = String(args.field || '').trim();
    const value = String(args.value || '').trim();
    if (!productId || !field || !value) {
      throw new Error('review manual-override requires --product-id --field --value');
    }
    const specDb = await openSpecDbForCategory(config, category);
    let result;
    try {
      result = await setManualOverride({
        storage,
        config,
        category,
        productId,
        field,
        value,
        reason: String(args.reason || '').trim(),
        reviewer: String(args.reviewer || '').trim(),
        evidence: {
          url: String(args['evidence-url'] || '').trim(),
          quote: String(args['evidence-quote'] || '').trim(),
          quote_span: parseJsonArg('evidence-quote-span', args['evidence-quote-span'], null),
          snippet_id: String(args['evidence-snippet-id'] || '').trim(),
          snippet_hash: String(args['evidence-snippet-hash'] || '').trim(),
          source_id: String(args['evidence-source-id'] || '').trim(),
          retrieved_at: String(args['evidence-retrieved-at'] || '').trim()
        },
        specDb
      });
    } finally {
      try { specDb?.close(); } catch { /* no-op */ }
    }
    return {
      command: 'review',
      action,
      category,
      ...result
    };
  }

  if (action === 'finalize') {
    const productId = String(args['product-id'] || '').trim();
    if (!productId) {
      throw new Error('review finalize requires --product-id <id>');
    }
    const specDb = await openSpecDbForCategory(config, category);
    let result;
    try {
      result = await finalizeOverrides({
        storage,
        config,
        category,
        productId,
        applyOverrides: asBool(args.apply, false),
        saveAsDraft: asBool(args.draft, false),
        reviewer: String(args.reviewer || '').trim(),
        specDb
      });
    } finally {
      try { specDb?.close(); } catch { /* no-op */ }
    }
    return {
      command: 'review',
      action,
      category,
      ...result
    };
  }

  if (action === 'metrics') {
    const windowHours = Math.max(1, Number.parseInt(String(args['window-hours'] || '24'), 10) || 24);
    const result = await buildReviewMetrics({
      config,
      category,
      windowHours
    });
    return {
      command: 'review',
      action,
      ...result
    };
  }

  if (action === 'suggest') {
    const type = String(args.type || '').trim().toLowerCase();
    const field = String(args.field || '').trim();
    const value = String(args.value || '').trim();
    if (!type || !field || !value) {
      throw new Error('review suggest requires --type --field --value');
    }
    const result = await appendReviewSuggestion({
      config,
      category,
      type,
      payload: {
        product_id: String(args['product-id'] || '').trim(),
        field,
        value,
        canonical: String(args.canonical || '').trim(),
        reason: String(args.reason || '').trim(),
        reviewer: String(args.reviewer || '').trim(),
        evidence: {
          url: String(args['evidence-url'] || '').trim(),
          quote: String(args['evidence-quote'] || '').trim(),
          quote_span: parseJsonArg('evidence-quote-span', args['evidence-quote-span'], null),
          snippet_id: String(args['evidence-snippet-id'] || '').trim(),
          snippet_hash: String(args['evidence-snippet-hash'] || '').trim()
        }
      }
    });
    return {
      command: 'review',
      action,
      category,
      ...result
    };
  }

  throw new Error(`Unknown review subcommand: ${action}`);
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

async function commandBenchmark(config, storage, args, commandName = 'benchmark') {
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
    command: commandName,
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

function parseJsonArgSafe(name, value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new Error(`Invalid JSON for --${name}: ${error.message}`);
  }
}

function createCortexLifecycle(config) {
  return new CortexLifecycle({
    CHATMOCK_DIR: config.chatmockDir,
    CHATMOCK_COMPOSE_FILE: config.chatmockComposeFile,
    CORTEX_BASE_URL: config.cortexBaseUrl,
    CORTEX_AUTO_START: String(config.cortexAutoStart),
    CORTEX_ENSURE_READY_TIMEOUT_MS: config.cortexEnsureReadyTimeoutMs,
    CORTEX_START_READY_TIMEOUT_MS: config.cortexStartReadyTimeoutMs
  });
}

async function commandCortexLifecycle(config, _storage, action) {
  const lifecycle = createCortexLifecycle(config);
  if (action === 'start') {
    const result = await lifecycle.start();
    return { command: 'cortex-start', ...result };
  }
  if (action === 'stop') {
    const result = await lifecycle.stop();
    return { command: 'cortex-stop', ...result };
  }
  if (action === 'restart') {
    const result = await lifecycle.restart();
    return { command: 'cortex-restart', ...result };
  }
  if (action === 'ensure') {
    const result = await lifecycle.ensureRunning();
    return { command: 'cortex-ensure', ...result };
  }
  const result = await lifecycle.status();
  return { command: 'cortex-status', ...result };
}

async function commandCortexRoutePlan(config, _storage, args) {
  const tasks = parseJsonArgSafe('tasks-json', args['tasks-json'], [
    { id: 'audit-default', type: 'evidence_audit', critical: true },
    { id: 'triage-default', type: 'conflict_resolution', critical: true }
  ]);
  const context = parseJsonArgSafe('context-json', args['context-json'], {
    confidence: 0.9,
    critical_conflicts_remain: false,
    critical_gaps_remain: false,
    evidence_audit_failed_on_critical: false
  });
  const plan = buildCortexTaskPlan({
    tasks: Array.isArray(tasks) ? tasks : [],
    context: (context && typeof context === 'object') ? context : {},
    config
  });
  return {
    command: 'cortex-route-plan',
    ...plan
  };
}

async function commandCortexRunPass(config, _storage, args) {
  const tasks = parseJsonArgSafe('tasks-json', args['tasks-json'], [
    { id: 'audit-default', type: 'evidence_audit', critical: true }
  ]);
  const context = parseJsonArgSafe('context-json', args['context-json'], {
    confidence: 0.9,
    critical_conflicts_remain: false,
    critical_gaps_remain: false,
    evidence_audit_failed_on_critical: false
  });
  const client = new CortexClient({ config });
  const result = await client.runPass({
    tasks: Array.isArray(tasks) ? tasks : [],
    context: (context && typeof context === 'object') ? context : {}
  });
  return {
    command: 'cortex-run-pass',
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

async function commandSeedDb(config, _storage, args) {
  const category = String(args.category || '').trim();
  if (!category) throw new Error('seed-db requires --category');

  const { loadFieldRules } = await import('../field-rules/loader.js');
  const { SpecDb } = await import('../db/specDb.js');
  const { seedSpecDb } = await import('../db/seed.js');

  const fieldRules = await loadFieldRules(category, { config });
  const dbDir = pathNode.join(config.specDbDir || '.specfactory_tmp', category);
  await fsNode.mkdir(dbDir, { recursive: true });
  const dbPath = pathNode.join(dbDir, 'spec.sqlite');
  const db = new SpecDb({ dbPath, category });

  try {
    const result = await seedSpecDb({ db, config, category, fieldRules, logger: null });
    return { command: 'seed-db', category, db_path: dbPath, ...result };
  } finally {
    db.close();
  }
}

async function commandMigrateToSqlite(config, storage, args) {
  const category = String(args.category || '').trim();
  if (!category) throw new Error('migrate-to-sqlite requires --category');
  const phase = args.phase ? Number.parseInt(String(args.phase), 10) : 0;
  const specDb = await openSpecDbForCategory(config, category);
  if (!specDb) throw new Error(`Could not open SpecDb for category: ${category}`);

  const results = {};

  try {
    // Phase 1: Queue state — verify SQLite has rows (already migrated via dual-write)
    if (!phase || phase === 1) {
      const rows = specDb.getAllQueueProducts();
      results.phase1_queue = { status: 'verified', rows: rows.length };
    }

    // Phase 2: Billing ledger — import NDJSON files
    if (!phase || phase === 2) {
      let imported = 0;
      const billingPrefix = toPosixKey(config.s3OutputPrefix, '_billing');
      const keys = await storage.listKeys(billingPrefix);
      const ledgerKeys = keys.filter((k) => k.endsWith('.jsonl') && k.includes('ledger'));
      for (const key of ledgerKeys) {
        const text = await storage.readTextOrNull(key);
        if (!text) continue;
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const entry = JSON.parse(trimmed);
            const ts = String(entry.ts || '');
            specDb.insertBillingEntry({
              ts,
              month: ts.slice(0, 7),
              day: ts.slice(0, 10),
              provider: entry.provider || 'unknown',
              model: entry.model || 'unknown',
              category: entry.category || '',
              product_id: entry.productId || entry.product_id || '',
              run_id: entry.runId || entry.run_id || '',
              round: entry.round || 0,
              prompt_tokens: entry.prompt_tokens || 0,
              completion_tokens: entry.completion_tokens || 0,
              cached_prompt_tokens: entry.cached_prompt_tokens || 0,
              total_tokens: entry.total_tokens || 0,
              cost_usd: entry.cost_usd || 0,
              reason: entry.reason || 'extract',
              host: entry.host || '',
              url_count: entry.url_count || 0,
              evidence_chars: entry.evidence_chars || 0,
              estimated_usage: entry.estimated_usage ? 1 : 0,
              meta: JSON.stringify(entry.meta || {})
            });
            imported += 1;
          } catch { /* skip malformed lines */ }
        }
      }
      results.phase2_billing = { status: 'imported', entries: imported, files: ledgerKeys.length };
    }

    // Phase 3: LLM cache — import cache dir files
    if (!phase || phase === 3) {
      let imported = 0;
      const cacheDir = config.llmExtractionCacheDir || '.specfactory_tmp/llm_cache';
      try {
        const files = await fsNode.readdir(cacheDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const key = file.replace(/\.json$/, '');
          try {
            const raw = await fsNode.readFile(pathNode.join(cacheDir, file), 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.response !== undefined && parsed.timestamp > 0) {
              const ttl = parsed.ttl || 7 * 24 * 60 * 60 * 1000;
              if ((Date.now() - parsed.timestamp) <= ttl) {
                specDb.setLlmCacheEntry(key, JSON.stringify(parsed.response), parsed.timestamp, ttl);
                imported += 1;
              }
            }
          } catch { /* skip bad files */ }
        }
      } catch { /* cache dir may not exist */ }
      results.phase3_cache = { status: 'imported', entries: imported };
    }

    // Phase 4: Learning profiles — import profile JSONs
    if (!phase || phase === 4) {
      let imported = 0;
      const learningPrefix = toPosixKey(config.s3OutputPrefix, '_learning', category, 'profiles');
      const keys = await storage.listKeys(learningPrefix);
      for (const key of keys) {
        if (!key.endsWith('.json')) continue;
        try {
          const profile = await storage.readJsonOrNull(key);
          if (!profile) continue;
          const profileId = profile.profile_id || key.split('/').pop()?.replace(/\.json$/, '') || '';
          specDb.upsertLearningProfile({
            profile_id: profileId,
            category: profile.category || category,
            brand: profile.brand || '',
            model: profile.model || '',
            variant: profile.variant || '',
            runs_total: profile.runs_total || 0,
            validated_runs: profile.validated_runs || 0,
            validated: profile.validated ? 1 : 0,
            unknown_field_rate: profile.unknown_field_rate || 0,
            unknown_field_rate_avg: profile.unknown_field_rate_avg || 0,
            parser_health_avg: profile.parser_health_avg || 0,
            preferred_urls: JSON.stringify(profile.preferred_urls || []),
            feedback_urls: JSON.stringify(profile.feedback_urls || []),
            uncertain_fields: JSON.stringify(profile.uncertain_fields || []),
            host_stats: JSON.stringify(profile.host_stats || []),
            critical_fields_below: JSON.stringify(profile.critical_fields_below_pass_target || []),
            last_run: JSON.stringify(profile.last_run || {}),
            parser_health: JSON.stringify(profile.parser_health || {}),
            updated_at: profile.updated_at || new Date().toISOString()
          });
          imported += 1;
        } catch { /* skip bad files */ }
      }
      results.phase4_learning = { status: 'imported', profiles: imported };
    }

    // Phase 5: Category brain — import 8 artifact files
    if (!phase || phase === 5) {
      let imported = 0;
      const artifactNames = [
        'field_lexicon', 'constraints', 'field_yield', 'identity_grammar',
        'query_templates', 'source_promotions', 'stats', 'field_availability'
      ];
      for (const name of artifactNames) {
        const key = toPosixKey(config.s3OutputPrefix, '_learning', category, `${name}.json`);
        try {
          const data = await storage.readJsonOrNull(key);
          if (data) {
            specDb.upsertCategoryBrainArtifact(category, name, data);
            imported += 1;
          }
        } catch { /* skip */ }
      }
      results.phase5_brain = { status: 'imported', artifacts: imported };
    }

    // Phase 6: Source intel — decompose domain_stats.json
    if (!phase || phase === 6) {
      const intelKey = toPosixKey(config.s3OutputPrefix, '_source_intel', category, 'domain_stats.json');
      const data = await storage.readJsonOrNull(intelKey);
      if (data && data.domains) {
        specDb.persistSourceIntelFull(category, data.domains);
        results.phase6_intel = { status: 'imported', domains: Object.keys(data.domains).length };
      } else {
        results.phase6_intel = { status: 'skipped', reason: 'no domain_stats.json found' };
      }
    }

    // Phase 7: Source corpus — import corpus.json
    if (!phase || phase === 7) {
      const corpusKey = toPosixKey(config.s3OutputPrefix, '_source_intel', category, 'corpus.json');
      const data = await storage.readJsonOrNull(corpusKey);
      if (data && Array.isArray(data.documents || data)) {
        const docs = data.documents || data;
        specDb.upsertSourceCorpusBatch(docs.map((doc) => ({
          url: doc.url || '',
          category,
          host: doc.host || '',
          root_domain: doc.rootDomain || doc.root_domain || '',
          path: doc.path || '',
          title: doc.title || '',
          snippet: doc.snippet || '',
          tier: doc.tier ?? 99,
          role: doc.role || '',
          fields: JSON.stringify(doc.fields || []),
          methods: JSON.stringify(doc.methods || []),
          identity_match: doc.identity_match ? 1 : 0,
          first_seen_at: doc.first_seen_at || null,
          last_seen_at: doc.last_seen_at || null
        })));
        results.phase7_corpus = { status: 'imported', documents: docs.length };
      } else {
        results.phase7_corpus = { status: 'skipped', reason: 'no corpus.json found' };
      }
    }

    // Phase 8: Frontier — already has its own migration
    if (!phase || phase === 8) {
      results.phase8_frontier = { status: 'skipped', note: 'frontier has built-in migration' };
    }

    const counts = specDb.counts();
    return {
      command: 'migrate-to-sqlite',
      category,
      phase: phase || 'all',
      results,
      table_counts: counts
    };
  } finally {
    specDb.close();
  }
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
  const validation = validateConfig(config);
  for (const warning of validation.warnings) {
    process.stderr.write(`[config-warning] ${warning.code}: ${warning.message}\n`);
  }
  if (!validation.valid) {
    for (const error of validation.errors) {
      process.stderr.write(`[config-error] ${error.code}: ${error.message}\n`);
    }
    process.exitCode = 1;
    return;
  }
  const storage = createStorage(config);

  let output;
  if (command === 'run-one') {
    output = await commandRunOne(config, storage, args);
  } else if (command === 'indexlab') {
    output = await commandIndexLab(config, storage, args);
  } else if (command === 'run-ad-hoc') {
    output = await commandRunAdHoc(config, storage, args);
  } else if (command === 'run-until-complete') {
    output = await commandRunUntilComplete(config, storage, args);
  } else if (command === 'category-compile') {
    output = await commandCategoryCompile(config, storage, args);
  } else if (command === 'compile-rules') {
    output = await commandCompileRules(config, storage, args);
  } else if (command === 'compile-report') {
    output = await commandCompileReport(config, storage, args);
  } else if (command === 'rules-diff') {
    output = await commandRulesDiff(config, storage, args);
  } else if (command === 'validate-rules') {
    output = await commandValidateRules(config, storage, args);
  } else if (command === 'init-category') {
    output = await commandInitCategory(config, storage, args);
  } else if (command === 'list-fields') {
    output = await commandListFields(config, storage, args);
  } else if (command === 'field-report') {
    output = await commandFieldReport(config, storage, args);
  } else if (command === 'field-rules-verify') {
    output = await commandFieldRulesVerify(config, storage, args);
  } else if (command === 'create-golden') {
    output = await commandCreateGolden(config, storage, args);
  } else if (command === 'test-golden') {
    output = await commandTestGolden(config, storage, args);
  } else if (command === 'qa-judge') {
    output = await commandQaJudge(config, storage, args);
  } else if (command === 'calibrate-confidence') {
    output = await commandCalibrateConfidence(config, storage, args);
  } else if (command === 'accuracy-report') {
    output = await commandAccuracyReport(config, storage, args);
  } else if (command === 'accuracy-benchmark') {
    output = await commandAccuracyBenchmark(config, storage, args);
  } else if (command === 'accuracy-trend') {
    output = await commandAccuracyTrend(config, storage, args);
  } else if (command === 'generate-types') {
    output = await commandGenerateTypes(config, storage, args);
  } else if (command === 'publish') {
    output = await commandPublish(config, storage, args);
  } else if (command === 'provenance') {
    output = await commandProvenance(config, storage, args);
  } else if (command === 'changelog') {
    output = await commandChangelog(config, storage, args);
  } else if (command === 'source-health') {
    output = await commandSourceHealth(config, storage, args);
  } else if (command === 'llm-metrics') {
    output = await commandLlmMetrics(config, storage, args);
  } else if (command === 'phase10-bootstrap') {
    output = await commandPhase10Bootstrap(config, storage, args);
  } else if (command === 'hardening-harness') {
    output = await commandHardeningHarness(config, storage, args);
  } else if (command === 'hardening-report') {
    output = await commandHardeningReport(config, storage, args);
  } else if (command === 'drift-scan') {
    output = await commandDriftScan(config, storage, args);
  } else if (command === 'drift-reconcile') {
    output = await commandDriftReconcile(config, storage, args);
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
  } else if (command === 'queue') {
    output = await commandQueue(config, storage, args);
  } else if (command === 'review') {
    output = await commandReview(config, storage, args);
  } else if (command === 'billing-report') {
    output = await commandBillingReport(config, storage, args);
  } else if (command === 'learning-report') {
    output = await commandLearningReport(config, storage, args);
  } else if (command === 'explain-unk') {
    output = await commandExplainUnk(config, storage, args);
  } else if (command === 'llm-health') {
    output = await commandLlmHealth(config, storage, args);
  } else if (command === 'cortex-start') {
    output = await commandCortexLifecycle(config, storage, 'start');
  } else if (command === 'cortex-stop') {
    output = await commandCortexLifecycle(config, storage, 'stop');
  } else if (command === 'cortex-restart') {
    output = await commandCortexLifecycle(config, storage, 'restart');
  } else if (command === 'cortex-status') {
    output = await commandCortexLifecycle(config, storage, 'status');
  } else if (command === 'cortex-ensure') {
    output = await commandCortexLifecycle(config, storage, 'ensure');
  } else if (command === 'cortex-route-plan') {
    output = await commandCortexRoutePlan(config, storage, args);
  } else if (command === 'cortex-run-pass') {
    output = await commandCortexRunPass(config, storage, args);
  } else if (command === 'test-s3') {
    output = await commandTestS3();
  } else if (command === 'sources-plan') {
    output = await commandSourcesPlan(config, storage, args);
  } else if (command === 'sources-report') {
    output = await commandSourcesReport(config, storage, args);
  } else if (command === 'rebuild-index') {
    output = await commandRebuildIndex(config, storage, args);
  } else if (command === 'benchmark') {
    output = await commandBenchmark(config, storage, args, 'benchmark');
  } else if (command === 'benchmark-golden') {
    output = await commandBenchmark(config, storage, args, 'benchmark-golden');
  } else if (command === 'intel-graph-api') {
    output = await commandIntelGraphApi(config, storage, args);
  } else if (command === 'product-reconcile') {
    output = await commandProductReconcile(config, storage, args);
  } else if (command === 'seed-db') {
    output = await commandSeedDb(config, storage, args);
  } else if (command === 'migrate-to-sqlite') {
    output = await commandMigrateToSqlite(config, storage, args);
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
