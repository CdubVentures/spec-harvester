import { nowIso } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadCategoryBrain } from '../learning/categoryBrain.js';
import { runUntilComplete } from '../runner/runUntilComplete.js';
import {
  loadHelperCategoryData,
  syncJobsFromActiveFiltering
} from '../helperFiles/index.js';
import { normalizeMissingFieldTargets } from '../utils/fieldKeys.js';
import { writeGeneratedCategoryTests } from './generateCategoryTests.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function knownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

function avg(values = []) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function formatDateFolder(ts = new Date()) {
  return ts.toISOString().slice(0, 10);
}

function extractProductIdFromKey(key = '') {
  const parts = String(key || '').split('/');
  const file = parts[parts.length - 1] || '';
  return file.replace(/\.json$/i, '');
}

function brainStats(loaded = null) {
  const artifacts = loaded?.artifacts || {};
  const lexiconFields = Object.keys(artifacts.lexicon?.value?.fields || {}).length;
  const constraintsFields = Object.keys(artifacts.constraints?.value?.fields || {}).length;
  const yieldDomains = Object.keys(artifacts.fieldYield?.value?.by_domain || {}).length;
  const queryTemplates = Object.keys(artifacts.queryTemplates?.value?.queries || {}).length;
  const availabilityFields = Object.keys(artifacts.fieldAvailability?.value?.fields || {}).length;
  return {
    lexicon_fields: lexiconFields,
    constrained_fields: constraintsFields,
    yield_domains: yieldDomains,
    query_templates: queryTemplates,
    field_availability_fields: availabilityFields
  };
}

function brainDiff(before = {}, after = {}) {
  const out = {};
  for (const key of Object.keys({ ...before, ...after })) {
    out[key] = {
      before: Number(before[key] || 0),
      after: Number(after[key] || 0),
      delta: Number(after[key] || 0) - Number(before[key] || 0)
    };
  }
  return out;
}

export async function runCategoryTrainer({
  storage,
  config,
  category,
  trainingSetSize = 10,
  budgetPerProduct = null,
  mode = 'calibration',
  logger = null
}) {
  const startedAt = Date.now();
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const beforeBrain = await loadCategoryBrain({ storage, category });
  const beforeContractHash = categoryConfig.helperContract?.hash || null;

  // Rebuild/load compiled helper contract and emit helper audit details for training.
  const helperData = await loadHelperCategoryData({
    config,
    category,
    categoryConfig,
    forceRefresh: true
  });
  logger?.info?.('category_trainer_helper_audit', {
    category,
    contract_loaded: Boolean(helperData?.helper_audit?.contract_loaded),
    contract_hash: helperData?.helper_audit?.contract_hash || null,
    contract_file: helperData?.helper_audit?.contract_file || null,
    source_files: helperData?.helper_audit?.source_files || [],
    counts: helperData?.helper_audit?.counts || {}
  });

  // Ensure helper targets are materialized as product jobs before sampling.
  const helperSync = await syncJobsFromActiveFiltering({
    storage,
    config,
    category,
    categoryConfig,
    limit: 0,
    logger
  });

  const allKeys = await storage.listInputKeys(category);
  const limit = Math.max(1, toInt(trainingSetSize, 10));
  const selectedKeys = allKeys.slice(0, limit);

  const runMode = String(mode || 'calibration').trim().toLowerCase() === 'full'
    ? 'full'
    : 'calibration';
  const rounds = runMode === 'full' ? 3 : 1;
  const orchestrationMode = runMode === 'full' ? 'aggressive' : 'balanced';
  const trainingConfig = {
    ...config,
    runProfile: runMode === 'full' ? 'standard' : 'fast',
    llmExplicitlySet: true,
    llmExplicitlyEnabled: Boolean(config.llmEnabled)
  };
  if (budgetPerProduct !== null && Number.isFinite(toFloat(budgetPerProduct, NaN))) {
    trainingConfig.llmPerProductBudgetUsd = Math.max(0, toFloat(budgetPerProduct, 0));
  }

  const requiredTargets = normalizeMissingFieldTargets(
    categoryConfig.requiredFields || [],
    { fieldOrder: categoryConfig.fieldOrder || [] }
  ).fields;
  const criticalTargets = normalizeMissingFieldTargets(
    categoryConfig.schema?.critical_fields || [],
    { fieldOrder: categoryConfig.fieldOrder || [] }
  ).fields;
  const easyFieldSet = new Set([...requiredTargets, ...criticalTargets]);

  const productRuns = [];
  for (const key of selectedKeys) {
    const productStart = Date.now();
    const result = await runUntilComplete({
      storage,
      config: trainingConfig,
      s3key: key,
      maxRounds: rounds,
      mode: orchestrationMode
    });
    const productDurationMs = Date.now() - productStart;
    const productId = result.productId || extractProductIdFromKey(key);
    const latestBase = storage.resolveOutputKey(category, productId, 'latest');
    const normalized = await storage.readJsonOrNull(`${latestBase}/normalized.json`);
    const fields = normalized?.fields || {};
    const easyFieldsTotal = easyFieldSet.size;
    const easyFieldsFilled = [...easyFieldSet].filter((field) => knownValue(fields[field])).length;
    const requiredFieldsFilled = requiredTargets.filter((field) => knownValue(fields[field])).length;

    productRuns.push({
      s3key: key,
      product_id: productId,
      run_id: result.final_run_id || null,
      rounds: result.round_count || rounds,
      stop_reason: result.stop_reason || null,
      validated: Boolean(result.final_summary?.validated),
      confidence: toFloat(result.final_summary?.confidence, 0),
      completeness_required: toFloat(result.final_summary?.completeness_required, 0),
      coverage_overall: toFloat(result.final_summary?.coverage_overall, 0),
      llm_cost_usd_run: toFloat(result.final_summary?.llm?.cost_usd_run, 0),
      llm_call_count_run: toInt(result.final_summary?.llm?.call_count_run, 0),
      duration_ms: productDurationMs,
      easy_fields_total: easyFieldsTotal,
      easy_fields_filled: easyFieldsFilled,
      easy_fields_fill_rate: easyFieldsTotal > 0 ? Number((easyFieldsFilled / easyFieldsTotal).toFixed(6)) : 0,
      required_fields_total: requiredTargets.length,
      required_fields_filled: requiredFieldsFilled,
      required_fields_fill_rate: requiredTargets.length > 0
        ? Number((requiredFieldsFilled / requiredTargets.length).toFixed(6))
        : 0
    });
  }

  const afterBrain = await loadCategoryBrain({ storage, category });
  const afterCategoryConfig = await loadCategoryConfig(category, { storage, config });
  const afterContractHash = helperData?.helper_audit?.contract_hash || afterCategoryConfig.helperContract?.hash || null;
  const beforeStats = brainStats(beforeBrain);
  const afterStats = brainStats(afterBrain);

  const report = {
    version: 1,
    generated_at: nowIso(),
    category,
    trainer_mode: runMode,
    training_set_size_requested: limit,
    training_set_size_run: productRuns.length,
    rounds_per_product: rounds,
    orchestration_mode: orchestrationMode,
    helper_sync: helperSync,
    helper_contract: {
      loaded: Boolean(helperData?.helper_audit?.contract_loaded),
      previous_hash: beforeContractHash,
      current_hash: afterContractHash,
      changed: Boolean(beforeContractHash && afterContractHash && beforeContractHash !== afterContractHash),
      file: helperData?.helper_audit?.contract_file || null,
      counts: helperData?.helper_audit?.counts || {},
      source_files: helperData?.helper_audit?.source_files || [],
      error: helperData?.helper_audit?.error || null
    },
    helper_expectations: {
      hash: helperData?.helper_audit?.expectations_hash || null,
      file: helperData?.helper_audit?.expectations_file || null,
      counts: helperData?.helper_audit?.expectation_counts || {},
      required_fields: helperData?.compiled_expectations?.required_fields || [],
      expected_easy_fields: helperData?.compiled_expectations?.expected_easy_fields || [],
      expected_sometimes_fields: helperData?.compiled_expectations?.expected_sometimes_fields || [],
      deep_fields: helperData?.compiled_expectations?.deep_fields || []
    },
    generated_tests: await writeGeneratedCategoryTests({
      category,
      contract: helperData?.compiled_contract || {},
      expectations: helperData?.compiled_expectations || {}
    }),
    learning_artifact_diff: brainDiff(beforeStats, afterStats),
    metrics: {
      avg_confidence: Number(avg(productRuns.map((row) => row.confidence)).toFixed(6)),
      avg_completeness_required: Number(avg(productRuns.map((row) => row.completeness_required)).toFixed(6)),
      avg_coverage_overall: Number(avg(productRuns.map((row) => row.coverage_overall)).toFixed(6)),
      avg_easy_fill_rate: Number(avg(productRuns.map((row) => row.easy_fields_fill_rate)).toFixed(6)),
      avg_required_fill_rate: Number(avg(productRuns.map((row) => row.required_fields_fill_rate)).toFixed(6)),
      avg_duration_ms: Math.round(avg(productRuns.map((row) => row.duration_ms))),
      avg_llm_cost_usd_run: Number(avg(productRuns.map((row) => row.llm_cost_usd_run)).toFixed(8)),
      avg_llm_calls_run: Number(avg(productRuns.map((row) => row.llm_call_count_run)).toFixed(3)),
      validated_count: productRuns.filter((row) => row.validated).length
    },
    products: productRuns,
    duration_ms: Date.now() - startedAt
  };

  const reportKey = storage.resolveOutputKey(
    '_reports',
    'training',
    formatDateFolder(),
    `${category}.json`
  );
  await storage.writeObject(
    reportKey,
    Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );

  return {
    command: 'category-train',
    ...report,
    report_key: reportKey
  };
}
