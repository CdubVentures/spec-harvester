import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import zlib from 'node:zlib';
import { spawn, exec as execCb } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { watch } from 'chokidar';
import { loadConfig, loadDotEnvFile } from '../config.js';
import { createStorage } from '../s3/storage.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadQueueState, saveQueueState, listQueueProducts, upsertQueueProduct, clearQueueByStatus } from '../queue/queueState.js';
import { buildReviewLayout, buildProductReviewPayload, buildReviewQueue, readLatestArtifacts } from '../review/reviewGridData.js';
import { buildComponentReviewLayout, buildComponentReviewPayloads, buildEnumReviewPayloads } from '../review/componentReviewData.js';
import { setOverrideFromCandidate, setManualOverride, buildReviewMetrics } from '../review/overrideWorkflow.js';
import { applySharedLaneState } from '../review/keyReviewState.js';
import {
  resolveExplicitPositiveId,
  resolveGridFieldStateForMutation,
  resolveComponentMutationContext,
  resolveEnumMutationContext,
} from './reviewMutationResolvers.js';
import { handleReviewItemMutationRoute } from './reviewItemRoutes.js';
import { handleReviewComponentMutationRoute } from './reviewComponentMutationRoutes.js';
import { handleReviewEnumMutationRoute } from './reviewEnumMutationRoutes.js';
import { buildLlmMetrics } from '../publish/publishingPipeline.js';
import { SpecDb } from '../db/specDb.js';
import { findProductsReferencingComponent, cascadeComponentChange, cascadeEnumChange } from '../review/componentImpact.js';
import { componentReviewPath } from '../engine/curationSuggestions.js';
import { runComponentReviewBatch } from '../pipeline/componentReviewBatch.js';
import { invalidateFieldRulesCache } from '../field-rules/loader.js';
import { introspectWorkbook, loadWorkbookMap, saveWorkbookMap, validateWorkbookMap, extractWorkbookContext } from '../ingest/categoryCompile.js';
import { llmRoutingSnapshot } from '../llm/routing.js';
import { buildTrafficLight } from '../validator/trafficLight.js';
import { slugify as canonicalSlugify } from '../catalog/slugify.js';
import { cleanVariant as canonicalCleanVariant } from '../catalog/identityDedup.js';
import { buildComponentIdentifier } from '../utils/componentIdentifier.js';
import {
  buildComponentReviewSyntheticCandidateId
} from '../utils/candidateIdentifier.js';
import { generateTestSourceResults, buildDeterministicSourceResults, buildSeedComponentDB, TEST_CASES, analyzeContract, buildTestProducts, getScenarioDefs, buildValidationChecks } from '../testing/testDataProvider.js';
import { runTestProduct } from '../testing/testRunner.js';
import {
  loadBrandRegistry,
  saveBrandRegistry,
  addBrand,
  updateBrand,
  removeBrand,
  getBrandsForCategory,
  seedBrandsFromActiveFiltering,
  renameBrand,
  getBrandImpactAnalysis
} from '../catalog/brandRegistry.js';
import {
  listProducts,
  loadProductCatalog,
  addProduct as catalogAddProduct,
  updateProduct as catalogUpdateProduct,
  removeProduct as catalogRemoveProduct,
  seedFromWorkbook as catalogSeedFromWorkbook
} from '../catalog/productCatalog.js';
import { reconcileOrphans } from '../catalog/reconciler.js';

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toInt(v, fallback = 0) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(v, fallback = 0) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function toUnitRatio(v) {
  const n = Number.parseFloat(String(v ?? ''));
  if (!Number.isFinite(n)) return undefined;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function hasKnownValue(v) {
  const token = String(v ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function deriveTrafficLightCounts({ summary = {}, provenance = {} } = {}) {
  const fromSummary = summary?.traffic_light?.counts
    || summary?.traffic_light
    || summary?.trafficLight?.counts
    || summary?.trafficLight;
  if (fromSummary && typeof fromSummary === 'object') {
    const green = toInt(fromSummary.green, 0);
    const yellow = toInt(fromSummary.yellow, 0);
    const red = toInt(fromSummary.red, 0);
    if (green > 0 || yellow > 0 || red > 0) {
      return { green, yellow, red };
    }
  }

  try {
    const computed = buildTrafficLight({
      fieldOrder: Object.keys(provenance || {}),
      provenance,
      fieldReasoning: summary?.field_reasoning || {}
    });
    const green = toInt(computed?.counts?.green, 0);
    const yellow = toInt(computed?.counts?.yellow, 0);
    const red = toInt(computed?.counts?.red, 0);
    if (green > 0 || yellow > 0 || red > 0) {
      return { green, yellow, red };
    }
  } catch {
    // non-fatal, fall back to simple bucket counts below
  }

  const skip = new Set(['id', 'brand', 'model', 'base_model', 'category']);
  let green = 0;
  let yellow = 0;
  let red = 0;
  for (const [field, row] of Object.entries(provenance || {})) {
    if (skip.has(field)) continue;
    const value = row?.value;
    const known = hasKnownValue(value);
    const meets = row?.meets_pass_target === true;
    if (known && meets) green += 1;
    else if (known) yellow += 1;
    else red += 1;
  }
  return { green, yellow, red };
}

function normalizeModelToken(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCsvTokens(value) {
  return String(value || '')
    .split(/[,\n]/g)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function llmProviderFromModel(model) {
  const token = normalizeModelToken(model);
  if (!token) return 'openai';
  if (token.startsWith('gemini')) return 'gemini';
  if (token.startsWith('deepseek')) return 'deepseek';
  return 'openai';
}

function normalizePathToken(value, fallback = '') {
  const token = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || fallback;
}

function classifyLlmTracePhase(purpose = '', routeRole = '') {
  const reason = String(purpose || '').trim().toLowerCase();
  const role = String(routeRole || '').trim().toLowerCase();
  if (role === 'extract') return 'extract';
  if (role === 'validate') return 'validate';
  if (role === 'write') return 'write';
  if (role === 'plan') return 'plan';
  if (
    reason.includes('discovery_planner') ||
    reason.includes('search_profile') ||
    reason.includes('searchprofile')
  ) {
    return 'phase_02';
  }
  if (
    reason.includes('serp') ||
    reason.includes('triage') ||
    reason.includes('rerank') ||
    reason.includes('discovery_query_plan')
  ) {
    return 'phase_03';
  }
  if (reason.includes('extract')) return 'extract';
  if (reason.includes('validate') || reason.includes('verify')) return 'validate';
  if (reason.includes('write') || reason.includes('summary')) return 'write';
  if (reason.includes('planner') || reason.includes('plan')) return 'plan';
  return 'other';
}

function normalizeJsonText(value, maxChars = 12000) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2).slice(0, Math.max(0, Number(maxChars) || 0));
    } catch {
      return '';
    }
  }
  const text = String(value || '');
  return text.slice(0, Math.max(0, Number(maxChars) || 0));
}

function resolveLlmRoleDefaults(cfg = {}) {
  return {
    plan: String(cfg.llmModelPlan || '').trim(),
    fast: String(cfg.llmModelFast || '').trim(),
    triage: String(cfg.llmModelTriage || cfg.cortexModelRerankFast || cfg.cortexModelSearchFast || cfg.llmModelFast || '').trim(),
    reasoning: String(cfg.llmModelReasoning || '').trim(),
    extract: String(cfg.llmModelExtract || '').trim(),
    validate: String(cfg.llmModelValidate || '').trim(),
    write: String(cfg.llmModelWrite || '').trim()
  };
}

function resolveLlmKnobDefaults(cfg = {}) {
  const modelDefaults = resolveLlmRoleDefaults(cfg);
  const tokenDefaults = {
    plan: toInt(cfg.llmMaxOutputTokensPlan, toInt(cfg.llmMaxOutputTokens, 1200)),
    fast: toInt(cfg.llmMaxOutputTokensFast, toInt(cfg.llmMaxOutputTokensPlan, 1200)),
    triage: toInt(cfg.llmMaxOutputTokensTriage, toInt(cfg.llmMaxOutputTokensFast, 1200)),
    reasoning: toInt(cfg.llmMaxOutputTokensReasoning, toInt(cfg.llmReasoningBudget, 4096)),
    extract: toInt(cfg.llmMaxOutputTokensExtract, toInt(cfg.llmExtractMaxTokens, 1200)),
    validate: toInt(cfg.llmMaxOutputTokensValidate, toInt(cfg.llmMaxOutputTokens, 1200)),
    write: toInt(cfg.llmMaxOutputTokensWrite, toInt(cfg.llmMaxOutputTokens, 1200))
  };
  return {
    phase_02_planner: {
      model: String(cfg.llmModelPlan || '').trim(),
      token_cap: tokenDefaults.plan
    },
    phase_03_triage: {
      model: String(cfg.llmModelTriage || '').trim(),
      token_cap: tokenDefaults.triage
    },
    fast_pass: {
      model: modelDefaults.fast,
      token_cap: tokenDefaults.fast
    },
    reasoning_pass: {
      model: modelDefaults.reasoning,
      token_cap: tokenDefaults.reasoning
    },
    extract_role: {
      model: modelDefaults.extract,
      token_cap: tokenDefaults.extract
    },
    validate_role: {
      model: modelDefaults.validate,
      token_cap: tokenDefaults.validate
    },
    write_role: {
      model: modelDefaults.write,
      token_cap: tokenDefaults.write
    },
    fallback_plan: {
      model: String(cfg.llmPlanFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensPlanFallback, tokenDefaults.plan)
    },
    fallback_extract: {
      model: String(cfg.llmExtractFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensExtractFallback, tokenDefaults.extract)
    },
    fallback_validate: {
      model: String(cfg.llmValidateFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensValidateFallback, tokenDefaults.validate)
    },
    fallback_write: {
      model: String(cfg.llmWriteFallbackModel || '').trim(),
      token_cap: toInt(cfg.llmMaxOutputTokensWriteFallback, tokenDefaults.write)
    }
  };
}

function resolvePricingForModel(cfg, model) {
  const modelToken = normalizeModelToken(model);
  const defaultRates = {
    input_per_1m: toFloat(cfg?.llmCostInputPer1M, 1.25),
    output_per_1m: toFloat(cfg?.llmCostOutputPer1M, 10),
    cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1M, 0.125)
  };
  if (!modelToken) {
    return defaultRates;
  }
  const pricingMap = (cfg?.llmModelPricingMap && typeof cfg.llmModelPricingMap === 'object')
    ? cfg.llmModelPricingMap
    : {};
  let selected = null;
  let selectedKey = '';
  for (const [rawModel, rawRates] of Object.entries(pricingMap)) {
    const key = normalizeModelToken(rawModel);
    if (!key || !rawRates || typeof rawRates !== 'object') continue;
    const isMatch = modelToken === key || modelToken.startsWith(key) || key.startsWith(modelToken);
    if (!isMatch) continue;
    if (!selected || key.length > selectedKey.length) {
      selected = rawRates;
      selectedKey = key;
    }
  }
  if (selected) {
    return {
      input_per_1m: toFloat(selected.inputPer1M ?? selected.input_per_1m ?? selected.input, defaultRates.input_per_1m),
      output_per_1m: toFloat(selected.outputPer1M ?? selected.output_per_1m ?? selected.output, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(
        selected.cachedInputPer1M ?? selected.cached_input_per_1m ?? selected.cached_input ?? selected.cached,
        defaultRates.cached_input_per_1m
      )
    };
  }
  if (modelToken.startsWith('deepseek-chat')) {
    return {
      input_per_1m: toFloat(cfg?.llmCostInputPer1MDeepseekChat, defaultRates.input_per_1m),
      output_per_1m: toFloat(cfg?.llmCostOutputPer1MDeepseekChat, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1MDeepseekChat, defaultRates.cached_input_per_1m)
    };
  }
  if (modelToken.startsWith('deepseek-reasoner')) {
    return {
      input_per_1m: toFloat(cfg?.llmCostInputPer1MDeepseekReasoner, defaultRates.input_per_1m),
      output_per_1m: toFloat(cfg?.llmCostOutputPer1MDeepseekReasoner, defaultRates.output_per_1m),
      cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1MDeepseekReasoner, defaultRates.cached_input_per_1m)
    };
  }
  return defaultRates;
}

function resolveTokenProfileForModel(cfg, model) {
  const modelToken = normalizeModelToken(model);
  const defaultFallback = {
    default_output_tokens: toInt(cfg?.llmMaxOutputTokens, 1200),
    max_output_tokens: toInt(cfg?.llmMaxTokens, 16384)
  };
  if (!modelToken) {
    return defaultFallback;
  }
  const map = (cfg?.llmModelOutputTokenMap && typeof cfg.llmModelOutputTokenMap === 'object')
    ? cfg.llmModelOutputTokenMap
    : {};
  let selected = null;
  let selectedKey = '';
  for (const [rawModel, rawProfile] of Object.entries(map)) {
    const key = normalizeModelToken(rawModel);
    if (!key || !rawProfile || typeof rawProfile !== 'object') continue;
    const isMatch = modelToken === key || modelToken.startsWith(key) || key.startsWith(modelToken);
    if (!isMatch) continue;
    if (!selected || key.length > selectedKey.length) {
      selected = rawProfile;
      selectedKey = key;
    }
  }
  const defaultOutput = toInt(
    selected?.defaultOutputTokens ?? selected?.default_output_tokens,
    defaultFallback.default_output_tokens
  );
  const maxOutput = toInt(
    selected?.maxOutputTokens ?? selected?.max_output_tokens,
    defaultFallback.max_output_tokens
  );
  return {
    default_output_tokens: defaultOutput > 0 ? defaultOutput : defaultFallback.default_output_tokens,
    max_output_tokens: maxOutput > 0 ? maxOutput : defaultFallback.max_output_tokens
  };
}

function collectLlmModels(cfg = {}) {
  const candidates = [
    cfg.llmModelPlan,
    cfg.llmModelFast,
    cfg.llmModelTriage,
    cfg.llmModelExtract,
    cfg.llmModelReasoning,
    cfg.llmModelValidate,
    cfg.llmModelWrite,
    cfg.cortexModelFast,
    cfg.cortexModelSearchFast,
    cfg.cortexModelRerankFast,
    cfg.cortexModelSearchDeep,
    cfg.cortexModelReasoningDeep,
    cfg.cortexModelVision,
    cfg.llmPlanFallbackModel,
    cfg.llmExtractFallbackModel,
    cfg.llmValidateFallbackModel,
    cfg.llmWriteFallbackModel,
    ...parseCsvTokens(cfg.llmModelCatalog || '')
  ];
  if (cfg.llmModelPricingMap && typeof cfg.llmModelPricingMap === 'object') {
    candidates.push(...Object.keys(cfg.llmModelPricingMap));
  }
  candidates.push(
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'deepseek-chat',
    'deepseek-reasoner'
  );
  const seen = new Set();
  const rows = [];
  for (const model of candidates) {
    const value = String(model || '').trim();
    if (!value) continue;
    const token = normalizeModelToken(value);
    if (seen.has(token)) continue;
    seen.add(token);
    rows.push(value);
  }
  rows.sort((a, b) => a.localeCompare(b));
  return rows;
}

/** Mark a suggestion in _suggestions/enums.json as accepted/dismissed so it no longer shows as pending. */
async function markEnumSuggestionStatus(category, field, value, status = 'accepted') {
  const sugPath = path.join(HELPER_ROOT, category, '_suggestions', 'enums.json');
  const doc = await safeReadJson(sugPath);
  if (!doc || !Array.isArray(doc.suggestions)) return;
  const normalized = String(value).trim().toLowerCase();
  let changed = false;
  for (const s of doc.suggestions) {
    if (String(s.field_key || '').trim() === field &&
        String(s.value || '').trim().toLowerCase() === normalized &&
        s.status === 'pending') {
      s.status = status;
      s.resolved_at = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(sugPath, JSON.stringify(doc, null, 2));
  }
}

function jsonRes(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readJsonBody(req, maxBytes = 2_000_000) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error('body_too_large');
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

async function safeReadJson(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch { return null; }
}

async function safeStat(filePath) {
  try { return await fs.stat(filePath); } catch { return null; }
}

async function listDirs(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
  } catch { return []; }
}

async function listFiles(dirPath, ext = '') {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map(e => e.name)
      .sort();
  } catch { return []; }
}

const UNKNOWN_VALUE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'none', 'null']);
const SITE_KIND_RANK = {
  manufacturer: 0,
  review: 1,
  database: 2,
  retailer: 3,
  community: 4,
  aggregator: 5,
  other: 9
};
const REVIEW_DOMAIN_HINTS = [
  'rtings.com',
  'techpowerup.com',
  'eloshapes.com',
  'mousespecs.org',
  'tftcentral.co.uk',
  'displayninja.com'
];
const RETAILER_DOMAIN_HINTS = [
  'amazon.',
  'bestbuy.',
  'newegg.',
  'walmart.',
  'microcenter.',
  'bhphotovideo.'
];
const AGGREGATOR_DOMAIN_HINTS = [
  'wikipedia.org',
  'reddit.com',
  'fandom.com'
];
const FETCH_OUTCOME_KEYS = [
  'ok',
  'not_found',
  'blocked',
  'rate_limited',
  'login_wall',
  'bot_challenge',
  'bad_content',
  'server_error',
  'network_timeout',
  'fetch_error'
];

function normalizeDomainToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function domainFromUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    return normalizeDomainToken(parsed.hostname);
  } catch {
    return normalizeDomainToken(url);
  }
}

function urlPathToken(url) {
  try {
    const parsed = new URL(String(url || ''));
    return `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
}

function createFetchOutcomeCounters() {
  return FETCH_OUTCOME_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function normalizeFetchOutcome(value) {
  const token = String(value || '').trim().toLowerCase();
  if (!token) return '';
  return FETCH_OUTCOME_KEYS.includes(token) ? token : '';
}

function classifyFetchOutcomeFromEvent(evt = {}) {
  const explicit = normalizeFetchOutcome(evt.outcome);
  if (explicit) return explicit;

  const code = toInt(evt.status, 0);
  const message = String(evt.message || evt.detail || '').toLowerCase();
  const contentType = String(evt.content_type || '').toLowerCase();

  const looksBotChallenge = /(captcha|cloudflare|cf-ray|bot.?challenge|are you human|human verification|robot check)/.test(message);
  const looksRateLimited = /(429|rate.?limit|too many requests|throttl)/.test(message);
  const looksLoginWall = /(401|sign[ -]?in|login|authenticate|account required|subscription required)/.test(message);
  const looksBlocked = /(403|forbidden|blocked|access denied|denied)/.test(message);
  const looksTimeout = /(timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|network error|dns)/.test(message);
  const looksBadContent = /(parse|json|xml|cheerio|dom|extract|malformed|invalid content|unsupported content)/.test(message);

  if (code >= 200 && code < 400) {
    if (contentType.includes('application/octet-stream')) return 'bad_content';
    return 'ok';
  }
  if (code === 404 || code === 410) return 'not_found';
  if (code === 429) return 'rate_limited';
  if (code === 401 || code === 407) return 'login_wall';
  if (code === 403) {
    if (looksBotChallenge) return 'bot_challenge';
    if (looksLoginWall) return 'login_wall';
    return 'blocked';
  }
  if (code >= 500) return 'server_error';
  if (code >= 400) return 'blocked';
  if (looksBotChallenge) return 'bot_challenge';
  if (looksRateLimited) return 'rate_limited';
  if (looksLoginWall) return 'login_wall';
  if (looksBlocked) return 'blocked';
  if (looksBadContent) return 'bad_content';
  if (looksTimeout) return 'network_timeout';
  return 'fetch_error';
}

function parseTsMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : NaN;
}

function percentileFromSorted(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const idx = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * percentile))
  );
  return Number(values[idx]) || 0;
}

function isKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return !UNKNOWN_VALUE_TOKENS.has(token);
}

function addTokensFromText(set, value) {
  for (const token of String(value || '').toLowerCase().split(/[^a-z0-9]+/g)) {
    const trimmed = token.trim();
    if (trimmed.length >= 4) {
      set.add(trimmed);
    }
  }
}

function inferSiteKindByDomain(domain = '') {
  const host = normalizeDomainToken(domain);
  if (!host) return 'other';
  if (REVIEW_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'review';
  if (RETAILER_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'retailer';
  if (AGGREGATOR_DOMAIN_HINTS.some((hint) => host.includes(hint))) return 'aggregator';
  return 'other';
}

function classifySiteKind({
  domain = '',
  role = '',
  tierName = '',
  brandTokens = new Set()
} = {}) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedTierName = String(tierName || '').trim().toLowerCase();
  if (normalizedRole === 'manufacturer' || normalizedTierName === 'manufacturer') return 'manufacturer';
  if (normalizedRole === 'review' || normalizedTierName === 'review') return 'review';
  if (normalizedRole === 'retailer' || normalizedTierName === 'retailer') return 'retailer';
  if (normalizedRole === 'database' || normalizedTierName === 'database') return 'database';
  if (normalizedRole === 'community' || normalizedTierName === 'community') return 'community';
  if (normalizedRole === 'aggregator' || normalizedTierName === 'aggregator') return 'aggregator';

  const host = normalizeDomainToken(domain);
  if (host) {
    for (const token of brandTokens) {
      if (!token) continue;
      if (host.includes(token)) return 'manufacturer';
    }
  }
  return inferSiteKindByDomain(host);
}

function isHelperPseudoDomain(domain = '') {
  const host = normalizeDomainToken(domain);
  return host === 'helper-files.local' || host === 'helper_files.local';
}

function createDomainBucket(domain, siteKind = 'other') {
  return {
    domain,
    site_kind: siteKind,
    candidates_checked_urls: new Set(),
    urls_selected_urls: new Set(),
    fetched_ok_urls: new Set(),
    indexed_urls: new Set(),
    seen_urls: new Set(),
    url_stats: new Map(),
    started_count: 0,
    completed_count: 0,
    dedupe_hits: 0,
    err_404: 0,
    err_404_by_url: new Map(),
    blocked_count: 0,
    blocked_by_url: new Map(),
    parse_fail_count: 0,
    outcome_counts: createFetchOutcomeCounters(),
    fetch_durations: [],
    fields_filled_count: 0,
    evidence_hits: 0,
    evidence_used: 0,
    fields_covered: new Set(),
    publish_gated_fields: new Set(),
    last_success_at: '',
    next_retry_at: '',
    roles_seen: new Set()
  };
}

function createUrlStat(url) {
  return {
    url: String(url || ''),
    checked_count: 0,
    selected_count: 0,
    fetch_started_count: 0,
    processed_count: 0,
    fetched_ok: false,
    indexed: false,
    err_404_count: 0,
    blocked_count: 0,
    parse_fail_count: 0,
    last_outcome: '',
    last_status: 0,
    last_event: '',
    last_ts: ''
  };
}

function ensureUrlStat(bucket, url) {
  if (!bucket || !url) return null;
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl) return null;
  if (!bucket.url_stats.has(normalizedUrl)) {
    bucket.url_stats.set(normalizedUrl, createUrlStat(normalizedUrl));
  }
  return bucket.url_stats.get(normalizedUrl);
}

function bumpUrlStatEvent(urlStat, { eventName = '', ts = '', status = 0 } = {}) {
  if (!urlStat) return;
  const safeTs = String(ts || '').trim();
  const safeEvent = String(eventName || '').trim();
  const statusCode = Number.parseInt(String(status || ''), 10);
  if (safeTs && (!urlStat.last_ts || parseTsMs(safeTs) >= parseTsMs(urlStat.last_ts))) {
    urlStat.last_ts = safeTs;
    urlStat.last_event = safeEvent || urlStat.last_event;
    if (Number.isFinite(statusCode) && statusCode > 0) {
      urlStat.last_status = statusCode;
    }
  }
}

function choosePreferredSiteKind(currentKind, nextKind) {
  const currentRank = SITE_KIND_RANK[currentKind] ?? 99;
  const nextRank = SITE_KIND_RANK[nextKind] ?? 99;
  return nextRank < currentRank ? nextKind : currentKind;
}

function cooldownSecondsRemaining(nextRetryAt, nowMs = Date.now()) {
  const retryAtMs = parseTsMs(nextRetryAt);
  if (!Number.isFinite(retryAtMs)) return 0;
  return Math.max(0, Math.ceil((retryAtMs - nowMs) / 1000));
}

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function resolveHostBudget(bucket, cooldownSeconds = 0) {
  const outcomes = bucket?.outcome_counts || createFetchOutcomeCounters();
  const started = toInt(bucket?.started_count, 0);
  const completed = toInt(bucket?.completed_count, 0);
  const inFlight = Math.max(0, started - completed);

  let score = 100;
  score -= toInt(outcomes.not_found, 0) * 6;
  score -= toInt(outcomes.blocked, 0) * 8;
  score -= toInt(outcomes.rate_limited, 0) * 12;
  score -= toInt(outcomes.login_wall, 0) * 10;
  score -= toInt(outcomes.bot_challenge, 0) * 14;
  score -= toInt(outcomes.bad_content, 0) * 8;
  score -= toInt(outcomes.server_error, 0) * 6;
  score -= toInt(outcomes.network_timeout, 0) * 5;
  score -= toInt(outcomes.fetch_error, 0) * 4;
  score -= toInt(bucket?.dedupe_hits, 0);
  score += Math.min(12, toInt(outcomes.ok, 0) * 2);
  score += Math.min(10, toInt(bucket?.evidence_used, 0) * 2);
  score = clampScore(score, 0, 100);

  let state = 'open';
  const blockedSignals = (
    toInt(outcomes.blocked, 0)
    + toInt(outcomes.rate_limited, 0)
    + toInt(outcomes.login_wall, 0)
    + toInt(outcomes.bot_challenge, 0)
  );
  if (cooldownSeconds > 0 && (score <= 30 || blockedSignals >= 2)) {
    state = 'blocked';
  } else if (cooldownSeconds > 0) {
    state = 'backoff';
  } else if (score < 55 || toInt(outcomes.bad_content, 0) > 0 || toInt(bucket?.parse_fail_count, 0) > 0) {
    state = 'degraded';
  } else if (inFlight > 0) {
    state = 'active';
  }

  return {
    score,
    state
  };
}

function resolveDomainChecklistStatus(bucket) {
  const candidatesChecked = bucket.candidates_checked_urls.size;
  const urlsSelected = bucket.urls_selected_urls.size;
  const pagesFetchedOk = bucket.fetched_ok_urls.size;
  const hasPositiveSignal = (
    pagesFetchedOk > 0
    || bucket.indexed_urls.size > 0
    || bucket.fields_filled_count > 0
    || bucket.evidence_hits > 0
    || bucket.evidence_used > 0
  );

  if (candidatesChecked === 0 && urlsSelected === 0) return 'not_started';
  if (bucket.started_count > bucket.completed_count) return 'in_progress';
  if (hasPositiveSignal) return 'good';
  if (bucket.blocked_count > 0 && pagesFetchedOk === 0) return 'blocked';
  if (bucket.err_404 > 0 && pagesFetchedOk === 0 && bucket.blocked_count === 0) return 'dead_urls(404)';
  return 'in_progress';
}

function incrementMapCounter(mapRef, key) {
  if (!mapRef || !key) return;
  mapRef.set(key, (mapRef.get(key) || 0) + 1);
}

function countMapValuesAbove(mapRef, threshold = 1) {
  if (!mapRef || typeof mapRef.values !== 'function') return 0;
  let total = 0;
  for (const value of mapRef.values()) {
    if (Number(value) > threshold) total += 1;
  }
  return total;
}

async function readJsonlEvents(filePath) {
  let text = '';
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function readGzipJsonlEvents(filePath) {
  let buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch {
    return [];
  }
  let text = '';
  try {
    text = zlib.gunzipSync(buffer).toString('utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseNdjson(text = '') {
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function safeJoin(basePath, ...parts) {
  const resolved = path.resolve(basePath, ...parts);
  const root = path.resolve(basePath);
  if (resolved === root) return resolved;
  if (!resolved.startsWith(`${root}${path.sep}`)) return null;
  return resolved;
}

async function readIndexLabRunEvents(runId, limit = 2000) {
  const runDir = safeJoin(INDEXLAB_ROOT, String(runId || '').trim());
  if (!runDir) return [];
  const eventsPath = path.join(runDir, 'run_events.ndjson');
  let text = '';
  try {
    text = await fs.readFile(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const rows = parseNdjson(text);
  return rows.slice(-Math.max(1, toInt(limit, 2000)));
}

function resolveRunProductId(meta = {}, events = []) {
  const fromMeta = String(meta?.product_id || '').trim();
  if (fromMeta) return fromMeta;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i] || {};
    const payload = row?.payload && typeof row.payload === 'object'
      ? row.payload
      : {};
    const candidate = String(
      row?.product_id
      || row?.productId
      || payload?.product_id
      || payload?.productId
      || ''
    ).trim();
    if (candidate) return candidate;
  }
  return '';
}

async function resolveIndexLabRunContext(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;
  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) {
    return null;
  }
  return {
    token,
    runDir,
    meta,
    category,
    resolvedRunId,
    productId
  };
}

async function readIndexLabRunNeedSet(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'needset.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runNeedSetKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'needset.json');
  const runNeedSetPath = path.join(OUTPUT_ROOT, ...String(runNeedSetKey || '').split('/'));
  const fromRunArtifact = await safeReadJson(runNeedSetPath);
  if (fromRunArtifact && typeof fromRunArtifact === 'object') {
    return fromRunArtifact;
  }

  const latestNeedSetKey = storage.resolveOutputKey(category, productId, 'latest', 'needset.json');
  const latestNeedSetPath = path.join(OUTPUT_ROOT, ...String(latestNeedSetKey || '').split('/'));
  const fromLatest = await safeReadJson(latestNeedSetPath);
  if (fromLatest && typeof fromLatest === 'object') {
    return fromLatest;
  }

  return null;
}

async function readIndexLabRunSearchProfile(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'search_profile.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);

  if (productId) {
    const runProfileKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'search_profile.json');
    const runProfile = await storage.readJsonOrNull(runProfileKey);
    if (runProfile && typeof runProfile === 'object') {
      return runProfile;
    }

    const latestProfileKey = storage.resolveOutputKey(category, productId, 'latest', 'search_profile.json');
    const latestProfile = await storage.readJsonOrNull(latestProfileKey);
    if (latestProfile && typeof latestProfile === 'object') {
      return latestProfile;
    }
  }

  const discoveryProfileKey = storage.resolveInputKey('_discovery', category, `${resolvedRunId}.search_profile.json`);
  const fromDiscoveryProfile = await storage.readJsonOrNull(discoveryProfileKey);
  if (fromDiscoveryProfile && typeof fromDiscoveryProfile === 'object') {
    return fromDiscoveryProfile;
  }

  const discoveryLegacyKey = storage.resolveInputKey('_discovery', category, `${resolvedRunId}.json`);
  const fromDiscovery = await storage.readJsonOrNull(discoveryLegacyKey);
  if (fromDiscovery?.search_profile && typeof fromDiscovery.search_profile === 'object') {
    return fromDiscovery.search_profile;
  }

  return null;
}

async function readIndexLabRunPhase07Retrieval(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'phase07_retrieval.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'phase07_retrieval.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'phase07_retrieval.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.phase07 && typeof runSummary.phase07 === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      summary: runSummary.phase07,
      fields: [],
      summary_only: true
    };
  }

  return null;
}

async function readIndexLabRunPhase08Extraction(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'phase08_extraction.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'phase08_extraction.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'phase08_extraction.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.phase08 && typeof runSummary.phase08 === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      summary: runSummary.phase08,
      batches: [],
      field_contexts: {},
      prime_sources: { rows: [] },
      summary_only: true
    };
  }

  return null;
}

async function readIndexLabRunDynamicFetchDashboard(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'dynamic_fetch_dashboard.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'dynamic_fetch_dashboard.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'dynamic_fetch_dashboard.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  const runSummaryKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await storage.readJsonOrNull(runSummaryKey);
  if (runSummary?.dynamic_fetch_dashboard && typeof runSummary.dynamic_fetch_dashboard === 'object') {
    return {
      run_id: resolvedRunId,
      category,
      product_id: productId,
      generated_at: String(runSummary.generated_at || '').trim() || null,
      host_count: Number(runSummary.dynamic_fetch_dashboard.host_count || 0),
      hosts: [],
      summary_only: true,
      key: String(runSummary.dynamic_fetch_dashboard.key || '').trim() || null,
      latest_key: String(runSummary.dynamic_fetch_dashboard.latest_key || '').trim() || null
    };
  }

  return null;
}

async function readIndexLabRunSourceIndexingPackets(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'source_indexing_extraction_packets.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'source_indexing_extraction_packets.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'source_indexing_extraction_packets.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

async function readIndexLabRunItemIndexingPacket(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'item_indexing_extraction_packet.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'item_indexing_extraction_packet.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'item_indexing_extraction_packet.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

async function readIndexLabRunRunMetaPacket(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;
  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;

  const directPath = path.join(runDir, 'run_meta_packet.json');
  const direct = await safeReadJson(directPath);
  if (direct && typeof direct === 'object') {
    return direct;
  }

  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'analysis', 'run_meta_packet.json');
  const runPayload = await storage.readJsonOrNull(runKey);
  if (runPayload && typeof runPayload === 'object') {
    return runPayload;
  }

  const latestKey = storage.resolveOutputKey(category, productId, 'latest', 'run_meta_packet.json');
  const latestPayload = await storage.readJsonOrNull(latestKey);
  if (latestPayload && typeof latestPayload === 'object') {
    return latestPayload;
  }

  return null;
}

async function readIndexLabRunSerpExplorer(runId) {
  const token = String(runId || '').trim();
  if (!token) return null;

  const searchProfile = await readIndexLabRunSearchProfile(token);
  if (searchProfile?.serp_explorer && typeof searchProfile.serp_explorer === 'object') {
    return searchProfile.serp_explorer;
  }

  const runDir = safeJoin(INDEXLAB_ROOT, token);
  if (!runDir) return null;
  const meta = await safeReadJson(path.join(runDir, 'run.json'));
  const category = String(meta?.category || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }
  const eventRows = await readIndexLabRunEvents(token, 3000);
  const productId = resolveRunProductId(meta, eventRows);
  if (!productId) return null;

  const runSummaryKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await storage.readJsonOrNull(runSummaryKey);
  if (!runSummary || typeof runSummary !== 'object') {
    return null;
  }
  const attemptRows = Array.isArray(runSummary.searches_attempted) ? runSummary.searches_attempted : [];
  const selectedUrlsRaw = Array.isArray(runSummary.urls_fetched) ? runSummary.urls_fetched : [];
  const selectedUrls = selectedUrlsRaw
    .map((row) => {
      if (typeof row === 'string') {
        return {
          url: String(row).trim(),
          query: '',
          doc_kind: '',
          tier_name: '',
          score: 0,
          reason_codes: ['summary_fallback']
        };
      }
      if (!row || typeof row !== 'object') return null;
      const url = String(row.url || row.href || '').trim();
      if (!url) return null;
      const reasonCodes = Array.isArray(row.reason_codes)
        ? row.reason_codes.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      return {
        url,
        query: String(row.query || '').trim(),
        doc_kind: String(row.doc_kind || '').trim(),
        tier_name: String(row.tier_name || '').trim(),
        score: Number(row.score || row.triage_score || 0),
        reason_codes: reasonCodes.length > 0 ? reasonCodes : ['summary_fallback']
      };
    })
    .filter(Boolean);
  return {
    generated_at: String(runSummary.generated_at || '').trim() || null,
    provider: String(runSummary.discovery?.provider || '').trim() || null,
    query_count: attemptRows.length,
    candidates_checked: 0,
    urls_triaged: 0,
    urls_selected: selectedUrls.length,
    urls_rejected: 0,
    dedupe_input: 0,
    dedupe_output: 0,
    duplicates_removed: 0,
    summary_only: true,
    selected_urls: selectedUrls,
    queries: attemptRows.map((row) => ({
      query: String(row?.query || '').trim(),
      hint_source: '',
      target_fields: [],
      doc_hint: '',
      domain_hint: '',
      result_count: Number(row?.result_count || 0),
      attempts: 1,
      providers: [String(row?.provider || '').trim()].filter(Boolean),
      candidate_count: 0,
      selected_count: 0,
      candidates: []
    }))
  };
}

async function readIndexLabRunLlmTraces(runId, limit = 80) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;
  const traceRoot = path.join(
    OUTPUT_ROOT,
    '_runtime',
    'traces',
    'runs',
    normalizePathToken(context.resolvedRunId, 'run'),
    normalizePathToken(context.productId, 'product'),
    'llm'
  );
  let entries = [];
  try {
    entries = await fs.readdir(traceRoot, { withFileTypes: true });
  } catch {
    return {
      generated_at: new Date().toISOString(),
      run_id: context.resolvedRunId,
      category: context.category,
      product_id: context.productId,
      count: 0,
      traces: []
    };
  }
  const fileRows = entries
    .filter((entry) => entry.isFile() && /^call_\d+\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const traces = [];
  for (const name of fileRows) {
    const filePath = path.join(traceRoot, name);
    const row = await safeReadJson(filePath);
    if (!row || typeof row !== 'object') continue;
    const usage = row.usage && typeof row.usage === 'object'
      ? row.usage
      : {};
    const prompt = row.prompt && typeof row.prompt === 'object'
      ? row.prompt
      : {};
    const response = row.response && typeof row.response === 'object'
      ? row.response
      : {};
    const routeRole = String(row.route_role || '').trim().toLowerCase();
    const purpose = String(row.purpose || '').trim();
    const ts = String(row.ts || '').trim();
    const tsMs = Date.parse(ts);
    traces.push({
      id: `${context.resolvedRunId}:${name}`,
      ts: ts || null,
      ts_ms: Number.isFinite(tsMs) ? tsMs : 0,
      phase: classifyLlmTracePhase(purpose, routeRole),
      role: routeRole || null,
      purpose: purpose || null,
      status: String(row.status || '').trim() || null,
      provider: String(row.provider || '').trim() || null,
      model: String(row.model || '').trim() || null,
      retry_without_schema: Boolean(row.retry_without_schema),
      json_schema_requested: Boolean(row.json_schema_requested),
      max_tokens_applied: toInt(row.max_tokens_applied, 0),
      target_fields: Array.isArray(row.target_fields)
        ? row.target_fields.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 80)
        : [],
      target_fields_count: toInt(row.target_fields_count, 0),
      prompt_preview: normalizeJsonText(prompt, 8000),
      response_preview: normalizeJsonText(response, 12000),
      error: String(row.error || '').trim() || null,
      usage: {
        prompt_tokens: toInt(usage.prompt_tokens, toInt(usage.input_tokens, 0)),
        completion_tokens: toInt(usage.completion_tokens, toInt(usage.output_tokens, 0)),
        cached_prompt_tokens: toInt(usage.cached_prompt_tokens, toInt(usage.cached_input_tokens, 0)),
        total_tokens: toInt(usage.total_tokens, 0)
      },
      trace_file: name
    });
  }
  traces.sort((a, b) => {
    if (b.ts_ms !== a.ts_ms) return b.ts_ms - a.ts_ms;
    return String(b.trace_file || '').localeCompare(String(a.trace_file || ''));
  });
  const maxRows = Math.max(1, toInt(limit, 80));
  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    count: traces.length,
    traces: traces.slice(0, maxRows).map(({ ts_ms, ...row }) => row)
  };
}

async function readIndexLabRunEvidenceIndex(runId, { query = '', limit = 40 } = {}) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;
  const requestedQuery = String(query || '').trim();
  const requestedLimit = Math.max(1, Math.min(120, toInt(limit, 40)));
  const specDb = await getSpecDbReady(context.category);
  if (!specDb?.db) {
    return {
      generated_at: new Date().toISOString(),
      run_id: context.resolvedRunId,
      category: context.category,
      product_id: context.productId,
      db_ready: false,
      scope: {
        mode: 'none',
        run_match: false,
        run_id: context.resolvedRunId
      },
      summary: {
        documents: 0,
        artifacts: 0,
        artifacts_with_hash: 0,
        unique_hashes: 0,
        assertions: 0,
        evidence_refs: 0,
        fields_covered: 0
      },
      documents: [],
      top_fields: [],
      search: {
        query: requestedQuery,
        limit: requestedLimit,
        count: 0,
        rows: [],
        note: 'spec_db_not_ready'
      }
    };
  }

  const db = specDb.db;
  const scopeBaseSql = `
    sr.category = @category
    AND (
      sr.product_id = @product_id
      OR sr.item_identifier = @product_id
    )
  `;
  const scopeParams = {
    category: context.category,
    product_id: context.productId,
    run_id: context.resolvedRunId
  };
  const runCountRow = db.prepare(
    `SELECT COUNT(*) AS c FROM source_registry sr WHERE ${scopeBaseSql} AND sr.run_id = @run_id`
  ).get(scopeParams);
  const runMatch = toInt(runCountRow?.c, 0) > 0;
  const scopeMode = runMatch ? 'run' : 'product_fallback';
  const scopeSql = runMatch
    ? `${scopeBaseSql} AND sr.run_id = @run_id`
    : scopeBaseSql;

  const summaryRow = db.prepare(`
    SELECT
      COUNT(DISTINCT sr.source_id) AS documents,
      COUNT(sa.artifact_id) AS artifacts,
      SUM(CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN 1 ELSE 0 END) AS artifacts_with_hash,
      COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN sa.content_hash END) AS unique_hashes,
      COUNT(DISTINCT asr.assertion_id) AS assertions,
      COUNT(ser.evidence_ref_id) AS evidence_refs,
      COUNT(DISTINCT asr.field_key) AS fields_covered
    FROM source_registry sr
    LEFT JOIN source_artifacts sa ON sa.source_id = sr.source_id
    LEFT JOIN source_assertions asr ON asr.source_id = sr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
  `).get(scopeParams) || {};

  const documents = db.prepare(`
    SELECT
      sr.source_id,
      sr.source_url,
      sr.source_host,
      sr.source_tier,
      sr.crawl_status,
      sr.http_status,
      sr.fetched_at,
      sr.run_id,
      COUNT(DISTINCT sa.artifact_id) AS artifact_count,
      SUM(CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN 1 ELSE 0 END) AS hash_count,
      COUNT(DISTINCT CASE WHEN TRIM(COALESCE(sa.content_hash, '')) <> '' THEN sa.content_hash END) AS unique_hashes,
      COUNT(DISTINCT asr.assertion_id) AS assertion_count,
      COUNT(ser.evidence_ref_id) AS evidence_ref_count
    FROM source_registry sr
    LEFT JOIN source_artifacts sa ON sa.source_id = sr.source_id
    LEFT JOIN source_assertions asr ON asr.source_id = sr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
    GROUP BY sr.source_id
    ORDER BY COALESCE(sr.fetched_at, sr.updated_at, sr.created_at) DESC, sr.source_id
    LIMIT 120
  `).all(scopeParams);

  const topFields = db.prepare(`
    SELECT
      asr.field_key,
      COUNT(DISTINCT asr.assertion_id) AS assertions,
      COUNT(ser.evidence_ref_id) AS evidence_refs,
      COUNT(DISTINCT asr.source_id) AS distinct_sources
    FROM source_assertions asr
    JOIN source_registry sr ON sr.source_id = asr.source_id
    LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
    WHERE ${scopeSql}
    GROUP BY asr.field_key
    ORDER BY assertions DESC, evidence_refs DESC, asr.field_key
    LIMIT 80
  `).all(scopeParams);

  let searchRows = [];
  if (requestedQuery) {
    const queryToken = requestedQuery.toLowerCase();
    const queryLike = `%${queryToken}%`;
    const rankedRows = db.prepare(`
      SELECT
        sr.source_id,
        sr.source_url,
        sr.source_host,
        sr.source_tier,
        sr.run_id,
        asr.assertion_id,
        asr.field_key,
        asr.context_kind,
        asr.value_raw,
        asr.value_normalized,
        ser.snippet_id,
        ser.evidence_url,
        ser.quote,
        c.snippet_text
      FROM source_registry sr
      JOIN source_assertions asr ON asr.source_id = sr.source_id
      LEFT JOIN source_evidence_refs ser ON ser.assertion_id = asr.assertion_id
      LEFT JOIN candidates c
        ON c.candidate_id = asr.candidate_id
       AND c.category = sr.category
      WHERE ${scopeSql}
        AND (
          LOWER(COALESCE(asr.field_key, '')) LIKE @query_like
          OR LOWER(COALESCE(asr.value_raw, '')) LIKE @query_like
          OR LOWER(COALESCE(asr.value_normalized, '')) LIKE @query_like
          OR LOWER(COALESCE(ser.quote, '')) LIKE @query_like
          OR LOWER(COALESCE(c.snippet_text, '')) LIKE @query_like
        )
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(asr.field_key, '')) = @query_exact THEN 0
          WHEN LOWER(COALESCE(asr.field_key, '')) LIKE @query_like THEN 1
          WHEN LOWER(COALESCE(asr.value_raw, '')) LIKE @query_like THEN 2
          WHEN LOWER(COALESCE(ser.quote, '')) LIKE @query_like THEN 3
          ELSE 4
        END,
        COALESCE(sr.source_tier, 99) ASC,
        COALESCE(sr.fetched_at, sr.updated_at, sr.created_at) DESC,
        sr.source_id
      LIMIT @limit
    `).all({
      ...scopeParams,
      query_like: queryLike,
      query_exact: queryToken,
      limit: requestedLimit
    });

    searchRows = rankedRows.map((row) => ({
      source_id: String(row.source_id || '').trim(),
      source_url: String(row.source_url || '').trim(),
      source_host: String(row.source_host || '').trim(),
      source_tier: row.source_tier === null || row.source_tier === undefined
        ? null
        : toInt(row.source_tier, 0),
      run_id: String(row.run_id || '').trim() || null,
      field_key: String(row.field_key || '').trim(),
      context_kind: String(row.context_kind || '').trim(),
      assertion_id: String(row.assertion_id || '').trim(),
      snippet_id: String(row.snippet_id || '').trim() || null,
      evidence_url: String(row.evidence_url || '').trim() || null,
      quote_preview: String(row.quote || '').trim().slice(0, 280),
      snippet_preview: String(row.snippet_text || '').trim().slice(0, 280),
      value_preview: String(row.value_raw || row.value_normalized || '').trim().slice(0, 160)
    }));
  }

  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    db_ready: true,
    scope: {
      mode: scopeMode,
      run_match: runMatch,
      run_id: context.resolvedRunId
    },
    summary: {
      documents: toInt(summaryRow.documents, 0),
      artifacts: toInt(summaryRow.artifacts, 0),
      artifacts_with_hash: toInt(summaryRow.artifacts_with_hash, 0),
      unique_hashes: toInt(summaryRow.unique_hashes, 0),
      assertions: toInt(summaryRow.assertions, 0),
      evidence_refs: toInt(summaryRow.evidence_refs, 0),
      fields_covered: toInt(summaryRow.fields_covered, 0)
    },
    documents: documents.map((row) => ({
      source_id: String(row.source_id || '').trim(),
      source_url: String(row.source_url || '').trim(),
      source_host: String(row.source_host || '').trim(),
      source_tier: row.source_tier === null || row.source_tier === undefined
        ? null
        : toInt(row.source_tier, 0),
      crawl_status: String(row.crawl_status || '').trim(),
      http_status: row.http_status === null || row.http_status === undefined
        ? null
        : toInt(row.http_status, 0),
      fetched_at: String(row.fetched_at || '').trim() || null,
      run_id: String(row.run_id || '').trim() || null,
      artifact_count: toInt(row.artifact_count, 0),
      hash_count: toInt(row.hash_count, 0),
      unique_hashes: toInt(row.unique_hashes, 0),
      assertion_count: toInt(row.assertion_count, 0),
      evidence_ref_count: toInt(row.evidence_ref_count, 0)
    })),
    top_fields: topFields.map((row) => ({
      field_key: String(row.field_key || '').trim(),
      assertions: toInt(row.assertions, 0),
      evidence_refs: toInt(row.evidence_refs, 0),
      distinct_sources: toInt(row.distinct_sources, 0)
    })),
    search: {
      query: requestedQuery,
      limit: requestedLimit,
      count: searchRows.length,
      rows: searchRows
    }
  };
}

function clampAutomationPriority(value, fallback = 50) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, parsed));
}

function automationPriorityForRequiredLevel(requiredLevel = '') {
  const level = String(requiredLevel || '').trim().toLowerCase();
  if (level === 'identity') return 10;
  if (level === 'critical') return 20;
  if (level === 'required') return 35;
  if (level === 'expected') return 60;
  if (level === 'optional') return 80;
  return 50;
}

function automationPriorityForJobType(jobType = '') {
  const token = String(jobType || '').trim().toLowerCase();
  if (token === 'repair_search') return 20;
  if (token === 'deficit_rediscovery') return 35;
  if (token === 'staleness_refresh') return 55;
  if (token === 'domain_backoff') return 65;
  return 50;
}

function toStringList(value, limit = 20) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, Math.max(1, toInt(limit, 20)));
}

function addUniqueStrings(base = [], extra = [], limit = 20) {
  const cap = Math.max(1, toInt(limit, 20));
  const seen = new Set(
    (Array.isArray(base) ? base : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );
  for (const value of Array.isArray(extra) ? extra : []) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    if (seen.size >= cap) break;
  }
  return [...seen];
}

function buildAutomationJobId(prefix = '', dedupeKey = '') {
  const lhs = String(prefix || 'job').trim().toLowerCase() || 'job';
  const rhs = String(dedupeKey || '').trim().toLowerCase();
  if (!rhs) return `${lhs}:na`;
  let hash = 0;
  for (let i = 0; i < rhs.length; i += 1) {
    hash = ((hash << 5) - hash + rhs.charCodeAt(i)) | 0;
  }
  return `${lhs}:${Math.abs(hash).toString(36)}`;
}

function normalizeAutomationStatus(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'queued') return 'queued';
  if (token === 'running') return 'running';
  if (token === 'done') return 'done';
  if (token === 'failed') return 'failed';
  if (token === 'cooldown') return 'cooldown';
  return 'queued';
}

function normalizeAutomationQuery(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildSearchProfileQueryMaps(searchProfile = {}) {
  const queryToFields = new Map();
  const fieldStats = new Map();
  const queryRows = Array.isArray(searchProfile?.query_rows) ? searchProfile.query_rows : [];
  const queryStatsRows = Array.isArray(searchProfile?.query_stats) ? searchProfile.query_stats : [];
  const fieldTargetQueries = searchProfile?.field_target_queries && typeof searchProfile.field_target_queries === 'object'
    ? searchProfile.field_target_queries
    : {};

  const ensureFieldStat = (fieldKey) => {
    const field = String(fieldKey || '').trim();
    if (!field) return null;
    if (!fieldStats.has(field)) {
      fieldStats.set(field, {
        attempts: 0,
        results: 0,
        queries: new Set()
      });
    }
    return fieldStats.get(field);
  };

  const queryStatsByQuery = new Map();
  for (const row of queryStatsRows) {
    const queryRaw = String(row?.query || '').trim();
    const query = normalizeAutomationQuery(queryRaw);
    if (!query) continue;
    queryStatsByQuery.set(query, {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      result_count: Math.max(0, toInt(row?.result_count, 0))
    });
  }

  for (const row of queryRows) {
    const queryRaw = String(row?.query || '').trim();
    const query = normalizeAutomationQuery(queryRaw);
    if (!query) continue;
    const targetFields = toStringList(row?.target_fields, 24);
    if (targetFields.length > 0) {
      if (!queryToFields.has(query)) queryToFields.set(query, new Set());
      const querySet = queryToFields.get(query);
      for (const field of targetFields) {
        querySet.add(field);
      }
    }
    const statsFallback = queryStatsByQuery.get(query) || {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      result_count: Math.max(0, toInt(row?.result_count, 0))
    };
    for (const field of targetFields) {
      const stat = ensureFieldStat(field);
      if (!stat) continue;
      stat.attempts += Math.max(0, toInt(statsFallback.attempts, 0));
      stat.results += Math.max(0, toInt(statsFallback.result_count, 0));
      stat.queries.add(queryRaw);
    }
  }

  for (const [fieldRaw, queriesRaw] of Object.entries(fieldTargetQueries)) {
    const field = String(fieldRaw || '').trim();
    if (!field) continue;
    const stat = ensureFieldStat(field);
    if (!stat) continue;
    const queries = toStringList(queriesRaw, 20);
    for (const query of queries) {
      const queryToken = normalizeAutomationQuery(query);
      if (!queryToken) continue;
      if (!queryToFields.has(queryToken)) queryToFields.set(queryToken, new Set());
      queryToFields.get(queryToken).add(field);
      stat.queries.add(query);
    }
  }

  const queryToFieldsFlat = new Map();
  for (const [query, set] of queryToFields.entries()) {
    queryToFieldsFlat.set(query, [...set].slice(0, 20));
  }
  const fieldStatsFlat = new Map();
  for (const [field, row] of fieldStats.entries()) {
    fieldStatsFlat.set(field, {
      attempts: Math.max(0, toInt(row?.attempts, 0)),
      results: Math.max(0, toInt(row?.results, 0)),
      queries: [...(row?.queries || new Set())].slice(0, 20)
    });
  }
  return {
    queryToFields: queryToFieldsFlat,
    fieldStats: fieldStatsFlat
  };
}

async function readIndexLabRunAutomationQueue(runId) {
  const context = await resolveIndexLabRunContext(runId);
  if (!context) return null;

  const eventRows = await readIndexLabRunEvents(context.token, 8000);
  const needset = await readIndexLabRunNeedSet(context.token);
  const searchProfile = await readIndexLabRunSearchProfile(context.token);
  const { queryToFields, fieldStats } = buildSearchProfileQueryMaps(searchProfile || {});

  const jobsById = new Map();
  const actions = [];
  const repairJobIdByQuery = new Map();
  const deficitJobIdByField = new Map();
  const contentHashSeen = new Map();

  const sortedEvents = [...eventRows]
    .filter((row) => row && typeof row === 'object')
    .sort((a, b) => {
      const aMs = parseTsMs(a.ts);
      const bMs = parseTsMs(b.ts);
      if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) {
        return aMs - bMs;
      }
      return String(a.event || '').localeCompare(String(b.event || ''));
    });

  const ensureJob = ({
    jobType = 'deficit_rediscovery',
    dedupeKey = '',
    sourceSignal = 'manual',
    scheduledAt = '',
    priority = null,
    category = context.category,
    productId = context.productId,
    runId: resolvedRunId = context.resolvedRunId,
    fieldTargets = [],
    reasonTags = [],
    domain = '',
    url = '',
    query = '',
    provider = '',
    docHint = '',
    status = 'queued'
  } = {}) => {
    const normalizedJobType = String(jobType || '').trim().toLowerCase() || 'deficit_rediscovery';
    const normalizedDedupe = String(dedupeKey || '').trim() || `${normalizedJobType}:${sourceSignal}`;
    const jobId = buildAutomationJobId(normalizedJobType, normalizedDedupe);
    const normalizedStatus = normalizeAutomationStatus(status);
    if (!jobsById.has(jobId)) {
      jobsById.set(jobId, {
        job_id: jobId,
        job_type: normalizedJobType,
        priority: clampAutomationPriority(
          priority === null || priority === undefined
            ? automationPriorityForJobType(normalizedJobType)
            : priority,
          automationPriorityForJobType(normalizedJobType)
        ),
        status: normalizedStatus,
        category: String(category || '').trim(),
        product_id: String(productId || '').trim(),
        run_id: String(resolvedRunId || '').trim(),
        field_targets: toStringList(fieldTargets, 20),
        url: String(url || '').trim() || null,
        domain: String(domain || '').trim() || null,
        query: String(query || '').trim() || null,
        provider: String(provider || '').trim() || null,
        doc_hint: String(docHint || '').trim() || null,
        dedupe_key: normalizedDedupe,
        source_signal: String(sourceSignal || '').trim() || 'manual',
        scheduled_at: String(scheduledAt || '').trim() || null,
        started_at: null,
        finished_at: null,
        next_run_at: null,
        attempt_count: 0,
        reason_tags: toStringList(reasonTags, 24),
        last_error: null,
        notes: []
      });
    }
    const job = jobsById.get(jobId);
    if (fieldTargets?.length) {
      job.field_targets = addUniqueStrings(job.field_targets, fieldTargets, 20);
    }
    if (reasonTags?.length) {
      job.reason_tags = addUniqueStrings(job.reason_tags, reasonTags, 24);
    }
    if (!job.url && url) job.url = String(url).trim();
    if (!job.domain && domain) job.domain = String(domain).trim();
    if (!job.query && query) job.query = String(query).trim();
    if (!job.provider && provider) job.provider = String(provider).trim();
    if (!job.doc_hint && docHint) job.doc_hint = String(docHint).trim();
    if (!job.scheduled_at && scheduledAt) job.scheduled_at = String(scheduledAt).trim();
    return job;
  };

  const pushAction = ({
    ts = '',
    event = '',
    job = null,
    status = '',
    detail = '',
    reasonTags = []
  } = {}) => {
    if (!job) return;
    actions.push({
      ts: String(ts || '').trim() || null,
      event: String(event || '').trim() || null,
      job_id: job.job_id,
      job_type: job.job_type,
      status: normalizeAutomationStatus(status || job.status),
      source_signal: job.source_signal,
      priority: clampAutomationPriority(job.priority, 50),
      detail: String(detail || '').trim() || null,
      domain: job.domain || null,
      url: job.url || null,
      query: job.query || null,
      field_targets: toStringList(job.field_targets, 20),
      reason_tags: addUniqueStrings(job.reason_tags || [], reasonTags, 24)
    });
  };

  const transitionJob = ({
    job = null,
    status = 'queued',
    ts = '',
    detail = '',
    nextRunAt = '',
    reasonTags = [],
    error = ''
  } = {}) => {
    if (!job) return;
    const normalizedStatus = normalizeAutomationStatus(status);
    job.status = normalizedStatus;
    const safeTs = String(ts || '').trim();
    if (normalizedStatus === 'queued') {
      if (safeTs) job.scheduled_at = safeTs;
      job.finished_at = null;
      job.last_error = null;
    }
    if (normalizedStatus === 'running') {
      if (safeTs) job.started_at = safeTs;
      job.finished_at = null;
      job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      job.last_error = null;
    }
    if (normalizedStatus === 'done') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
        job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      }
      if (safeTs) job.finished_at = safeTs;
      job.last_error = null;
    }
    if (normalizedStatus === 'failed') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
        job.attempt_count = Math.max(0, toInt(job.attempt_count, 0)) + 1;
      }
      if (safeTs) job.finished_at = safeTs;
      job.last_error = String(error || detail || 'job_failed').trim() || 'job_failed';
    }
    if (normalizedStatus === 'cooldown') {
      if (safeTs && !job.started_at) {
        job.started_at = safeTs;
      }
      if (safeTs) job.finished_at = safeTs;
    }
    const nextRun = String(nextRunAt || '').trim();
    if (nextRun) {
      job.next_run_at = nextRun;
    }
    if (reasonTags?.length) {
      job.reason_tags = addUniqueStrings(job.reason_tags, reasonTags, 24);
    }
    const detailToken = String(detail || '').trim();
    if (detailToken) {
      job.notes = addUniqueStrings(job.notes, [detailToken], 20);
    }
  };

  const setRepairJobByQuery = (query = '', job = null) => {
    const token = normalizeAutomationQuery(query);
    if (!token || !job) return;
    repairJobIdByQuery.set(token, job.job_id);
  };

  const getRepairJobByQuery = (query = '') => {
    const token = normalizeAutomationQuery(query);
    if (!token) return null;
    const jobId = repairJobIdByQuery.get(token);
    if (!jobId) return null;
    return jobsById.get(jobId) || null;
  };

  const setDeficitJobByField = (fieldKey = '', job = null) => {
    const token = String(fieldKey || '').trim();
    if (!token || !job) return;
    deficitJobIdByField.set(token, job.job_id);
  };

  const getDeficitJobsForQuery = (query = '') => {
    const token = normalizeAutomationQuery(query);
    if (!token) return [];
    const fields = queryToFields.get(token) || [];
    return fields
      .map((field) => jobsById.get(deficitJobIdByField.get(field)))
      .filter(Boolean);
  };

  for (const evt of sortedEvents) {
    const eventName = String(evt?.event || '').trim().toLowerCase();
    if (!eventName) continue;
    const payload = evt?.payload && typeof evt.payload === 'object'
      ? evt.payload
      : {};
    const ts = String(evt?.ts || payload.ts || '').trim();
    const query = String(payload.query || evt.query || '').trim();
    const url = String(payload.url || payload.source_url || evt.url || evt.source_url || '').trim();
    const domain = normalizeDomainToken(
      payload.domain || payload.host || evt.domain || evt.host || domainFromUrl(url)
    );
    const provider = String(payload.provider || evt.provider || '').trim();

    if (eventName === 'repair_query_enqueued') {
      const reason = String(payload.reason || evt.reason || '').trim();
      const docHint = String(payload.doc_hint || evt.doc_hint || '').trim();
      const fieldTargets = toStringList(payload.field_targets || evt.field_targets, 16);
      const dedupeKey = [
        'repair',
        domain,
        query.toLowerCase(),
        fieldTargets.join('|').toLowerCase(),
        reason.toLowerCase()
      ].join('::');
      const job = ensureJob({
        jobType: 'repair_search',
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: 20,
        fieldTargets,
        reasonTags: [reason || 'repair_signal', 'phase_04_signal'],
        domain,
        url,
        query,
        provider,
        docHint,
        status: 'queued'
      });
      transitionJob({
        job,
        status: 'queued',
        ts,
        detail: reason || 'repair_query_enqueued',
        reasonTags: [reason || 'repair_signal']
      });
      setRepairJobByQuery(query, job);
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'queued',
        detail: reason || 'repair_query_enqueued',
        reasonTags: [reason || 'repair_signal']
      });
      continue;
    }

    if (eventName === 'blocked_domain_cooldown_applied') {
      const reason = toInt(payload.status, toInt(evt.status, 0)) === 429
        ? 'status_429_backoff'
        : 'status_403_backoff';
      const dedupeKey = `domain_backoff::${domain}::${reason}`;
      const job = ensureJob({
        jobType: 'domain_backoff',
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: 65,
        reasonTags: [reason, 'blocked_domain_threshold'],
        domain,
        status: 'cooldown'
      });
      transitionJob({
        job,
        status: 'cooldown',
        ts,
        detail: `blocked domain threshold reached (${toInt(payload.blocked_count, 0)})`,
        reasonTags: [reason]
      });
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'cooldown',
        detail: `blocked domain threshold reached (${toInt(payload.blocked_count, 0)})`,
        reasonTags: [reason]
      });
      continue;
    }

    if (eventName === 'url_cooldown_applied') {
      const reason = String(payload.reason || evt.reason || '').trim().toLowerCase() || 'cooldown';
      const nextRetryAt = String(payload.next_retry_ts || payload.next_retry_at || payload.cooldown_until || evt.next_retry_ts || '').trim();
      const isPathDead = reason === 'path_dead_pattern';
      const jobType = isPathDead ? 'repair_search' : 'domain_backoff';
      const dedupeKey = `${jobType}::${domain}::${reason}::${urlPathToken(url || '/')}`;
      const job = ensureJob({
        jobType,
        dedupeKey,
        sourceSignal: 'url_health',
        scheduledAt: ts,
        priority: isPathDead ? 22 : 68,
        reasonTags: [reason],
        domain,
        url,
        status: 'cooldown'
      });
      transitionJob({
        job,
        status: 'cooldown',
        ts,
        detail: reason,
        nextRunAt: nextRetryAt,
        reasonTags: [reason]
      });
      pushAction({
        ts,
        event: eventName,
        job,
        status: 'cooldown',
        detail: reason,
        reasonTags: [reason]
      });
      continue;
    }

    if (eventName === 'source_fetch_skipped') {
      const skipReason = String(payload.skip_reason || payload.reason || evt.skip_reason || evt.reason || '').trim().toLowerCase();
      if (skipReason === 'retry_later' || skipReason === 'blocked_budget' || skipReason === 'cooldown') {
        const nextRetryAt = String(payload.next_retry_ts || payload.next_retry_at || evt.next_retry_ts || '').trim();
        const dedupeKey = `domain_backoff::${domain}::${skipReason}::${urlPathToken(url || '/')}`;
        const job = ensureJob({
          jobType: 'domain_backoff',
          dedupeKey,
          sourceSignal: 'url_health',
          scheduledAt: ts,
          priority: 70,
          reasonTags: [skipReason],
          domain,
          url,
          status: 'cooldown'
        });
        transitionJob({
          job,
          status: 'cooldown',
          ts,
          detail: skipReason,
          nextRunAt: nextRetryAt,
          reasonTags: [skipReason]
        });
        pushAction({
          ts,
          event: eventName,
          job,
          status: 'cooldown',
          detail: skipReason,
          reasonTags: [skipReason]
        });
      }
      continue;
    }

    if (eventName === 'source_processed' || eventName === 'fetch_finished') {
      const statusCode = toInt(payload.status, toInt(evt.status, 0));
      const contentHash = String(payload.content_hash || payload.contentHash || evt.content_hash || '').trim();
      if (statusCode >= 200 && statusCode < 300 && contentHash) {
        const seen = contentHashSeen.get(contentHash);
        if (!seen) {
          contentHashSeen.set(contentHash, {
            ts,
            url,
            host: domain
          });
        } else {
          const dedupeKey = `staleness_refresh::${contentHash}`;
          const job = ensureJob({
            jobType: 'staleness_refresh',
            dedupeKey,
            sourceSignal: 'staleness',
            scheduledAt: ts,
            priority: 55,
            reasonTags: ['content_hash_duplicate'],
            domain,
            url,
            status: 'done'
          });
          transitionJob({
            job,
            status: 'done',
            ts,
            detail: `content hash repeated (first ${seen.ts || '-'})`,
            reasonTags: ['content_hash_duplicate']
          });
          pushAction({
            ts,
            event: 'staleness_hash_duplicate',
            job,
            status: 'done',
            detail: `content hash repeated (first ${seen.ts || '-'})`,
            reasonTags: ['content_hash_duplicate']
          });
        }
      }
      continue;
    }

    if (eventName === 'discovery_query_started' || eventName === 'search_started') {
      const repairJob = getRepairJobByQuery(query);
      if (repairJob) {
        transitionJob({
          job: repairJob,
          status: 'running',
          ts,
          detail: 'repair query execution started'
        });
        pushAction({
          ts,
          event: eventName,
          job: repairJob,
          status: 'running',
          detail: 'repair query execution started'
        });
      }
      for (const deficitJob of getDeficitJobsForQuery(query)) {
        transitionJob({
          job: deficitJob,
          status: 'running',
          ts,
          detail: 'deficit rediscovery query started'
        });
        pushAction({
          ts,
          event: eventName,
          job: deficitJob,
          status: 'running',
          detail: 'deficit rediscovery query started'
        });
      }
      continue;
    }

    if (eventName === 'discovery_query_completed' || eventName === 'search_finished') {
      const resultCount = Math.max(0, toInt(payload.result_count, toInt(evt.result_count, 0)));
      const repairJob = getRepairJobByQuery(query);
      if (repairJob) {
        const done = resultCount > 0;
        transitionJob({
          job: repairJob,
          status: done ? 'done' : 'failed',
          ts,
          detail: done ? `repair query completed with ${resultCount} results` : 'repair query returned no results',
          error: done ? '' : 'repair_no_results'
        });
        pushAction({
          ts,
          event: eventName,
          job: repairJob,
          status: done ? 'done' : 'failed',
          detail: done ? `repair query completed with ${resultCount} results` : 'repair query returned no results',
          reasonTags: [done ? 'results_found' : 'no_results']
        });
      }
      for (const deficitJob of getDeficitJobsForQuery(query)) {
        const done = resultCount > 0;
        transitionJob({
          job: deficitJob,
          status: done ? 'done' : 'failed',
          ts,
          detail: done ? `deficit query completed with ${resultCount} results` : 'deficit query returned no results',
          error: done ? '' : 'deficit_no_results'
        });
        pushAction({
          ts,
          event: eventName,
          job: deficitJob,
          status: done ? 'done' : 'failed',
          detail: done ? `deficit query completed with ${resultCount} results` : 'deficit query returned no results',
          reasonTags: [done ? 'results_found' : 'no_results']
        });
      }
      continue;
    }
  }

  const needRows = Array.isArray(needset?.needs) ? needset.needs : [];
  const deficitCandidates = needRows
    .map((row) => ({
      field_key: String(row?.field_key || '').trim(),
      required_level: String(row?.required_level || '').trim().toLowerCase(),
      need_score: Number.parseFloat(String(row?.need_score ?? 0)) || 0,
      reasons: toStringList(row?.reasons, 12)
    }))
    .filter((row) => row.field_key)
    .filter((row) => row.reasons.some((reason) => (
      reason === 'missing'
      || reason === 'tier_pref_unmet'
      || reason === 'min_refs_fail'
      || reason === 'low_conf'
      || reason === 'conflict'
      || reason === 'publish_gate_block'
      || reason === 'blocked_by_identity'
    )))
    .sort((a, b) => b.need_score - a.need_score || a.field_key.localeCompare(b.field_key))
    .slice(0, 16);

  for (const row of deficitCandidates) {
    const field = row.field_key;
    const stats = fieldStats.get(field) || { attempts: 0, results: 0, queries: [] };
    const querySample = Array.isArray(stats.queries) ? stats.queries[0] : '';
    const dedupeKey = `deficit_rediscovery::${field}`;
    const job = ensureJob({
      jobType: 'deficit_rediscovery',
      dedupeKey,
      sourceSignal: 'needset_deficit',
      scheduledAt: String(needset?.generated_at || '').trim() || context.meta?.started_at || '',
      priority: automationPriorityForRequiredLevel(row.required_level),
      fieldTargets: [field],
      reasonTags: row.reasons,
      query: String(querySample || '').trim(),
      provider: String(searchProfile?.provider || '').trim(),
      status: 'queued'
    });
    setDeficitJobByField(field, job);
    if (toInt(stats.attempts, 0) > 0) {
      const hasResults = toInt(stats.results, 0) > 0;
      transitionJob({
        job,
        status: hasResults ? 'done' : 'failed',
        ts: String(needset?.generated_at || context.meta?.ended_at || context.meta?.started_at || '').trim(),
        detail: hasResults
          ? `searchprofile queries returned ${toInt(stats.results, 0)} results`
          : 'searchprofile queries executed with no results',
        error: hasResults ? '' : 'searchprofile_no_results'
      });
      pushAction({
        ts: String(needset?.generated_at || context.meta?.ended_at || context.meta?.started_at || '').trim(),
        event: 'needset_deficit_resolved_from_searchprofile',
        job,
        status: hasResults ? 'done' : 'failed',
        detail: hasResults
          ? `searchprofile queries returned ${toInt(stats.results, 0)} results`
          : 'searchprofile queries executed with no results',
        reasonTags: [hasResults ? 'results_found' : 'no_results']
      });
    } else {
      transitionJob({
        job,
        status: 'queued',
        ts: String(needset?.generated_at || context.meta?.started_at || '').trim(),
        detail: 'needset deficit queued for rediscovery',
        reasonTags: row.reasons
      });
      pushAction({
        ts: String(needset?.generated_at || context.meta?.started_at || '').trim(),
        event: 'needset_deficit_enqueued',
        job,
        status: 'queued',
        detail: 'needset deficit queued for rediscovery',
        reasonTags: row.reasons
      });
    }
  }

  const jobs = [...jobsById.values()];
  const statusCounts = {
    queued: 0,
    running: 0,
    done: 0,
    failed: 0,
    cooldown: 0
  };
  const typeCounts = {
    repair_search: 0,
    staleness_refresh: 0,
    deficit_rediscovery: 0,
    domain_backoff: 0
  };
  for (const job of jobs) {
    const status = normalizeAutomationStatus(job.status);
    statusCounts[status] += 1;
    const jobType = String(job.job_type || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(typeCounts, jobType)) {
      typeCounts[jobType] += 1;
    }
  }

  const statusOrder = {
    running: 0,
    queued: 1,
    cooldown: 2,
    failed: 3,
    done: 4
  };
  const sortedJobs = jobs
    .sort((a, b) => {
      const aRank = statusOrder[normalizeAutomationStatus(a.status)] ?? 99;
      const bRank = statusOrder[normalizeAutomationStatus(b.status)] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aTs = parseTsMs(a.scheduled_at || a.started_at || a.finished_at || '');
      const bTs = parseTsMs(b.scheduled_at || b.started_at || b.finished_at || '');
      if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) return bTs - aTs;
      return String(a.job_id || '').localeCompare(String(b.job_id || ''));
    })
    .slice(0, 300);

  const sortedActions = actions
    .sort((a, b) => parseTsMs(String(b.ts || '')) - parseTsMs(String(a.ts || '')))
    .slice(0, 120);

  return {
    generated_at: new Date().toISOString(),
    run_id: context.resolvedRunId,
    category: context.category,
    product_id: context.productId,
    summary: {
      total_jobs: sortedJobs.length,
      queue_depth: statusCounts.queued + statusCounts.running + statusCounts.failed,
      active_jobs: statusCounts.queued + statusCounts.running,
      ...statusCounts,
      ...typeCounts
    },
    policies: {
      owner: 'phase_06b',
      loops: {
        repair_search: true,
        staleness_refresh: true,
        deficit_rediscovery: true
      }
    },
    jobs: sortedJobs,
    actions: sortedActions
  };
}

async function listIndexLabRuns({ limit = 50 } = {}) {
  let dirs = [];
  try {
    const entries = await fs.readdir(INDEXLAB_ROOT, { withFileTypes: true });
    dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
  dirs.sort((a, b) => String(b).localeCompare(String(a)));
  const scanLimit = Math.max(Math.max(1, toInt(limit, 50)) * 2, 120);
  dirs = dirs.slice(0, scanLimit);

  const summarizeEvents = (events = []) => {
    const counters = {
      pages_checked: 0,
      fetched_ok: 0,
      fetched_404: 0,
      fetched_blocked: 0,
      fetched_error: 0,
      parse_completed: 0,
      indexed_docs: 0,
      fields_filled: 0
    };
    let productId = '';
    let startedAt = '';
    let endedAt = '';
    for (const row of events) {
      if (!row || typeof row !== 'object') continue;
      const ts = String(row.ts || '').trim();
      if (ts) {
        if (!startedAt) startedAt = ts;
        endedAt = ts;
      }
      if (!productId) {
        productId = String(row.product_id || '').trim();
      }
      const stage = String(row.stage || '').trim();
      const event = String(row.event || '').trim();
      const payload = row.payload && typeof row.payload === 'object'
        ? row.payload
        : {};
      const scope = String(payload.scope || '').trim();
      if (stage === 'fetch' && event === 'fetch_started' && scope === 'url') {
        counters.pages_checked += 1;
      } else if (stage === 'fetch' && event === 'fetch_finished' && scope === 'url') {
        const statusClass = String(payload.status_class || 'error').trim();
        if (statusClass === 'ok') counters.fetched_ok += 1;
        else if (statusClass === '404') counters.fetched_404 += 1;
        else if (statusClass === 'blocked') counters.fetched_blocked += 1;
        else counters.fetched_error += 1;
      } else if (stage === 'parse' && event === 'parse_finished' && scope === 'url') {
        counters.parse_completed += 1;
      } else if (stage === 'index' && event === 'index_finished' && scope === 'url') {
        counters.indexed_docs += 1;
        counters.fields_filled += Number.parseInt(String(payload.count || 0), 10) || 0;
      }
    }
    return { productId, startedAt, endedAt, counters };
  };
  const normalizeStartupMs = (value) => {
    const input = value && typeof value === 'object' ? value : {};
    const parseMetric = (field) => {
      if (!(field in input)) return null;
      const raw = Number.parseInt(String(input[field] ?? ''), 10);
      return Number.isFinite(raw) ? Math.max(0, raw) : null;
    };
    return {
      first_event: parseMetric('first_event'),
      search_started: parseMetric('search_started'),
      fetch_started: parseMetric('fetch_started'),
      parse_started: parseMetric('parse_started'),
      index_started: parseMetric('index_started')
    };
  };

  const rows = [];
  for (const dir of dirs) {
    const runDir = safeJoin(INDEXLAB_ROOT, dir);
    if (!runDir) continue;
    const runMetaPath = path.join(runDir, 'run.json');
    const runEventsPath = path.join(runDir, 'run_events.ndjson');
    const meta = await safeReadJson(runMetaPath);
    const stat = await safeStat(runMetaPath) || await safeStat(runEventsPath);
    const eventRows = await readIndexLabRunEvents(dir, 6000);
    const eventSummary = summarizeEvents(eventRows);
    const rawStatus = String(meta?.status || 'unknown').trim();
    const resolvedStatus = (
      rawStatus.toLowerCase() === 'running' && !isProcessRunning()
    ) ? 'completed' : rawStatus;
    const hasMetaCounters = meta?.counters && typeof meta.counters === 'object';
    rows.push({
      run_id: String(meta?.run_id || dir).trim(),
      category: String(meta?.category || '').trim(),
      product_id: String(meta?.product_id || eventSummary.productId || '').trim(),
      status: String(resolvedStatus || 'unknown').trim(),
      started_at: String(meta?.started_at || eventSummary.startedAt || stat?.mtime?.toISOString?.() || '').trim(),
      ended_at: String(meta?.ended_at || (resolvedStatus !== 'running' ? eventSummary.endedAt : '') || '').trim(),
      identity_fingerprint: String(meta?.identity_fingerprint || '').trim(),
      identity_lock_status: String(meta?.identity_lock_status || '').trim(),
      dedupe_mode: String(meta?.dedupe_mode || '').trim(),
      phase_cursor: String(meta?.phase_cursor || '').trim(),
      startup_ms: normalizeStartupMs(meta?.startup_ms),
      events_path: runEventsPath,
      run_dir: runDir,
      counters: hasMetaCounters ? meta.counters : eventSummary.counters
    });
  }

  rows.sort((a, b) => {
    const aMs = Date.parse(String(a.started_at || ''));
    const bMs = Date.parse(String(b.started_at || ''));
    return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
  });
  return rows.slice(0, Math.max(1, toInt(limit, 50)));
}

async function buildIndexingDomainChecklist({
  storage,
  config,
  outputRoot,
  category,
  productId = '',
  runId = '',
  windowMinutes = 120,
  includeUrls = false
} = {}) {
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const resolvedProductId = String(productId || '').trim();
  let resolvedRunId = String(runId || '').trim();
  const brandTokens = new Set();
  const notes = [];

  if (!normalizedCategory) {
    return {
      category: null,
      productId: resolvedProductId || null,
      runId: resolvedRunId || null,
      window_minutes: windowMinutes,
      rows: [],
      milestones: {
        manufacturer_domain: null,
        manufacturer: null,
        primary_domains: []
      },
      domain_field_yield: [],
      repair_queries: [],
      bad_url_patterns: [],
      notes: ['category_required']
    };
  }

  if (resolvedProductId) {
    const pidParts = resolvedProductId.split('-').filter(Boolean);
    if (pidParts.length >= 2) {
      addTokensFromText(brandTokens, pidParts[1]);
      addTokensFromText(brandTokens, `${pidParts[1]} ${pidParts[2] || ''}`.trim());
    }
    try {
      const catalog = await loadProductCatalog(config, normalizedCategory);
      const entry = catalog?.products?.[resolvedProductId] || null;
      if (entry?.brand) {
        addTokensFromText(brandTokens, entry.brand);
      }
    } catch {
      // ignore optional catalog lookup failures
    }
  }

  if (!resolvedRunId && resolvedProductId) {
    const latestBase = storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'latest');
    const latestSummary = await storage.readJsonOrNull(`${latestBase}/summary.json`).catch(() => null);
    resolvedRunId = String(latestSummary?.runId || '').trim();
  }

  let events = [];
  if (resolvedProductId && resolvedRunId) {
    const runEventsKey = storage.resolveOutputKey(
      normalizedCategory,
      resolvedProductId,
      'runs',
      resolvedRunId,
      'logs',
      'events.jsonl.gz'
    );
    const runEventsPath = path.join(outputRoot, ...runEventsKey.split('/'));
    events = await readGzipJsonlEvents(runEventsPath);
  }
  if (events.length === 0) {
    const runtimeEventsPath = path.join(outputRoot, '_runtime', 'events.jsonl');
    events = await readJsonlEvents(runtimeEventsPath);
  }

  events = events.filter((evt) => {
    const evtCategory = String(evt.category || evt.cat || '').trim().toLowerCase();
    if (evtCategory) return evtCategory === normalizedCategory;
    const pid = String(evt.productId || evt.product_id || '').trim().toLowerCase();
    return pid.startsWith(`${normalizedCategory}-`);
  });

  if (resolvedProductId) {
    events = events.filter((evt) => String(evt.productId || evt.product_id || '').trim() === resolvedProductId);
  }

  if (!resolvedRunId) {
    let latestTs = -1;
    for (const evt of events) {
      const evtRunId = String(evt.runId || '').trim();
      if (!evtRunId) continue;
      const ts = parseTsMs(evt.ts);
      if (!Number.isFinite(ts)) continue;
      if (ts > latestTs) {
        latestTs = ts;
        resolvedRunId = evtRunId;
      }
    }
  }

  if (resolvedRunId) {
    events = events.filter((evt) => String(evt.runId || '').trim() === resolvedRunId);
  } else {
    const sinceMs = Date.now() - (Math.max(5, toInt(windowMinutes, 120)) * 60 * 1000);
    events = events.filter((evt) => {
      const ts = parseTsMs(evt.ts);
      return Number.isFinite(ts) && ts >= sinceMs;
    });
    notes.push('no_run_id_resolved_using_time_window');
  }

  const buckets = new Map();
  const startTimesByKey = new Map();
  const repairQueryRows = [];
  const repairQueryDedup = new Set();
  const badUrlPatterns = new Map();
  const ensureBucket = (domain, siteKind = 'other') => {
    const host = normalizeDomainToken(domain);
    if (!host) return null;
    if (!buckets.has(host)) {
      buckets.set(host, createDomainBucket(host, siteKind));
    } else {
      const existing = buckets.get(host);
      existing.site_kind = choosePreferredSiteKind(existing.site_kind, siteKind);
    }
    return buckets.get(host);
  };

  for (const evt of events) {
    const eventName = String(evt.event || '').trim();
    const urlRaw = String(evt.url || evt.finalUrl || evt.source_url || '').trim();
    const domain = domainFromUrl(urlRaw || evt.domain || evt.host || '');
    if (!domain) continue;
    if (isHelperPseudoDomain(domain)) continue;
    const siteKind = classifySiteKind({
      domain,
      role: evt.role,
      tierName: evt.tierName,
      brandTokens
    });
    const bucket = ensureBucket(domain, siteKind);
    if (!bucket) continue;
    if (urlRaw) bucket.seen_urls.add(urlRaw);

    const normalizedRole = String(evt.role || '').trim().toLowerCase();
    if (normalizedRole) {
      bucket.roles_seen.add(normalizedRole);
      bucket.site_kind = choosePreferredSiteKind(bucket.site_kind, classifySiteKind({
        domain,
        role: normalizedRole,
        tierName: evt.tierName,
        brandTokens
      }));
    }

    const normalizedUrl = urlRaw || '';
    const fetchKey = `${String(evt.runId || resolvedRunId || '').trim()}|${normalizedUrl}`;
    if (eventName === 'source_fetch_started') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        bucket.urls_selected_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          urlStat.selected_count += 1;
          urlStat.fetch_started_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      bucket.started_count += 1;
      const startTs = parseTsMs(evt.ts);
      if (Number.isFinite(startTs) && normalizedUrl) {
        const arr = startTimesByKey.get(fetchKey) || [];
        arr.push(startTs);
        startTimesByKey.set(fetchKey, arr);
      }
      continue;
    }

    if (eventName === 'source_discovery_only') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      continue;
    }

    if (eventName === 'source_fetch_skipped') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const skipReason = String(evt.skip_reason || evt.reason || '').trim().toLowerCase();
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      if (skipReason === 'cooldown') {
        bucket.dedupe_hits += 1;
      }
      if (skipReason === 'blocked_budget') {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      const nextRetry = String(evt.next_retry_ts || evt.next_retry_at || '').trim();
      if (nextRetry) {
        if (!bucket.next_retry_at) {
          bucket.next_retry_at = nextRetry;
        } else {
          const currentMs = parseTsMs(bucket.next_retry_at);
          const nextMs = parseTsMs(nextRetry);
          if (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs < currentMs)) {
            bucket.next_retry_at = nextRetry;
          }
        }
      }
      continue;
    }

    if (eventName === 'fields_filled_from_source') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const count = Math.max(
        0,
        toInt(evt.count, Array.isArray(evt.filled_fields) ? evt.filled_fields.length : 0)
      );
      bucket.fields_filled_count += count;
      if (normalizedUrl) {
        bucket.indexed_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.indexed = true;
          bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
        }
      }
      continue;
    }

    if (eventName === 'url_cooldown_applied') {
      bucket.dedupe_hits += 1;
      const nextRetry = String(
        evt.next_retry_ts || evt.next_retry_at || evt.cooldown_until || ''
      ).trim();
      const cooldownReason = String(evt.reason || '').trim();
      if (cooldownReason === 'path_dead_pattern') {
        const path = String(urlPathToken(normalizedUrl || evt.url || evt.source_url || '') || '').trim() || '/';
        const patternKey = `${domain}|${path}`;
        const existingPattern = badUrlPatterns.get(patternKey) || {
          domain,
          path,
          reason: cooldownReason,
          count: 0,
          last_ts: ''
        };
        existingPattern.count += 1;
        const eventTs = String(evt.ts || '').trim();
        if (eventTs && (!existingPattern.last_ts || parseTsMs(eventTs) >= parseTsMs(existingPattern.last_ts))) {
          existingPattern.last_ts = eventTs;
        }
        badUrlPatterns.set(patternKey, existingPattern);
      }
      if (nextRetry) {
        if (!bucket.next_retry_at) {
          bucket.next_retry_at = nextRetry;
        } else {
          const currentMs = parseTsMs(bucket.next_retry_at);
          const nextMs = parseTsMs(nextRetry);
          if (Number.isFinite(nextMs) && (!Number.isFinite(currentMs) || nextMs < currentMs)) {
            bucket.next_retry_at = nextRetry;
          }
        }
      }
      continue;
    }

    if (eventName === 'repair_query_enqueued') {
      const query = String(evt.query || '').trim();
      if (query) {
        const sourceUrl = String(evt.source_url || normalizedUrl || '').trim();
        const reason = String(evt.reason || '').trim();
        const dedupeKey = `${domain}|${query}|${reason}|${sourceUrl}`;
        if (!repairQueryDedup.has(dedupeKey)) {
          repairQueryDedup.add(dedupeKey);
          repairQueryRows.push({
            ts: String(evt.ts || '').trim() || null,
            domain,
            query,
            status: toInt(evt.status, 0),
            reason: reason || null,
            source_url: sourceUrl || null,
            cooldown_until: String(evt.cooldown_until || evt.next_retry_ts || '').trim() || null,
            doc_hint: String(evt.doc_hint || '').trim() || null,
            field_targets: Array.isArray(evt.field_targets)
              ? evt.field_targets.map((row) => String(row || '').trim()).filter(Boolean).slice(0, 20)
              : []
          });
        }
      }
      continue;
    }

    if (eventName === 'source_processed' || eventName === 'source_fetch_failed') {
      const statusCode = toInt(evt.status, 0);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      bucket.completed_count += 1;
      if (fetchOutcome && Object.prototype.hasOwnProperty.call(bucket.outcome_counts, fetchOutcome)) {
        bucket.outcome_counts[fetchOutcome] += 1;
      }
      if (urlStat) {
        urlStat.processed_count += 1;
        urlStat.last_outcome = fetchOutcome || urlStat.last_outcome;
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts, status: statusCode });
      }
      const startArr = startTimesByKey.get(fetchKey) || [];
      if (startArr.length > 0) {
        const startTs = startArr.shift();
        if (startArr.length > 0) {
          startTimesByKey.set(fetchKey, startArr);
        } else {
          startTimesByKey.delete(fetchKey);
        }
        const endTs = parseTsMs(evt.ts);
        if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs >= startTs) {
          bucket.fetch_durations.push(endTs - startTs);
        }
      }
    }

    if (eventName === 'source_processed') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const status = toInt(evt.status, 0);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
        }
      }
      if (fetchOutcome === 'ok') {
        if (normalizedUrl) bucket.fetched_ok_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.fetched_ok = true;
        }
        const ts = String(evt.ts || '').trim();
        if (ts && (!bucket.last_success_at || parseTsMs(ts) > parseTsMs(bucket.last_success_at))) {
          bucket.last_success_at = ts;
        }
      }
      if (fetchOutcome === 'not_found' || status === 404 || status === 410) {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (
        fetchOutcome === 'blocked'
        || fetchOutcome === 'rate_limited'
        || fetchOutcome === 'login_wall'
        || fetchOutcome === 'bot_challenge'
      ) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      if (fetchOutcome === 'bad_content') {
        bucket.parse_fail_count += 1;
        if (urlStat) {
          urlStat.parse_fail_count += 1;
        }
      }
      if (normalizedUrl) {
        const candidateCount = toInt(evt.candidate_count, 0);
        const llmCandidateCount = toInt(evt.llm_candidate_count, 0);
        if (candidateCount > 0 || llmCandidateCount > 0) {
          bucket.indexed_urls.add(normalizedUrl);
          if (urlStat) {
            urlStat.indexed = true;
          }
        }
      }
      if (urlStat) {
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts, status });
      }
      continue;
    }

    if (eventName === 'source_fetch_failed') {
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      const fetchOutcome = classifyFetchOutcomeFromEvent(evt);
      if (fetchOutcome === 'not_found') {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (
        fetchOutcome === 'blocked'
        || fetchOutcome === 'rate_limited'
        || fetchOutcome === 'login_wall'
        || fetchOutcome === 'bot_challenge'
      ) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      if (fetchOutcome === 'bad_content') {
        bucket.parse_fail_count += 1;
        if (urlStat) {
          urlStat.parse_fail_count += 1;
        }
      }
      if (urlStat) {
        bumpUrlStatEvent(urlStat, { eventName, ts: evt.ts });
      }
    }
  }

  const domainFieldYield = new Map();
  const incrementDomainFieldYield = (domain, field) => {
    const key = `${domain}|${field}`;
    domainFieldYield.set(key, (domainFieldYield.get(key) || 0) + 1);
  };

  if (resolvedProductId) {
    const latestBase = storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'latest');
    const runBase = resolvedRunId
      ? storage.resolveOutputKey(normalizedCategory, resolvedProductId, 'runs', resolvedRunId)
      : null;
    const provenance =
      (runBase && await storage.readJsonOrNull(`${runBase}/provenance/fields.provenance.json`).catch(() => null))
      || await storage.readJsonOrNull(`${latestBase}/provenance.json`).catch(() => null);

    const fieldMap = provenance && typeof provenance === 'object'
      ? (provenance.fields && typeof provenance.fields === 'object' ? provenance.fields : provenance)
      : {};

    for (const [field, row] of Object.entries(fieldMap || {})) {
      if (!row || typeof row !== 'object') continue;
      const evidence = Array.isArray(row.evidence) ? row.evidence : [];
      if (evidence.length === 0) continue;
      const known = isKnownValue(row.value);
      const passTarget = toInt(row.pass_target, 0);
      const meetsTarget = row.meets_pass_target === true;
      const used = known && (meetsTarget || passTarget > 0 || Number(row.confidence || 0) > 0);

      for (const ev of evidence) {
        const evidenceDomain = normalizeDomainToken(
          ev?.rootDomain || ev?.host || domainFromUrl(ev?.url || '')
        );
        if (!evidenceDomain) continue;
        if (isHelperPseudoDomain(evidenceDomain)) continue;
        const evidenceSiteKind = classifySiteKind({
          domain: evidenceDomain,
          role: ev?.role,
          tierName: ev?.tierName,
          brandTokens
        });
        const bucket = ensureBucket(evidenceDomain, evidenceSiteKind);
        if (!bucket) continue;
        bucket.evidence_hits += 1;
        if (used) {
          bucket.evidence_used += 1;
          bucket.fields_covered.add(field);
          incrementDomainFieldYield(evidenceDomain, field);
          if (passTarget > 0) {
            bucket.publish_gated_fields.add(field);
          }
        }
      }
    }
  } else {
    notes.push('select_product_for_evidence_contribution_metrics');
  }

  const nowMs = Date.now();
  const rows = [...buckets.values()].map((bucket) => {
    const durations = [...bucket.fetch_durations].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const avgFetch = durations.length > 0
      ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
      : 0;
    const cooldownSeconds = cooldownSecondsRemaining(bucket.next_retry_at, nowMs);
    const hostBudget = resolveHostBudget(bucket, cooldownSeconds);
    return {
      domain: bucket.domain,
      site_kind: bucket.site_kind,
      candidates_checked: bucket.candidates_checked_urls.size,
      urls_selected: bucket.urls_selected_urls.size,
      pages_fetched_ok: bucket.fetched_ok_urls.size,
      pages_indexed: bucket.indexed_urls.size,
      dedupe_hits: bucket.dedupe_hits,
      err_404: bucket.err_404,
      repeat_404_urls: countMapValuesAbove(bucket.err_404_by_url, 1),
      blocked_count: bucket.blocked_count,
      repeat_blocked_urls: countMapValuesAbove(bucket.blocked_by_url, 1),
      parse_fail_count: bucket.parse_fail_count,
      avg_fetch_ms: Number(avgFetch.toFixed(2)),
      p95_fetch_ms: Number(percentileFromSorted(durations, 0.95).toFixed(2)),
      evidence_hits: bucket.evidence_hits,
      evidence_used: bucket.evidence_used,
      fields_covered: bucket.fields_covered.size,
      status: resolveDomainChecklistStatus(bucket),
      host_budget_score: hostBudget.score,
      host_budget_state: hostBudget.state,
      cooldown_seconds_remaining: cooldownSeconds,
      outcome_counts: { ...bucket.outcome_counts },
      last_success_at: bucket.last_success_at || null,
      next_retry_at: bucket.next_retry_at || null,
      url_count: bucket.url_stats.size,
      urls: includeUrls
        ? [...bucket.url_stats.values()]
          .map((urlRow) => ({
            url: urlRow.url,
            checked_count: urlRow.checked_count,
            selected_count: urlRow.selected_count,
            fetch_started_count: urlRow.fetch_started_count,
            processed_count: urlRow.processed_count,
            fetched_ok: urlRow.fetched_ok,
            indexed: urlRow.indexed,
            err_404_count: urlRow.err_404_count,
            blocked_count: urlRow.blocked_count,
            parse_fail_count: urlRow.parse_fail_count,
            last_outcome: urlRow.last_outcome || null,
            last_status: urlRow.last_status || null,
            last_event: urlRow.last_event || null,
            last_ts: urlRow.last_ts || null
          }))
          .sort((a, b) => {
            const riskA = (a.err_404_count * 5) + (a.blocked_count * 5) + (a.parse_fail_count * 2);
            const riskB = (b.err_404_count * 5) + (b.blocked_count * 5) + (b.parse_fail_count * 2);
            if (riskB !== riskA) return riskB - riskA;
            const tsA = parseTsMs(a.last_ts || '');
            const tsB = parseTsMs(b.last_ts || '');
            if (Number.isFinite(tsA) && Number.isFinite(tsB) && tsB !== tsA) return tsB - tsA;
            return String(a.url || '').localeCompare(String(b.url || ''));
          })
        : []
    };
  }).sort((a, b) => {
    const kindRank = (SITE_KIND_RANK[a.site_kind] ?? 99) - (SITE_KIND_RANK[b.site_kind] ?? 99);
    if (kindRank !== 0) return kindRank;
    if (b.evidence_used !== a.evidence_used) return b.evidence_used - a.evidence_used;
    if (b.pages_fetched_ok !== a.pages_fetched_ok) return b.pages_fetched_ok - a.pages_fetched_ok;
    if (b.urls_selected !== a.urls_selected) return b.urls_selected - a.urls_selected;
    return a.domain.localeCompare(b.domain);
  });

  const bucketByDomain = new Map([...buckets.entries()]);
  const topDomains = [...rows]
    .sort((a, b) => {
      const scoreA = (a.pages_fetched_ok * 3) + (a.pages_indexed * 2) + a.urls_selected;
      const scoreB = (b.pages_fetched_ok * 3) + (b.pages_indexed * 2) + b.urls_selected;
      if (scoreB !== scoreA) return scoreB - scoreA;
      return a.domain.localeCompare(b.domain);
    });

  const manufacturerRow = rows.find((row) => row.site_kind === 'manufacturer') || null;
  const primaryDomainList = [];
  if (manufacturerRow) primaryDomainList.push(manufacturerRow.domain);
  for (const row of topDomains) {
    if (primaryDomainList.includes(row.domain)) continue;
    primaryDomainList.push(row.domain);
    if (primaryDomainList.length >= 3) break;
  }

  const buildMilestonesForBucket = (bucket) => {
    if (!bucket) {
      return {
        product_page_found: false,
        support_page_found: false,
        manual_pdf_found: false,
        spec_table_extracted: false,
        firmware_driver_found: false,
        publish_gated_fields_supported: false
      };
    }
    const urls = [...bucket.seen_urls];
    const hasPathMatch = (pattern) => urls.some((url) => pattern.test(urlPathToken(url)));
    return {
      product_page_found: hasPathMatch(/\/(product|products|gaming-mice|mice|mouse)\b/),
      support_page_found: hasPathMatch(/(support|help|faq|kb|docs?|manual|download)/),
      manual_pdf_found: hasPathMatch(/(manual|datasheet|user[-_ ]guide|owner[-_ ]manual|\.pdf($|\?))/),
      spec_table_extracted: bucket.indexed_urls.size > 0 || bucket.fields_filled_count > 0,
      firmware_driver_found: hasPathMatch(/(firmware|driver|software|download)/),
      publish_gated_fields_supported: bucket.publish_gated_fields.size > 0
    };
  };

  const primaryDomainMilestones = primaryDomainList.map((domain) => {
    const bucket = bucketByDomain.get(domain);
    const milestones = buildMilestonesForBucket(bucket);
    return {
      domain,
      site_kind: bucket?.site_kind || inferSiteKindByDomain(domain),
      ...milestones
    };
  });

  const manufacturerDomain = manufacturerRow?.domain || null;
  const manufacturerMilestones = manufacturerDomain
    ? primaryDomainMilestones.find((row) => row.domain === manufacturerDomain) || null
    : null;

  const domainFieldYieldRows = [...domainFieldYield.entries()]
    .map(([key, count]) => {
      const [domain, field] = key.split('|');
      return {
        domain,
        field,
        evidence_used_count: count
      };
    })
    .sort((a, b) => b.evidence_used_count - a.evidence_used_count || a.domain.localeCompare(b.domain) || a.field.localeCompare(b.field))
    .slice(0, 120);
  repairQueryRows.sort((a, b) => parseTsMs(String(b.ts || '')) - parseTsMs(String(a.ts || '')));
  const badUrlPatternRows = [...badUrlPatterns.values()]
    .sort((a, b) => b.count - a.count || parseTsMs(b.last_ts) - parseTsMs(a.last_ts) || a.domain.localeCompare(b.domain))
    .slice(0, 120);

  if (!manufacturerDomain) {
    notes.push('no_manufacturer_domain_detected_for_scope');
  }
  if (rows.some((row) => String(row.status || '').startsWith('dead'))) {
    notes.push('dead_status_is_url_level_not_domain_outage');
  }

  return {
    category: normalizedCategory,
    productId: resolvedProductId || null,
    runId: resolvedRunId || null,
    window_minutes: Math.max(5, toInt(windowMinutes, 120)),
    generated_at: new Date().toISOString(),
    rows,
    milestones: {
      manufacturer_domain: manufacturerDomain,
      manufacturer: manufacturerMilestones,
      primary_domains: primaryDomainMilestones
    },
    domain_field_yield: domainFieldYieldRows,
    repair_queries: repairQueryRows,
    bad_url_patterns: badUrlPatternRows,
    notes
  };
}

function mimeType(ext) {
  const map = {
    '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  };
  return map[ext] || 'application/octet-stream';
}

// â”€â”€ Catalog helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function cleanVariant(v) {
  return canonicalCleanVariant(v);
}

function normText(v) {
  return String(v ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function catalogKey(brand, model, variant) {
  return `${normText(brand)}|${normText(model)}|${normText(cleanVariant(variant))}`;
}

function slugify(value) {
  return canonicalSlugify(value);
}

function buildProductIdFromParts(category, brand, model, variant) {
  return [slugify(category), slugify(brand), slugify(model), slugify(cleanVariant(variant))]
    .filter(Boolean)
    .join('-');
}


// â”€â”€ Args â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const args = process.argv.slice(2);
function argVal(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const PORT = toInt(argVal('port', '8788'), 8788);
const isLocal = args.includes('--local');

// â”€â”€ Config + Storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
loadDotEnvFile();
const config = loadConfig({ localMode: isLocal || true, outputMode: 'local' });
const storage = createStorage(config);
const OUTPUT_ROOT = path.resolve(config.localOutputRoot || 'out');
const HELPER_ROOT = path.resolve(config.helperFilesRoot || 'helper_files');
const INDEXLAB_ROOT = path.resolve(argVal('indexlab-root', 'artifacts/indexlab'));

function normalizeCategoryToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+$/g, '');
}

function categoryExists(category) {
  if (!category) return false;
  const categoryPath = path.join(HELPER_ROOT, category);
  return fsSync.existsSync(categoryPath);
}

function resolveCategoryAlias(category) {
  const normalized = normalizeCategoryToken(category);
  if (!normalized) return normalized;
  if (normalized.startsWith('_test_')) return normalized;
  if (!normalized.startsWith('test_')) return normalized;

  if (categoryExists(normalized)) return normalized;
  const canonicalTestCategory = `_${normalized}`;
  if (categoryExists(canonicalTestCategory)) return canonicalTestCategory;
  return normalized;
}

// â”€â”€ Lazy SpecDb Cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const specDbCache = new Map();
const specDbSeedPromises = new Map();
const reviewLayoutByCategory = new Map();

function getSpecDb(category) {
  const resolvedCategory = resolveCategoryAlias(category);
  if (!resolvedCategory) return null;
  if (specDbCache.has(resolvedCategory)) return specDbCache.get(resolvedCategory);

  // Strict ID-driven runtime: use only the category-local SpecDb.
  const primaryPath = path.join('.specfactory_tmp', resolvedCategory, 'spec.sqlite');

  try {
    fsSync.accessSync(primaryPath);
    const db = new SpecDb({ dbPath: primaryPath, category: resolvedCategory });
    // Check if this DB actually has seeded data
    if (db.isSeeded()) {
      specDbCache.set(resolvedCategory, db);
      return db;
    }
    // DB exists but is not seeded yet - trigger background seed and return it
    specDbCache.set(resolvedCategory, db);
    triggerAutoSeed(resolvedCategory, db);
    return db;
  } catch { /* create */ }

  // No DB found - create at the primary path and trigger seed
  try {
    fsSync.mkdirSync(path.dirname(primaryPath), { recursive: true });
    const db = new SpecDb({ dbPath: primaryPath, category: resolvedCategory });
    specDbCache.set(resolvedCategory, db);
    triggerAutoSeed(resolvedCategory, db);
    return db;
  } catch {
    specDbCache.set(resolvedCategory, null);
    return null;
  }
}

/** Background auto-seed: loads field rules and seeds the SpecDb */
function triggerAutoSeed(category, db) {
  const resolvedCategory = resolveCategoryAlias(category);
  if (!resolvedCategory) return;
  if (specDbSeedPromises.has(resolvedCategory)) return;
  const promise = (async () => {
    try {
      const { loadFieldRules } = await import('../field-rules/loader.js');
      const { seedSpecDb } = await import('../db/seed.js');
      const fieldRules = await loadFieldRules(resolvedCategory, { config });
      const result = await seedSpecDb({ db, config, category: resolvedCategory, fieldRules });
      console.log(`[auto-seed] ${resolvedCategory}: ${result.components_seeded} components, ${result.list_values_seeded} list values, ${result.products_seeded} products (${result.duration_ms}ms)`);
    } catch (err) {
      console.error(`[auto-seed] ${resolvedCategory} failed:`, err.message);
    } finally {
      specDbSeedPromises.delete(resolvedCategory);
    }
  })();
  specDbSeedPromises.set(resolvedCategory, promise);
}

async function getSpecDbReady(category) {
  const resolvedCategory = resolveCategoryAlias(category);
  const db = getSpecDb(resolvedCategory);
  if (!db) return null;
  const pending = specDbSeedPromises.get(resolvedCategory);
  if (pending) {
    try {
      await pending;
    } catch {
      // keep best available DB handle; caller validates seeded content.
    }
  }
  return getSpecDb(resolvedCategory);
}

function ensureGridKeyReviewState(specDb, category, productId, fieldKey, itemFieldStateId = null) {
  if (!specDb || !productId || !fieldKey) return null;
  try {
    const existing = specDb.getKeyReviewState({
      category,
      targetKind: 'grid_key',
      itemIdentifier: productId,
      fieldKey,
      itemFieldStateId,
    });
    if (existing) return existing;

    const ifs = itemFieldStateId
      ? specDb.getItemFieldStateById(itemFieldStateId)
      : specDb.db.prepare(
        'SELECT * FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ? LIMIT 1'
      ).get(category, productId, fieldKey);
    if (!ifs) return null;

    let aiConfirmPrimaryStatus = null;
    if (ifs.needs_ai_review && !ifs.ai_review_complete) aiConfirmPrimaryStatus = 'pending';
    else if (ifs.ai_review_complete) aiConfirmPrimaryStatus = 'confirmed';

    const userAcceptPrimaryStatus = ifs.overridden ? 'accepted' : null;

    const id = specDb.upsertKeyReviewState({
      category,
      targetKind: 'grid_key',
      itemIdentifier: productId,
      fieldKey,
      itemFieldStateId: ifs.id ?? itemFieldStateId ?? null,
      selectedValue: ifs.value ?? null,
      selectedCandidateId: ifs.accepted_candidate_id ?? null,
      confidenceScore: ifs.confidence ?? 0,
      aiConfirmPrimaryStatus,
      userAcceptPrimaryStatus,
    });
    return specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(id) || null;
  } catch {
    return null;
  }
}

function resolveKeyReviewForLaneMutation(specDb, category, body) {
  if (!specDb) {
    return {
      stateRow: null,
      error: 'specdb_not_ready',
      errorMessage: 'SpecDb is not available for this category.',
    };
  }
  const idReq = resolveExplicitPositiveId(body, ['id']);
  if (idReq.provided) {
    const byId = idReq.id ? specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(idReq.id) : null;
    if (byId) return { stateRow: byId, error: null };
    return {
      stateRow: null,
      error: 'key_review_state_id_not_found',
      errorMessage: `key_review_state id '${idReq.raw}' was not found.`,
    };
  }
  const fieldStateCtx = resolveGridFieldStateForMutation(specDb, category, body);
  if (fieldStateCtx?.error) {
    if (fieldStateCtx.error === 'item_field_state_id_required') {
      return {
        stateRow: null,
        error: 'id_or_item_field_state_id_required',
        errorMessage: 'Provide key_review_state id or itemFieldStateId for this lane mutation.',
      };
    }
    return {
      stateRow: null,
      error: fieldStateCtx.error,
      errorMessage: fieldStateCtx.errorMessage,
    };
  }
  const fieldStateRow = fieldStateCtx?.row;
  if (!fieldStateRow) return { stateRow: null, error: null };
  const productId = String(fieldStateRow.product_id || '').trim();
  const fieldKey = String(fieldStateRow.field_key || '').trim();
  if (!productId || !fieldKey) return { stateRow: null, error: null };
  return {
    stateRow: ensureGridKeyReviewState(specDb, category, productId, fieldKey, fieldStateRow.id),
    error: null,
  };
}

function markPrimaryLaneReviewedInItemState(specDb, category, keyReviewState) {
  if (!specDb || !keyReviewState) return;
  if (keyReviewState.target_kind !== 'grid_key') return;
  if (!keyReviewState.item_identifier || !keyReviewState.field_key) return;
  try {
    specDb.db.prepare(
      `UPDATE item_field_state
       SET needs_ai_review = 0,
           ai_review_complete = 1,
           updated_at = datetime('now')
       WHERE category = ? AND product_id = ? AND field_key = ?`
    ).run(category, keyReviewState.item_identifier, keyReviewState.field_key);
  } catch { /* best-effort sync */ }
}

function syncItemFieldStateFromPrimaryLaneAccept(specDb, category, keyReviewState) {
  if (!specDb || !keyReviewState) return;
  if (keyReviewState.target_kind !== 'grid_key') return;
  const productId = String(keyReviewState.item_identifier || '').trim();
  const fieldKey = String(keyReviewState.field_key || '').trim();
  if (!productId || !fieldKey) return;

  const current = specDb.db.prepare(
    'SELECT * FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ?'
  ).get(category, productId, fieldKey) || null;
  const selectedCandidateId = String(keyReviewState.selected_candidate_id || '').trim() || null;
  const candidateRow = selectedCandidateId ? specDb.getCandidateById(selectedCandidateId) : null;
  const selectedValue = candidateRow?.value ?? keyReviewState.selected_value ?? current?.value ?? null;
  if (!isMeaningfulValue(selectedValue) && !current) return;

  const confidenceScore = Number.isFinite(Number(candidateRow?.score))
    ? Number(candidateRow.score)
    : (Number.isFinite(Number(keyReviewState.confidence_score))
      ? Number(keyReviewState.confidence_score)
      : Number(current?.confidence || 0));
  const aiStatus = String(keyReviewState?.ai_confirm_primary_status || '').trim().toLowerCase();
  const aiConfirmed = aiStatus === 'confirmed';
  const source = candidateRow
    ? 'pipeline'
    : (String(current?.source || '').trim() || 'pipeline');

  specDb.upsertItemFieldState({
    productId,
    fieldKey,
    value: selectedValue,
    confidence: confidenceScore,
    source,
    acceptedCandidateId: selectedCandidateId || current?.accepted_candidate_id || null,
    overridden: false,
    needsAiReview: !aiConfirmed,
    aiReviewComplete: aiConfirmed,
  });
  try {
    specDb.syncItemListLinkForFieldValue({
      productId,
      fieldKey,
      value: selectedValue,
    });
  } catch { /* best-effort list-link sync */ }
}

function syncPrimaryLaneAcceptFromItemSelection({
  specDb,
  category,
  productId,
  fieldKey,
  selectedCandidateId = null,
  selectedValue = null,
  confidenceScore = null,
  reason = null,
}) {
  if (!specDb) return null;
  const state = ensureGridKeyReviewState(specDb, category, productId, fieldKey);
  if (!state) return null;

  const scoreValue = Number.isFinite(Number(confidenceScore))
    ? Number(confidenceScore)
    : null;
  specDb.db.prepare(`
    UPDATE key_review_state
    SET selected_candidate_id = ?,
        selected_value = ?,
        confidence_score = COALESCE(?, confidence_score),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    selectedCandidateId,
    selectedValue,
    scoreValue,
    state.id
  );

  const at = new Date().toISOString();
  specDb.updateKeyReviewUserAccept({ id: state.id, lane: 'primary', status: 'accepted', at });
  specDb.insertKeyReviewAudit({
    keyReviewStateId: state.id,
    eventType: 'user_accept',
    actorType: 'user',
    actorId: null,
    oldValue: state.user_accept_primary_status || null,
    newValue: 'accepted',
    reason: reason || 'User accepted item value via override',
  });

  return specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(state.id) || null;
}

function deleteKeyReviewStateRows(specDb, stateIds = []) {
  if (!specDb || !Array.isArray(stateIds) || stateIds.length === 0) return 0;
  const ids = stateIds
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (ids.length === 0) return 0;

  const tx = specDb.db.transaction((rows) => {
    for (const id of rows) {
      specDb.db.prepare(`
        DELETE FROM key_review_run_sources
        WHERE key_review_run_id IN (
          SELECT run_id FROM key_review_runs WHERE key_review_state_id = ?
        )
      `).run(id);
      specDb.db.prepare('DELETE FROM key_review_runs WHERE key_review_state_id = ?').run(id);
      specDb.db.prepare('DELETE FROM key_review_audit WHERE key_review_state_id = ?').run(id);
      specDb.db.prepare('DELETE FROM key_review_state WHERE id = ?').run(id);
    }
  });
  tx(ids);
  return ids.length;
}

function resetTestModeSharedReviewState(specDb, category) {
  if (!specDb || !category) return 0;
  const ids = specDb.db.prepare(`
    SELECT id
    FROM key_review_state
    WHERE category = ?
      AND target_kind IN ('component_key', 'enum_key')
  `).all(category).map((row) => row.id);
  return deleteKeyReviewStateRows(specDb, ids);
}

function resetTestModeProductReviewState(specDb, category, productId) {
  const pid = String(productId || '').trim();
  if (!specDb || !category || !pid) return {
    clearedCandidates: 0,
    clearedKeyReview: 0,
    clearedFieldState: 0,
    clearedLinks: 0,
    clearedSources: 0,
  };

  const stateIds = specDb.db.prepare(`
    SELECT id
    FROM key_review_state
    WHERE category = ?
      AND target_kind = 'grid_key'
      AND item_identifier = ?
  `).all(category, pid).map((row) => row.id);
  const clearedKeyReview = deleteKeyReviewStateRows(specDb, stateIds);

  let deletedCandidates = 0;
  let deletedFieldState = 0;
  let deletedLinks = 0;
  let deletedSources = 0;
  const tx = specDb.db.transaction(() => {
    const itemFieldStateIds = specDb.db.prepare(`
      SELECT id
      FROM item_field_state
      WHERE category = ? AND product_id = ?
    `).all(category, pid).map((row) => row.id);
    const sourceIds = specDb.db.prepare(`
      SELECT source_id
      FROM source_registry
      WHERE category = ? AND product_id = ?
    `).all(category, pid).map((row) => row.source_id);

    if (itemFieldStateIds.length > 0) {
      const placeholders = itemFieldStateIds.map(() => '?').join(',');
      specDb.db.prepare(`
        DELETE FROM source_evidence_refs
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE item_field_state_id IN (${placeholders})
        )
      `).run(...itemFieldStateIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_assertions
        WHERE item_field_state_id IN (${placeholders})
      `).run(...itemFieldStateIds).changes;
    }

    if (sourceIds.length > 0) {
      const placeholders = sourceIds.map(() => '?').join(',');
      specDb.db.prepare(`
        DELETE FROM source_evidence_refs
        WHERE assertion_id IN (
          SELECT assertion_id
          FROM source_assertions
          WHERE source_id IN (${placeholders})
        )
      `).run(...sourceIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_assertions
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
      specDb.db.prepare(`
        DELETE FROM source_artifacts
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds);
      deletedSources += specDb.db.prepare(`
        DELETE FROM source_registry
        WHERE source_id IN (${placeholders})
      `).run(...sourceIds).changes;
    }

    specDb.db.prepare(`
      DELETE FROM candidate_reviews
      WHERE context_type = 'item'
        AND context_id = ?
    `).run(pid);
    specDb.db.prepare(`
      DELETE FROM candidate_reviews
      WHERE candidate_id IN (
        SELECT candidate_id
        FROM candidates
        WHERE category = ? AND product_id = ?
      )
    `).run(category, pid);

    deletedLinks += specDb.db.prepare(`
      DELETE FROM item_component_links
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;
    deletedLinks += specDb.db.prepare(`
      DELETE FROM item_list_links
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;
    deletedFieldState = specDb.db.prepare(`
      DELETE FROM item_field_state
      WHERE category = ? AND product_id = ?
    `).run(category, pid).changes;

    deletedCandidates = specDb.db
      .prepare('DELETE FROM candidates WHERE category = ? AND product_id = ?')
      .run(category, pid).changes;
  });
  tx();

  return {
    clearedCandidates: deletedCandidates,
    clearedKeyReview,
    clearedFieldState: deletedFieldState,
    clearedLinks: deletedLinks,
    clearedSources: deletedSources,
  };
}

function normalizeLower(value) {
  return String(value ?? '').trim().toLowerCase();
}

const UNKNOWN_LIKE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'null', 'undefined', '-']);

function isMeaningfulValue(value) {
  return !UNKNOWN_LIKE_TOKENS.has(normalizeLower(value));
}

function candidateLooksWorkbook(candidateId, sourceToken = '') {
  const token = String(sourceToken || '').trim().toLowerCase();
  const cid = String(candidateId || '').trim();
  return cid.startsWith('wb_')
    || cid.startsWith('wb-')
    || cid.includes('::wb_')
    || cid.includes('::wb-')
    || token.includes('workbook')
    || token.includes('excel');
}

function extractComparableValueTokens(rawValue) {
  if (Array.isArray(rawValue)) {
    const nested = [];
    for (const entry of rawValue) {
      nested.push(...extractComparableValueTokens(entry));
    }
    return [...new Set(nested)];
  }
  const text = String(rawValue ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => String(part ?? '').trim()).filter(Boolean)
    : [text];
  return [...new Set(parts.map((part) => normalizeLower(part)).filter(Boolean))];
}

function splitCandidateParts(rawValue) {
  if (Array.isArray(rawValue)) {
    const nested = rawValue.flatMap((entry) => splitCandidateParts(entry));
    return [...new Set(nested)];
  }
  const text = String(rawValue ?? '').trim();
  if (!text) return [];
  const parts = text.includes(',')
    ? text.split(',').map((part) => String(part ?? '').trim()).filter(Boolean)
    : [text];
  return [...new Set(parts)];
}

async function getReviewFieldRow(category, fieldKey) {
  const cached = reviewLayoutByCategory.get(category);
  if (cached?.rowsByKey && (Date.now() - (cached.loadedAt || 0) < 15_000)) {
    return cached.rowsByKey.get(fieldKey) || null;
  }
  try {
    const layout = await buildReviewLayout({ storage, config, category });
    const rowsByKey = new Map((layout.rows || []).map((row) => [String(row.key || ''), row]));
    reviewLayoutByCategory.set(category, { rowsByKey, loadedAt: Date.now() });
    return rowsByKey.get(fieldKey) || null;
  } catch {
    return null;
  }
}

function candidateMatchesReviewItemValue(reviewItem, candidateNorm) {
  if (!candidateNorm) return false;
  const direct = normalizeLower(reviewItem?.matched_component || reviewItem?.raw_query || '');
  if (direct && direct === candidateNorm) return true;
  const attrs = parseReviewItemAttributes(reviewItem);
  return Object.values(attrs).some((attrValue) => (
    extractComparableValueTokens(attrValue).includes(candidateNorm)
  ));
}

function parseReviewItemAttributes(reviewItem) {
  const raw = reviewItem?.product_attributes;
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function makerTokensFromReviewItem(reviewItem, componentType) {
  const attrs = parseReviewItemAttributes(reviewItem);
  const fieldKey = String(reviewItem?.field_key || '').trim();
  const keys = [
    `${componentType}_brand`,
    `${componentType}_maker`,
    fieldKey ? `${fieldKey}_brand` : '',
    fieldKey ? `${fieldKey}_maker` : '',
    'brand',
    'maker',
  ].filter(Boolean);
  const tokens = [];
  for (const key of keys) {
    for (const valuePart of splitCandidateParts(attrs[key])) {
      if (!isMeaningfulValue(valuePart)) continue;
      tokens.push(normalizeLower(valuePart));
    }
  }
  for (const valuePart of splitCandidateParts(reviewItem?.ai_suggested_maker)) {
    if (!isMeaningfulValue(valuePart)) continue;
    tokens.push(normalizeLower(valuePart));
  }
  return [...new Set(tokens)];
}

function reviewItemMatchesMakerLane(reviewItem, { componentType, componentMaker }) {
  const laneMaker = normalizeLower(componentMaker || '');
  const makerTokens = makerTokensFromReviewItem(reviewItem, componentType);
  if (!laneMaker) return makerTokens.length === 0;
  if (!makerTokens.length) return false;
  return makerTokens.includes(laneMaker);
}

function isResolvedCandidateReview(
  reviewRow,
  {
    includeHumanAccepted = true,
    treatSharedAcceptAsPending = false,
  } = {},
) {
  if (!reviewRow) return false;
  const aiStatus = normalizeLower(reviewRow.ai_review_status || '');
  const aiReason = normalizeLower(reviewRow.ai_reason || '');
  if (aiStatus === 'rejected') return true;
  if (aiStatus === 'accepted') {
    if (treatSharedAcceptAsPending && aiReason === 'shared_accept') {
      return false;
    }
    return true;
  }
  if (includeHumanAccepted && Number(reviewRow.human_accepted) === 1) {
    return true;
  }
  return false;
}

function buildCandidateReviewLookup(reviewRows) {
  const exact = new Map();
  for (const row of Array.isArray(reviewRows) ? reviewRows : []) {
    const cid = String(row?.candidate_id || '').trim();
    if (!cid) continue;
    exact.set(cid, row);
  }
  return { exact };
}

function getReviewForCandidateId(lookup, candidateId) {
  if (!lookup) return null;
  const cid = String(candidateId || '').trim();
  if (!cid) return null;
  if (lookup.exact.has(cid)) return lookup.exact.get(cid) || null;
  return null;
}

function collectPendingCandidateIds({
  candidateRows,
  reviewLookup = null,
  includeHumanAccepted = true,
  treatSharedAcceptAsPending = false,
}) {
  const actionableIds = [];
  const seen = new Set();
  for (const row of Array.isArray(candidateRows) ? candidateRows : []) {
    const cid = String(row?.candidate_id || '').trim();
    if (!cid || seen.has(cid)) continue;
    const rowValue = row?.value;
    if (!isMeaningfulValue(rowValue)) continue;
    seen.add(cid);
    actionableIds.push(cid);
  }
  const pending = [];
  for (const cid of actionableIds) {
    const reviewRow = getReviewForCandidateId(reviewLookup, cid);
    if (!isResolvedCandidateReview(reviewRow, {
      includeHumanAccepted,
      treatSharedAcceptAsPending,
    })) {
      pending.push(cid);
    }
  }
  return pending;
}

async function collectComponentReviewPropertyCandidateRows({
  category,
  componentType,
  componentName,
  componentMaker,
  propertyKey,
}) {
  const normalizedComponentName = normalizeLower(componentName);
  const normalizedPropertyKey = String(propertyKey || '').trim();
  if (!category || !componentType || !normalizedComponentName || !normalizedPropertyKey) return [];
  if (normalizedPropertyKey.startsWith('__')) return [];
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return [];

  const rows = [];
  const seen = new Set();
  for (const item of items) {
    const status = normalizeLower(item?.status || '');
    if (status === 'dismissed' || status === 'ignored' || status === 'rejected') continue;
    if (String(item?.component_type || '').trim() !== String(componentType || '').trim()) continue;

    const matchedName = normalizeLower(item?.matched_component || '');
    const rawName = normalizeLower(item?.raw_query || '');
    const isSameComponent = matchedName
      ? matchedName === normalizedComponentName
      : rawName === normalizedComponentName;
    if (!isSameComponent) continue;
    if (!reviewItemMatchesMakerLane(item, { componentType, componentMaker })) continue;

    const attrs = parseReviewItemAttributes(item);
    const matchedEntry = Object.entries(attrs).find(([attrKey]) => (
      normalizeLower(attrKey) === normalizeLower(normalizedPropertyKey)
    ));
    if (!matchedEntry) continue;
    const [, attrValue] = matchedEntry;
    for (const valuePart of splitCandidateParts(attrValue)) {
      if (!isMeaningfulValue(valuePart)) continue;
      const candidateId = buildComponentReviewSyntheticCandidateId({
        productId: String(item?.product_id || '').trim(),
        fieldKey: normalizedPropertyKey,
        reviewId: String(item?.review_id || '').trim() || null,
        value: valuePart,
      });
      const cid = String(candidateId || '').trim();
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      rows.push({ candidate_id: cid, value: valuePart });
    }
  }
  return rows;
}

function normalizeCandidatePrimaryReviewStatus(candidate, reviewRow = null) {
  if (candidate?.is_synthetic_selected) return 'accepted';
  if (reviewRow) {
    if (Number(reviewRow.human_accepted) === 1) return 'accepted';
    const aiStatus = normalizeLower(reviewRow.ai_review_status || '');
    if (aiStatus === 'accepted') return 'accepted';
    if (aiStatus === 'rejected') return 'rejected';
    return 'pending';
  }
  const sourceToken = normalizeLower(candidate?.source_id || candidate?.source || '');
  const methodToken = normalizeLower(candidate?.method || candidate?.source_method || '');
  if (
    sourceToken === 'workbook'
    || sourceToken === 'component_db'
    || sourceToken === 'known_values'
    || sourceToken === 'user'
    || sourceToken === 'manual'
    || methodToken.includes('workbook')
    || methodToken.includes('manual')
  ) {
    return 'accepted';
  }
  return 'pending';
}

function annotateCandidatePrimaryReviews(candidates, reviewRows = []) {
  const lookup = buildCandidateReviewLookup(reviewRows);
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidateId = String(candidate?.candidate_id || '').trim();
    const reviewRow = candidateId ? getReviewForCandidateId(lookup, candidateId) : null;
    candidate.primary_review_status = normalizeCandidatePrimaryReviewStatus(candidate, reviewRow);
    candidate.human_accepted = Number(reviewRow?.human_accepted || 0) === 1;
  }
}

function getPendingItemPrimaryCandidateIds(specDb, {
  productId,
  fieldKey,
  itemFieldStateId,
}) {
  if (!specDb || !productId || !fieldKey || !itemFieldStateId) return [];
  const candidatesByField = specDb.getCandidatesForProduct(productId) || {};
  const candidateRows = candidatesByField[fieldKey] || [];
  const reviewRows = specDb.getReviewsForContext('item', String(itemFieldStateId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  return collectPendingCandidateIds({
    candidateRows,
    reviewLookup,
  });
}

function getPendingComponentSharedCandidateIds(specDb, {
  componentType,
  componentName,
  componentMaker,
  propertyKey,
  componentValueId,
}) {
  if (!specDb || !componentValueId || !propertyKey) return [];
  const candidateRows = specDb.getCandidatesForComponentProperty(
    componentType,
    componentName,
    componentMaker || '',
    propertyKey,
  ) || [];
  const reviewRows = specDb.getReviewsForContext('component', String(componentValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  // Include synthetic pipeline review candidates derived from component_review queue
  // so lane status remains pending until all candidate-level confirmations are resolved.
  return collectPendingCandidateIds({
    candidateRows: candidateRows,
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

async function getPendingComponentSharedCandidateIdsAsync(specDb, {
  category,
  componentType,
  componentName,
  componentMaker,
  propertyKey,
  componentValueId,
}) {
  if (!specDb || !componentValueId || !propertyKey) return [];
  const candidateRows = specDb.getCandidatesForComponentProperty(
    componentType,
    componentName,
    componentMaker || '',
    propertyKey,
  ) || [];
  const reviewRows = specDb.getReviewsForContext('component', String(componentValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  const syntheticRows = await collectComponentReviewPropertyCandidateRows({
    category,
    componentType,
    componentName,
    componentMaker,
    propertyKey,
  });
  return collectPendingCandidateIds({
    candidateRows: [...candidateRows, ...syntheticRows],
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

function getPendingEnumSharedCandidateIds(specDb, {
  fieldKey,
  listValueId,
}) {
  if (!specDb || !fieldKey || !listValueId) return [];
  const candidateRows = specDb.getCandidatesByListValue(fieldKey, listValueId) || [];
  const reviewRows = specDb.getReviewsForContext('list', String(listValueId)) || [];
  const reviewLookup = buildCandidateReviewLookup(reviewRows);
  return collectPendingCandidateIds({
    candidateRows,
    reviewLookup,
    includeHumanAccepted: false,
    treatSharedAcceptAsPending: true,
  });
}

async function syncSyntheticCandidatesFromComponentReview({ category, specDb }) {
  if (!specDb) return { upserted: 0 };
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return { upserted: 0 };

  let upserted = 0;
  let assertionsUpserted = 0;
  const sourceIds = new Set();
  const nowIso = new Date().toISOString();
  const categoryToken = String(specDb.category || category || '').trim();
  const selectItemFieldSlotId = specDb.db.prepare(
    'SELECT id FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ? LIMIT 1'
  );
  const selectEvidenceRef = specDb.db.prepare(
    'SELECT 1 FROM source_evidence_refs WHERE assertion_id = ? LIMIT 1'
  );
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    if (status === 'dismissed') continue;
    const productId = String(item?.product_id || '').trim();
    const fieldKey = String(item?.field_key || '').trim();
    if (!productId || !fieldKey) continue;
    const runToken = normalizePathToken(item?.run_id || 'component-review', 'component-review');
    const reviewToken = normalizePathToken(item?.review_id || 'pending', 'pending');
    const sourceId = `${categoryToken}::${productId}::pipeline::${runToken}::${reviewToken}`;
    const sourceUrl = `pipeline://component-review/${reviewToken}`;
    specDb.upsertSourceRegistry({
      sourceId,
      category: categoryToken,
      itemIdentifier: productId,
      productId,
      runId: item?.run_id || null,
      sourceUrl,
      sourceHost: 'pipeline',
      sourceRootDomain: 'pipeline',
      sourceTier: null,
      sourceMethod: item?.match_type || 'component_review',
      crawlStatus: 'fetched',
      httpStatus: null,
      fetchedAt: item?.created_at || nowIso,
    });
    sourceIds.add(sourceId);

    const pushCandidate = (candidateId, value, score, method, quote, snippetText, candidateFieldKey = fieldKey) => {
      const text = String(value ?? '').trim();
      if (!text || !isMeaningfulValue(text)) return;
      const resolvedFieldKey = String(candidateFieldKey || '').trim();
      if (!resolvedFieldKey) return;
      const itemFieldStateId = selectItemFieldSlotId.get(categoryToken, productId, resolvedFieldKey)?.id ?? null;
      const normalizedText = normalizeLower(text);
      specDb.insertCandidate({
        candidate_id: candidateId,
        product_id: productId,
        field_key: resolvedFieldKey,
        value: text,
        normalized_value: normalizedText,
        score: Number.isFinite(Number(score)) ? Number(score) : 0.5,
        rank: 1,
        source_url: sourceUrl,
        source_host: 'pipeline',
        source_root_domain: 'pipeline',
        source_tier: null,
        source_method: method,
        approved_domain: 0,
        snippet_id: String(item.review_id || ''),
        snippet_hash: '',
        snippet_text: snippetText || '',
        quote: quote || '',
        quote_span_start: null,
        quote_span_end: null,
        evidence_url: '',
        evidence_retrieved_at: item.created_at || null,
        is_component_field: 1,
        component_type: item.component_type || null,
        is_list_field: 0,
        llm_extract_model: null,
        extracted_at: item.created_at || nowIso,
        run_id: item.run_id || null,
      });
      upserted += 1;
      const assertionId = String(candidateId || '').trim();
      if (!assertionId) return;
      specDb.upsertSourceAssertion({
        assertionId,
        sourceId,
        fieldKey: resolvedFieldKey,
        contextKind: 'scalar',
        contextRef: itemFieldStateId ? `item_field_state:${itemFieldStateId}` : `item_field:${productId}:${resolvedFieldKey}`,
        itemFieldStateId,
        componentValueId: null,
        listValueId: null,
        enumListId: null,
        valueRaw: text,
        valueNormalized: normalizedText,
        unit: null,
        candidateId: assertionId,
        extractionMethod: method || item?.match_type || 'component_review',
      });
      assertionsUpserted += 1;
      if (!selectEvidenceRef.get(assertionId)) {
        const quoteText = String(quote || snippetText || `Pipeline component review candidate for ${fieldKey}`).trim();
        specDb.insertSourceEvidenceRef({
          assertionId,
          evidenceUrl: sourceUrl,
          snippetId: String(item.review_id || '').trim() || null,
          quote: quoteText || null,
          method: method || item?.match_type || 'component_review',
          tier: null,
          retrievedAt: item.created_at || nowIso,
        });
      }
    };

    const primaryValue = String(item?.matched_component || item?.raw_query || '').trim();
    if (primaryValue) {
      const id = buildComponentReviewSyntheticCandidateId({
        productId,
        fieldKey,
        reviewId: String(item?.review_id || '').trim() || null,
        value: primaryValue,
      });
      pushCandidate(
        id,
        primaryValue,
        item?.combined_score ?? 0.5,
        item?.match_type || 'component_review',
        item?.raw_query ? `Raw query: "${item.raw_query}"` : '',
        item?.reasoning_note || 'Pipeline component review candidate',
      );
    }

    const attrs = item?.product_attributes && typeof item.product_attributes === 'object'
      ? item.product_attributes
      : {};
    for (const [attrKeyRaw, attrValue] of Object.entries(attrs)) {
      const attrKey = String(attrKeyRaw || '').trim();
      if (!attrKey) continue;
      for (const attrText of splitCandidateParts(attrValue)) {
        if (!isMeaningfulValue(attrText)) continue;
        const id = buildComponentReviewSyntheticCandidateId({
          productId,
          fieldKey: attrKey,
          reviewId: String(item?.review_id || '').trim() || attrKey,
          value: attrText,
        });
        pushCandidate(
          id,
          attrText,
          item?.property_score ?? 0.4,
          'product_extraction',
          `Extracted attribute "${attrKey}" from product run`,
          `${attrKey}: ${attrText}`,
          attrKey,
        );
      }
    }
  }
  return { upserted, assertionsUpserted, sourcesUpserted: sourceIds.size };
}

async function markSharedReviewItemsResolved({
  category,
  fieldKey,
  productId,
  selectedValue,
  laneAction = 'accept',
  specDb = null,
}) {
  const candidateNorm = normalizeLower(selectedValue);
  if (!candidateNorm) return { changed: 0 };
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  if (!data || !Array.isArray(data.items)) return { changed: 0 };

  const now = new Date().toISOString();
  const nextStatus = laneAction === 'accept' ? 'accepted_alias' : 'confirmed_ai';
  const changedReviewIds = [];
  let changed = 0;
  for (const item of data.items) {
    if (item?.status !== 'pending_ai') continue;
    if (String(item?.product_id || '').trim() !== String(productId || '').trim()) continue;
    if (String(item?.field_key || '').trim() !== String(fieldKey || '').trim()) continue;
    if (!candidateMatchesReviewItemValue(item, candidateNorm)) continue;
    item.status = nextStatus;
    if (laneAction === 'accept') {
      item.matched_component = String(selectedValue);
    }
    item.human_reviewed_at = now;
    changedReviewIds.push(String(item.review_id || '').trim());
    changed += 1;
  }
  if (!changed) return { changed: 0 };

  data.updated_at = now;
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const runtimeSpecDb = specDb || getSpecDb(category);
  if (runtimeSpecDb) {
    try {
      for (const reviewId of changedReviewIds) {
        if (!reviewId) continue;
        if (laneAction === 'accept') {
          runtimeSpecDb.db.prepare(
            `UPDATE component_review_queue
             SET status = ?, matched_component = ?, human_reviewed_at = ?, updated_at = datetime('now')
             WHERE category = ? AND review_id = ?`
          ).run('accepted_alias', String(selectedValue), now, category, reviewId);
        } else {
          runtimeSpecDb.db.prepare(
            `UPDATE component_review_queue
             SET status = ?, human_reviewed_at = ?, updated_at = datetime('now')
             WHERE category = ? AND review_id = ?`
          ).run('confirmed_ai', now, category, reviewId);
        }
      }
    } catch { /* best-effort */ }
  }
  return { changed };
}

async function remapPendingComponentReviewItemsForNameChange({
  category,
  componentType,
  oldName,
  newName,
  specDb = null,
}) {
  const oldNorm = normalizeLower(oldName);
  const newValue = String(newName || '').trim();
  if (!oldNorm || !newValue || oldNorm === normalizeLower(newValue)) return { changed: 0 };

  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  let changed = 0;
  const changedReviewIds = [];

  if (data && Array.isArray(data.items)) {
    for (const item of data.items) {
      if (item?.status !== 'pending_ai') continue;
      if (String(item?.component_type || '').trim() !== String(componentType || '').trim()) continue;
      const matchedNorm = normalizeLower(item?.matched_component || '');
      const rawNorm = normalizeLower(item?.raw_query || '');
      const shouldRebind = matchedNorm === oldNorm || (!matchedNorm && rawNorm === oldNorm);
      if (!shouldRebind) continue;
      item.matched_component = newValue;
      changed += 1;
      changedReviewIds.push(String(item.review_id || '').trim());
    }
    if (changed > 0) {
      data.updated_at = new Date().toISOString();
      await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    }
  }

  const runtimeSpecDb = specDb || getSpecDb(category);
  if (runtimeSpecDb) {
    try {
      if (changedReviewIds.length > 0) {
        const stmt = runtimeSpecDb.db.prepare(
          `UPDATE component_review_queue
           SET matched_component = ?, updated_at = datetime('now')
           WHERE category = ? AND review_id = ?`
        );
        for (const reviewId of changedReviewIds) {
          if (!reviewId) continue;
          stmt.run(newValue, category, reviewId);
        }
      } else {
        runtimeSpecDb.db.prepare(
          `UPDATE component_review_queue
           SET matched_component = ?, updated_at = datetime('now')
           WHERE category = ?
             AND component_type = ?
             AND status = 'pending_ai'
             AND (
               LOWER(TRIM(COALESCE(matched_component, ''))) = LOWER(TRIM(?))
               OR (
                 (matched_component IS NULL OR TRIM(matched_component) = '')
                 AND LOWER(TRIM(COALESCE(raw_query, ''))) = LOWER(TRIM(?))
               )
             )`
        ).run(newValue, category, componentType, oldName, oldName);
      }
    } catch {
      // best-effort sync
    }
  }

  return { changed };
}

async function propagateSharedLaneDecision({
  category,
  specDb,
  keyReviewState,
  laneAction,
  candidateValue = null,
}) {
  if (!specDb || !keyReviewState) return { propagated: false };
  if (String(keyReviewState.target_kind || '') !== 'grid_key') return { propagated: false };
  if (laneAction !== 'accept') return { propagated: false };

  const fieldKey = String(keyReviewState.field_key || '').trim();
  const selectedValue = String(
    candidateValue ?? keyReviewState.selected_value ?? ''
  ).trim();
  if (!fieldKey || !isMeaningfulValue(selectedValue)) return { propagated: false };

  // Grid shared accepts are strictly slot-scoped: one item field slot action must never
  // mutate peer item slots, component property slots, or enum value slots.
  return { propagated: false };
}

// â”€â”€ Process Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let childProc = null;
let childLog = [];
const MAX_LOG = 2000;
let lastProcessSnapshot = {
  pid: null,
  command: null,
  startedAt: null,
  exitCode: null,
  endedAt: null
};

function isProcessRunning() {
  return Boolean(childProc && childProc.exitCode === null);
}

function processStatus() {
  const running = isProcessRunning();
  const active = running ? childProc : null;
  return {
    running,
    pid: active?.pid || lastProcessSnapshot.pid || null,
    command: active?._cmd || lastProcessSnapshot.command || null,
    startedAt: active?._startedAt || lastProcessSnapshot.startedAt || null,
    exitCode: running ? null : (lastProcessSnapshot.exitCode ?? null),
    endedAt: running ? null : (lastProcessSnapshot.endedAt || null)
  };
}

const SEARXNG_CONTAINER_NAME = 'spec-harvester-searxng';
const SEARXNG_DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const SEARXNG_COMPOSE_PATH = path.resolve('tools', 'searxng', 'docker-compose.yml');

function normalizeUrlToken(value, fallback = SEARXNG_DEFAULT_BASE_URL) {
  const raw = String(value || '').trim() || String(fallback || '').trim();
  try {
    const parsed = new URL(raw);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return String(fallback || '').trim().replace(/\/+$/, '');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function runCommandCapture(command, args = [], options = {}) {
  const timeoutMs = Math.max(1_000, Number.parseInt(String(options.timeoutMs || 20_000), 10) || 20_000);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let proc = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      proc = spawn(command, args, {
        cwd: options.cwd || path.resolve('.'),
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error || '')
      });
      return;
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      finish({
        ok: false,
        code: null,
        stdout,
        stderr: `${stderr}\ncommand_timeout`.trim(),
        error: 'command_timeout'
      });
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });
    proc.on('error', (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        code: null,
        stdout,
        stderr,
        error: error?.message || String(error || '')
      });
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      finish({
        ok: code === 0,
        code: Number.isFinite(code) ? code : null,
        stdout,
        stderr
      });
    });
  });
}

async function probeSearxngHttp(baseUrl) {
  const normalizedBase = normalizeUrlToken(baseUrl, SEARXNG_DEFAULT_BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const probe = new URL('/search', `${normalizedBase}/`);
    probe.searchParams.set('q', 'health');
    probe.searchParams.set('format', 'json');
    probe.searchParams.set('language', 'en');
    probe.searchParams.set('safesearch', '0');
    const response = await fetch(probe, { signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error?.message || String(error || '')
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getSearxngStatus() {
  const baseUrl = normalizeUrlToken(config.searxngBaseUrl || process.env.SEARXNG_BASE_URL || '', SEARXNG_DEFAULT_BASE_URL);
  const composeFileExists = fsSync.existsSync(SEARXNG_COMPOSE_PATH);
  const dockerVersion = await runCommandCapture('docker', ['--version'], { timeoutMs: 6_000 });
  const dockerAvailable = dockerVersion.ok;

  let running = false;
  let statusText = '';
  let portsText = '';
  let containerFound = false;
  let dockerPsError = '';

  if (dockerAvailable) {
    const ps = await runCommandCapture(
      'docker',
      ['ps', '-a', '--filter', `name=${SEARXNG_CONTAINER_NAME}`, '--format', '{{.Names}}\t{{.Status}}\t{{.Ports}}'],
      { timeoutMs: 10_000 }
    );
    if (ps.ok) {
      const first = String(ps.stdout || '')
        .split(/\r?\n/)
        .map((row) => row.trim())
        .find(Boolean) || '';
      if (first) {
        containerFound = true;
        const parts = first.split('\t');
        statusText = String(parts[1] || '').trim();
        portsText = String(parts[2] || '').trim();
        running = /^up\b/i.test(statusText);
      }
    } else {
      dockerPsError = String(ps.stderr || ps.error || '').trim();
    }
  }

  const httpProbe = running ? await probeSearxngHttp(baseUrl) : { ok: false, status: 0 };
  const httpReady = Boolean(httpProbe.ok);
  const canStart = dockerAvailable && composeFileExists;
  const needsStart = !running;

  let message = '';
  if (!dockerAvailable) {
    message = 'docker_not_available';
  } else if (!composeFileExists) {
    message = 'compose_file_missing';
  } else if (needsStart) {
    message = 'stopped';
  } else if (!httpReady) {
    message = 'container_running_http_unready';
  } else {
    message = 'ready';
  }

  return {
    container_name: SEARXNG_CONTAINER_NAME,
    compose_path: SEARXNG_COMPOSE_PATH,
    compose_file_exists: composeFileExists,
    base_url: baseUrl,
    docker_available: dockerAvailable,
    container_found: containerFound,
    running,
    status: statusText || (running ? 'Up' : 'Not running'),
    ports: portsText || '',
    http_ready: httpReady,
    http_status: Number(httpProbe.status || 0),
    can_start: canStart,
    needs_start: needsStart,
    message,
    docker_error: dockerPsError || undefined,
    http_error: httpProbe?.error || undefined
  };
}

async function startSearxngStack() {
  const composeFileExists = fsSync.existsSync(SEARXNG_COMPOSE_PATH);
  if (!composeFileExists) {
    return {
      ok: false,
      error: 'compose_file_missing',
      status: await getSearxngStatus()
    };
  }

  const up = await runCommandCapture(
    'docker',
    ['compose', '-f', SEARXNG_COMPOSE_PATH, 'up', '-d'],
    { timeoutMs: 60_000 }
  );
  if (!up.ok) {
    return {
      ok: false,
      error: String(up.stderr || up.error || 'docker_compose_up_failed').trim(),
      status: await getSearxngStatus()
    };
  }

  for (let i = 0; i < 10; i += 1) {
    const status = await getSearxngStatus();
    if (status.http_ready || status.running) {
      return {
        ok: true,
        started: true,
        compose_stdout: String(up.stdout || '').trim(),
        status
      };
    }
    await sleep(800);
  }

  return {
    ok: true,
    started: true,
    compose_stdout: String(up.stdout || '').trim(),
    status: await getSearxngStatus()
  };
}

function startProcess(cmd, cliArgs, envOverrides = {}) {
  if (isProcessRunning()) {
    throw new Error('process_already_running');
  }
  childLog = [];
  const runtimeEnv = {
    ...process.env,
    LOCAL_MODE: 'true'
  };
  for (const [key, value] of Object.entries(envOverrides || {})) {
    if (!key) continue;
    if (value === undefined || value === null || value === '') continue;
    runtimeEnv[String(key)] = String(value);
  }
  const child = spawn('node', [cmd, ...cliArgs], {
    cwd: path.resolve('.'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: runtimeEnv,
  });
  child._cmd = `node ${cmd} ${cliArgs.join(' ')}`;
  child._startedAt = new Date().toISOString();
  lastProcessSnapshot = {
    pid: child.pid || null,
    command: child._cmd,
    startedAt: child._startedAt,
    exitCode: null,
    endedAt: null
  };
  child.stdout.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    childLog.push(...lines);
    if (childLog.length > MAX_LOG) childLog.splice(0, childLog.length - MAX_LOG);
    broadcastWs('process', lines);
  });
  child.stderr.on('data', (d) => {
    const lines = d.toString().split('\n').filter(Boolean);
    childLog.push(...lines);
    if (childLog.length > MAX_LOG) childLog.splice(0, childLog.length - MAX_LOG);
    broadcastWs('process', lines);
  });
  child.on('exit', (code, signal) => {
    const resolvedExitCode = Number.isFinite(code) ? code : null;
    const resolvedSignal = String(signal || '').trim();
    broadcastWs(
      'process',
      [`[process exited with code ${resolvedExitCode === null ? 'null' : resolvedExitCode}${resolvedSignal ? ` signal ${resolvedSignal}` : ''}]`]
    );
    lastProcessSnapshot = {
      ...lastProcessSnapshot,
      pid: child.pid || lastProcessSnapshot.pid,
      command: child._cmd || lastProcessSnapshot.command,
      startedAt: child._startedAt || lastProcessSnapshot.startedAt,
      exitCode: resolvedExitCode,
      endedAt: new Date().toISOString()
    };
    if (childProc === child) {
      childProc = null;
    }
  });
  childProc = child;
  return processStatus();
}

function waitForProcessExit(proc = childProc, timeoutMs = 7000) {
  const runningProc = proc;
  if (!runningProc || runningProc.exitCode !== null) {
    return Promise.resolve(true);
  }
  const limitMs = Math.max(250, Number.parseInt(String(timeoutMs || 7000), 10) || 7000);
  return new Promise((resolve) => {
    let finished = false;
    const onExit = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      runningProc.off('exit', onExit);
      resolve(runningProc.exitCode !== null);
    }, limitMs);
    runningProc.once('exit', onExit);
  });
}

function killWindowsProcessTree(pid) {
  const safePid = Number.parseInt(String(pid || ''), 10);
  if (!Number.isFinite(safePid) || safePid <= 0 || process.platform !== 'win32') {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    execCb(`taskkill /PID ${safePid} /T /F`, (error) => {
      resolve(!error);
    });
  });
}

function parsePidRows(value) {
  return [...new Set(
    String(value || '')
      .split(/\r?\n/)
      .map((row) => Number.parseInt(String(row || '').trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  )];
}

async function findOrphanIndexLabPids() {
  if (process.platform === 'win32') {
    const psScript = [
      "$ErrorActionPreference='SilentlyContinue'",
      "Get-CimInstance Win32_Process",
      "| Where-Object {",
      "  (",
      "    $_.Name -match '^(node|node\\.exe|cmd\\.exe|powershell\\.exe|pwsh\\.exe)$'",
      "  )",
      "  -and $_.CommandLine",
      "  -and (",
      "    $_.CommandLine -match 'src[\\\\/]cli[\\\\/](spec|indexlab)\\.js'",
      "  )",
      "  -and (",
      "    $_.CommandLine -match '\\bindexlab\\b'",
      "    -or $_.CommandLine -match '--mode\\s+indexlab'",
      "    -or $_.CommandLine -match '--local'",
      "  )",
      "}",
      "| Select-Object -ExpandProperty ProcessId"
    ].join(' ');
    const listed = await runCommandCapture(
      'powershell',
      ['-NoProfile', '-Command', psScript],
      { timeoutMs: 8_000 }
    );
    if (!listed.ok && !String(listed.stdout || '').trim()) return [];
    return parsePidRows(listed.stdout);
  }

  const listed = await runCommandCapture(
    'sh',
    ['-lc', "ps -eo pid=,args= | grep -E \"(node|sh|bash).*(src/cli/(spec|indexlab)\\.js).*(indexlab|--mode indexlab|--local)\" | grep -v grep | awk '{print $1}'"],
    { timeoutMs: 8_000 }
  );
  if (!listed.ok && !String(listed.stdout || '').trim()) return [];
  return parsePidRows(listed.stdout);
}

async function stopOrphanIndexLabProcesses(timeoutMs = 8000) {
  const currentPid = Number.parseInt(String(childProc?.pid || 0), 10);
  const targets = (await findOrphanIndexLabPids())
    .filter((pid) => !(Number.isFinite(currentPid) && currentPid > 0 && pid === currentPid));
  if (targets.length === 0) {
    return {
      attempted: false,
      killed: 0,
      pids: []
    };
  }

  let killed = 0;
  for (const pid of targets) {
    let ok = false;
    if (process.platform === 'win32') {
      ok = await killWindowsProcessTree(pid);
    } else {
      const term = await runCommandCapture('kill', ['-TERM', String(pid)], { timeoutMs: Math.min(3_000, timeoutMs) });
      if (!term.ok) {
        const force = await runCommandCapture('kill', ['-KILL', String(pid)], { timeoutMs: Math.min(3_000, timeoutMs) });
        ok = Boolean(force.ok);
      } else {
        ok = true;
      }
    }
    if (ok) killed += 1;
  }

  return {
    attempted: true,
    killed,
    pids: targets
  };
}

async function stopProcess(timeoutMs = 8000, options = {}) {
  const force = Boolean(options?.force);
  const runningProc = childProc;
  if (!runningProc || runningProc.exitCode !== null) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    return {
      ...processStatus(),
      stop_attempted: Boolean(orphanStop.attempted || force),
      stop_confirmed: true,
      orphan_killed: orphanStop.killed
    };
  }

  try { runningProc.kill('SIGTERM'); } catch { /* ignore */ }
  let exited = await waitForProcessExit(runningProc, Math.min(3000, timeoutMs));

  if (!exited && runningProc.exitCode === null) {
    try { runningProc.kill('SIGKILL'); } catch { /* ignore */ }
    exited = await waitForProcessExit(runningProc, 2000);
  }

  if (!exited && runningProc.exitCode === null) {
    await killWindowsProcessTree(runningProc.pid);
    exited = await waitForProcessExit(runningProc, Math.max(1000, timeoutMs - 5000));
  }
  let orphanKilled = 0;
  if (!exited && runningProc.exitCode === null) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    orphanKilled = orphanStop.killed;
    if (orphanStop.killed > 0) {
      exited = true;
    }
  }
  if (force) {
    const orphanStop = await stopOrphanIndexLabProcesses(timeoutMs);
    orphanKilled += Number(orphanStop.killed || 0);
    if (orphanStop.killed > 0) {
      exited = true;
    }
  }

  return {
    ...processStatus(),
    stop_attempted: true,
    stop_confirmed: Boolean(exited || runningProc.exitCode !== null || orphanKilled > 0),
    orphan_killed: orphanKilled
  };
}

// â”€â”€ Route Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CATEGORY_SEGMENT_SCOPES = new Set([
  'catalog',
  'product',
  'events',
  'llm-settings',
  'queue',
  'billing',
  'learning',
  'studio',
  'workbook',
  'review',
  'review-components',
]);

const TEST_MODE_ACTION_SEGMENTS = new Set([
  'create',
  'contract-summary',
  'status',
  'generate-products',
  'run',
  'validate',
]);

function parsePath(url) {
  const [pathname, qs] = (url || '/').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = pathname
    .replace(/^\/api\/v1/, '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });

  if (parts[1] && CATEGORY_SEGMENT_SCOPES.has(parts[0])) {
    parts[1] = resolveCategoryAlias(parts[1]);
  }
  if (parts[0] === 'test-mode' && parts[1] && !TEST_MODE_ACTION_SEGMENTS.has(parts[1])) {
    parts[1] = resolveCategoryAlias(parts[1]);
  }
  if (
    parts[0] === 'indexing'
    && (parts[1] === 'domain-checklist' || parts[1] === 'review-metrics')
    && parts[2]
  ) {
    parts[2] = resolveCategoryAlias(parts[2]);
  }

  return { parts, params, pathname };
}

// â”€â”€ Catalog builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function buildCatalog(category) {
  const catalog = await loadProductCatalog(config, category);
  const inputKeys = await storage.listInputKeys(category);
  const specDb = getSpecDb(category);
  const queue = await loadQueueState({ storage, category, specDb }).catch(() => ({ state: { products: {} } }));
  const queueProducts = queue.state?.products || {};

  // Map: normKey â†’ row (for dedup)
  const seen = new Map();

  // 1. Seed from product_catalog.json (authoritative product list, populated by workbook import)
  for (const [pid, entry] of Object.entries(catalog.products || {})) {
    const brand = String(entry.brand || '').trim();
    const model = String(entry.model || '').trim();
    const variant = cleanVariant(entry.variant);
    if (!brand || !model) continue;
    const key = catalogKey(brand, model, variant);
    if (seen.has(key)) continue;
    seen.set(key, {
      productId: pid,
      id: entry.id || 0,
      identifier: entry.identifier || '',
      brand,
      model,
      variant,
      status: 'pending',
      hasFinal: false,
      validated: false,
      confidence: 0,
      coverage: 0,
      fieldsFilled: 0,
      fieldsTotal: 0,
      lastRun: '',
      inActive: true,
    });
  }

  // 2. Merge from storage inputs (enriches existing catalog entries only)
  for (const inputKey of inputKeys) {
    const input = await storage.readJsonOrNull(inputKey);
    if (!input) continue;
    const existingProductId = input.productId || path.basename(inputKey, '.json').replace(`${category}-`, '');
    const il = input.identityLock || {};
    const brand = String(il.brand || input.brand || '').trim();
    const model = String(il.model || input.model || '').trim();
    const variant = cleanVariant(il.variant || input.variant);
    if (!brand || !model) continue;

    const latestBase = storage.resolveOutputKey(category, existingProductId, 'latest');
    const [summary, normalized, hasFinal] = await Promise.all([
      storage.readJsonOrNull(`${latestBase}/summary.json`),
      storage.readJsonOrNull(`${latestBase}/normalized.json`),
      storage.objectExists(`final/${category}/${existingProductId}/normalized.json`).catch(() => false),
    ]);
    const identity = normalized?.identity || {};
    const qp = queueProducts[existingProductId] || {};

    const resolvedBrand = identity.brand || brand;
    const resolvedModel = identity.model || model;
    let resolvedVariant = cleanVariant(identity.variant || variant);

    // Try exact match first, then collapse variant into base product
    let key = catalogKey(resolvedBrand, resolvedModel, resolvedVariant);
    if (!seen.has(key) && resolvedVariant) {
      const keyNoVariant = catalogKey(resolvedBrand, resolvedModel, '');
      if (seen.has(keyNoVariant)) {
        resolvedVariant = '';
        key = keyNoVariant;
      }
    }

    // Only enrich products already in the catalog â€” skip orphaned storage inputs
    if (!seen.has(key)) continue;

    const existing = seen.get(key);
    Object.assign(existing, {
      productId: existingProductId,
      status: qp.status || (summary ? 'complete' : 'pending'),
      hasFinal,
      validated: !!(summary?.validated),
      confidence: summary?.confidence || 0,
      coverage: (summary?.coverage_overall_percent || 0) / 100,
      fieldsFilled: summary?.fields_filled || 0,
      fieldsTotal: summary?.fields_total || 0,
      lastRun: summary?.lastRun || summary?.generated_at || '',
      inActive: existing.inActive || !!input.active || !!(input.targets && Object.keys(input.targets).length),
    });
  }

  // 3. Sort by brand, model, variant
  const rows = [...seen.values()];
  rows.sort((a, b) =>
    a.brand.localeCompare(b.brand) ||
    a.model.localeCompare(b.model) ||
    a.variant.localeCompare(b.variant)
  );
  return rows;
}

// â”€â”€ Compiled component DB dual-write â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function patchCompiledComponentDb(category, componentType, entityName, propertyPatch, identityPatch) {
  const dbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');
  const files = await listFiles(dbDir, '.json');
  for (const f of files) {
    const fp = path.join(dbDir, f);
    const data = await safeReadJson(fp);
    if (data?.component_type !== componentType || !Array.isArray(data.items)) continue;
    const item = data.items.find(it => it.name === entityName);
    if (!item) return;
    if (propertyPatch && typeof propertyPatch === 'object') {
      if (!item.properties) item.properties = {};
      Object.assign(item.properties, propertyPatch);
    }
    if (identityPatch && typeof identityPatch === 'object') {
      if (identityPatch.name !== undefined) item.name = identityPatch.name;
      if (identityPatch.maker !== undefined) item.maker = identityPatch.maker;
      if (identityPatch.links !== undefined) item.links = identityPatch.links;
      if (identityPatch.aliases !== undefined) item.aliases = identityPatch.aliases;
    }
    await fs.writeFile(fp, JSON.stringify(data, null, 2));
    return;
  }
}

// â”€â”€ Route Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function handleApi(req, res) {
  const { parts, params } = parsePath(req.url);
  const method = req.method;

  // Health
  if (parts[0] === 'health' || (parts.length === 0 && method === 'GET')) {
    return jsonRes(res, 200, {
      ok: true,
      service: 'gui-server',
      dist_root: DIST_ROOT,
      cwd: process.cwd(),
      isPkg: typeof process.pkg !== 'undefined',
    });
  }

  // Categories
  if (parts[0] === 'categories' && method === 'GET') {
    const includeTest = params.get('includeTest') === 'true';
    const cats = (await listDirs(HELPER_ROOT)).filter(c => {
      if (c === '_global') return false;          // shared config, never a category
      if (c.startsWith('_test_')) return includeTest;
      return !c.startsWith('_');
    });
    return jsonRes(res, 200, cats.length > 0 ? cats : ['mouse']);
  }

  // POST /api/v1/categories  { name }
  if (parts[0] === 'categories' && method === 'POST') {
    const body = await readJsonBody(req);
    const slug = canonicalSlugify(body?.name);
    if (!slug) return jsonRes(res, 400, { ok: false, error: 'category_name_required' });
    const catDir = path.join(HELPER_ROOT, slug);
    try { await fs.access(catDir); return jsonRes(res, 409, { ok: false, error: 'category_already_exists', slug }); } catch {}
    await fs.mkdir(catDir, { recursive: true });
    // Create stub subdirs so the category is functional
    await fs.mkdir(path.join(catDir, '_control_plane'), { recursive: true });
    await fs.mkdir(path.join(catDir, '_generated'), { recursive: true });
    const cats = (await listDirs(HELPER_ROOT)).filter(c => c !== '_global' && !c.startsWith('_'));
    return jsonRes(res, 201, { ok: true, slug, categories: cats });
  }

  // POST /api/v1/catalog/{cat}/reconcile  { dryRun?: boolean }
  if (parts[0] === 'catalog' && parts[1] && parts[2] === 'reconcile' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await reconcileOrphans({
      storage,
      category: parts[1],
      config,
      dryRun: body.dryRun !== false
    });
    return jsonRes(res, 200, result);
  }

  // Product Catalog CRUD â€” /api/v1/catalog/{cat}/products[/{pid}]
  if (parts[0] === 'catalog' && parts[1] && parts[2] === 'products') {
    const category = parts[1];

    // POST /api/v1/catalog/{cat}/products/seed
    if (parts[3] === 'seed' && method === 'POST') {
      const body = await readJsonBody(req).catch(() => ({}));
      const mode = body.mode === 'full' ? 'full' : 'identity';
      const result = await catalogSeedFromWorkbook({ config, category, mode, storage, upsertQueue: upsertQueueProduct });
      return jsonRes(res, 200, result);
    }

    // GET /api/v1/catalog/{cat}/products
    if (!parts[3] && method === 'GET') {
      const products = await listProducts(config, category);
      return jsonRes(res, 200, products);
    }

    // POST /api/v1/catalog/{cat}/products  { brand, model, variant?, seedUrls? }
    if (!parts[3] && method === 'POST') {
      const body = await readJsonBody(req);
      const result = await catalogAddProduct({
        config, category,
        brand: body.brand,
        model: body.model,
        variant: body.variant || '',
        seedUrls: body.seedUrls || [],
        storage,
        upsertQueue: upsertQueueProduct
      });
      const status = result.ok ? 201 : (result.error === 'product_already_exists' ? 409 : 400);
      return jsonRes(res, status, result);
    }

    // PUT /api/v1/catalog/{cat}/products/{pid}  { brand?, model?, variant?, seedUrls?, status? }
    if (parts[3] && method === 'PUT') {
      const body = await readJsonBody(req);
      const result = await catalogUpdateProduct({
        config, category,
        productId: parts[3],
        patch: body,
        storage,
        upsertQueue: upsertQueueProduct
      });
      const status = result.ok ? 200 : (result.error === 'product_not_found' ? 404 : 409);
      return jsonRes(res, status, result);
    }

    // DELETE /api/v1/catalog/{cat}/products/{pid}
    if (parts[3] && method === 'DELETE') {
      const result = await catalogRemoveProduct({ config, category, productId: parts[3], storage });
      const status = result.ok ? 200 : 404;
      return jsonRes(res, status, result);
    }
  }

  // Catalog overview â€” /api/v1/catalog/{cat}  ("all" merges every category)
  if (parts[0] === 'catalog' && parts[1] && !parts[2] && method === 'GET') {
    if (parts[1] === 'all') {
      const cats = (await listDirs(HELPER_ROOT)).filter(c => !c.startsWith('_'));
      const all = [];
      for (const cat of cats) {
        try {
          const rows = await buildCatalog(cat);
          all.push(...rows);
        } catch (err) {
          console.error(`[gui-server] buildCatalog failed for ${cat}:`, err.message);
        }
      }
      all.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
      return jsonRes(res, 200, all);
    }
    const rows = await buildCatalog(parts[1]);
    return jsonRes(res, 200, rows);
  }

  // Product detail
  if (parts[0] === 'product' && parts[1] && parts[2] && method === 'GET') {
    const [, category, productId] = parts;
    const latestBase = storage.resolveOutputKey(category, productId, 'latest');
    const [summary, normalized, provenance] = await Promise.all([
      storage.readJsonOrNull(`${latestBase}/summary.json`),
      storage.readJsonOrNull(`${latestBase}/normalized.json`),
      storage.readJsonOrNull(`${latestBase}/provenance.json`),
    ]);
    const trafficLight = await storage.readJsonOrNull(`${latestBase}/traffic_light.json`);
    // Enrich identity with catalog id/identifier (normalized.json may predate the backfill)
    if (normalized?.identity) {
      const catalog = await loadProductCatalog(config, category);
      const catEntry = catalog.products?.[productId] || {};
      if (!normalized.identity.id) normalized.identity.id = catEntry.id || 0;
      if (!normalized.identity.identifier) normalized.identity.identifier = catEntry.identifier || '';
    }
    return jsonRes(res, 200, { summary, normalized, provenance, trafficLight });
  }

  // Events
  if (parts[0] === 'events' && parts[1] && method === 'GET') {
    const category = parts[1];
    const productId = params.get('productId') || '';
    const limit = toInt(params.get('limit'), 500);
    const eventsPath = path.join(OUTPUT_ROOT, '_runtime', 'events.jsonl');
    let lines = [];
    try {
      const text = await fs.readFile(eventsPath, 'utf8');
      lines = text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { /* no events file */ }
    const normalizedCategory = String(category || '').trim().toLowerCase();
    if (normalizedCategory && normalizedCategory !== 'all') {
      lines = lines.filter((e) => {
        const eventCategory = String(e.category || e.cat || '').trim().toLowerCase();
        if (eventCategory) return eventCategory === normalizedCategory;
        const pid = String(e.productId || e.product_id || '').trim().toLowerCase();
        return pid.startsWith(`${normalizedCategory}-`);
      });
    }
    if (productId) {
      const normalizedProductId = String(productId).trim();
      lines = lines.filter((e) => String(e.productId || e.product_id || '').trim() === normalizedProductId);
    }
    return jsonRes(res, 200, lines.slice(-limit));
  }

  // IndexLab runs + event replay
  if (parts[0] === 'indexlab' && parts[1] === 'runs' && method === 'GET') {
    const limit = Math.max(1, toInt(params.get('limit'), 50));
    const rows = await listIndexLabRuns({ limit });
    return jsonRes(res, 200, {
      root: INDEXLAB_ROOT,
      runs: rows
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && !parts[3] && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const runDir = safeJoin(INDEXLAB_ROOT, runId);
    if (!runDir) return jsonRes(res, 400, { error: 'invalid_run_id' });
    const runMetaPath = path.join(runDir, 'run.json');
    const meta = await safeReadJson(runMetaPath);
    if (!meta) return jsonRes(res, 404, { error: 'run_not_found', run_id: runId });
    return jsonRes(res, 200, meta);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'events' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const limit = Math.max(1, toInt(params.get('limit'), 2000));
    const rows = await readIndexLabRunEvents(runId, limit);
    return jsonRes(res, 200, {
      run_id: runId,
      count: rows.length,
      events: rows
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'needset' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const needset = await readIndexLabRunNeedSet(runId);
    if (!needset) {
      return jsonRes(res, 404, { error: 'needset_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...needset
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'search-profile' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const searchProfile = await readIndexLabRunSearchProfile(runId);
    if (!searchProfile) {
      return jsonRes(res, 404, { error: 'search_profile_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...searchProfile
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'phase07-retrieval' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunPhase07Retrieval(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'phase07_retrieval_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...payload
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'phase08-extraction' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunPhase08Extraction(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'phase08_extraction_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...payload
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'dynamic-fetch-dashboard' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunDynamicFetchDashboard(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'dynamic_fetch_dashboard_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...payload
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'source-indexing-packets' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunSourceIndexingPackets(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'source_indexing_packets_not_found', run_id: runId });
    }
    return jsonRes(res, 200, payload);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'item-indexing-packet' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunItemIndexingPacket(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'item_indexing_packet_not_found', run_id: runId });
    }
    return jsonRes(res, 200, payload);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'run-meta-packet' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const payload = await readIndexLabRunRunMetaPacket(runId);
    if (!payload) {
      return jsonRes(res, 404, { error: 'run_meta_packet_not_found', run_id: runId });
    }
    return jsonRes(res, 200, payload);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'serp' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const serp = await readIndexLabRunSerpExplorer(runId);
    if (!serp) {
      return jsonRes(res, 404, { error: 'serp_not_found', run_id: runId });
    }
    return jsonRes(res, 200, {
      run_id: runId,
      ...serp
    });
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'llm-traces' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const limit = Math.max(1, toInt(params.get('limit'), 80));
    const traces = await readIndexLabRunLlmTraces(runId, limit);
    if (!traces) {
      return jsonRes(res, 404, { error: 'llm_traces_not_found', run_id: runId });
    }
    return jsonRes(res, 200, traces);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'automation-queue' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const queue = await readIndexLabRunAutomationQueue(runId);
    if (!queue) {
      return jsonRes(res, 404, { error: 'automation_queue_not_found', run_id: runId });
    }
    return jsonRes(res, 200, queue);
  }

  if (parts[0] === 'indexlab' && parts[1] === 'run' && parts[2] && parts[3] === 'evidence-index' && method === 'GET') {
    const runId = String(parts[2] || '').trim();
    const query = String(params.get('q') || params.get('query') || '').trim();
    const limit = Math.max(1, toInt(params.get('limit'), 40));
    const payload = await readIndexLabRunEvidenceIndex(runId, { query, limit });
    if (!payload) {
      return jsonRes(res, 404, { error: 'evidence_index_not_found', run_id: runId });
    }
    return jsonRes(res, 200, payload);
  }

  if (parts[0] === 'indexing' && parts[1] === 'llm-config' && method === 'GET') {
    const models = collectLlmModels(config);
    const modelPricing = models.map((modelName) => ({
      model: modelName,
      provider: llmProviderFromModel(modelName),
      ...resolvePricingForModel(config, modelName)
    }));
    const modelTokenProfiles = models.map((modelName) => ({
      model: modelName,
      ...resolveTokenProfileForModel(config, modelName)
    }));
    const roleDefaults = resolveLlmRoleDefaults(config);
    const knobDefaults = resolveLlmKnobDefaults(config);
    const roleTokenDefaults = {
      plan: toInt(knobDefaults.phase_02_planner?.token_cap, 1200),
      fast: toInt(knobDefaults.fast_pass?.token_cap, 1200),
      triage: toInt(knobDefaults.phase_03_triage?.token_cap, 1200),
      reasoning: toInt(knobDefaults.reasoning_pass?.token_cap, 4096),
      extract: toInt(knobDefaults.extract_role?.token_cap, 1200),
      validate: toInt(knobDefaults.validate_role?.token_cap, 1200),
      write: toInt(knobDefaults.write_role?.token_cap, 1200)
    };
    const fallbackDefaults = {
      enabled: Boolean(
        String(config.llmPlanFallbackModel || '').trim()
        || String(config.llmExtractFallbackModel || '').trim()
        || String(config.llmValidateFallbackModel || '').trim()
        || String(config.llmWriteFallbackModel || '').trim()
      ),
      plan: String(config.llmPlanFallbackModel || '').trim(),
      extract: String(config.llmExtractFallbackModel || '').trim(),
      validate: String(config.llmValidateFallbackModel || '').trim(),
      write: String(config.llmWriteFallbackModel || '').trim(),
      plan_tokens: toInt(config.llmMaxOutputTokensPlanFallback, roleTokenDefaults.plan),
      extract_tokens: toInt(config.llmMaxOutputTokensExtractFallback, roleTokenDefaults.extract),
      validate_tokens: toInt(config.llmMaxOutputTokensValidateFallback, roleTokenDefaults.validate),
      write_tokens: toInt(config.llmMaxOutputTokensWriteFallback, roleTokenDefaults.write)
    };
    return jsonRes(res, 200, {
      generated_at: new Date().toISOString(),
      phase2: {
        enabled_default: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
        model_default: roleDefaults.plan
      },
      phase3: {
        enabled_default: Boolean(config.llmEnabled && config.llmSerpRerankEnabled),
        model_default: roleDefaults.triage
      },
      model_defaults: roleDefaults,
      token_defaults: roleTokenDefaults,
      fallback_defaults: fallbackDefaults,
      routing_snapshot: llmRoutingSnapshot(config),
      model_options: models,
      token_presets: Array.isArray(config.llmOutputTokenPresets)
        ? config.llmOutputTokenPresets.map((value) => toInt(value, 0)).filter((value) => value > 0)
        : [256, 384, 512, 768, 1024, 1536, 2048, 3072, 4096, 8192],
      pricing_defaults: resolvePricingForModel(config, ''),
      model_pricing: modelPricing,
      model_token_profiles: modelTokenProfiles,
      knob_defaults: knobDefaults,
      pricing_meta: {
        as_of: String(config.llmPricingAsOf || '').trim() || null,
        sources: config.llmPricingSources && typeof config.llmPricingSources === 'object'
          ? config.llmPricingSources
          : {}
      }
    });
  }

  // Indexing metrics: LLM usage rollup
  if (parts[0] === 'indexing' && parts[1] === 'llm-metrics' && method === 'GET') {
    try {
      const period = String(params.get('period') || 'week').trim() || 'week';
      const model = String(params.get('model') || '').trim();
      const category = String(params.get('category') || '').trim();
      const runLimit = Math.max(10, toInt(params.get('runLimit'), 120));
      const result = await buildLlmMetrics({
        storage,
        config,
        period,
        model,
        category,
        runLimit
      });
      return jsonRes(res, 200, {
        command: 'llm-metrics',
        ...result
      });
    } catch (err) {
      return jsonRes(res, 500, { error: err?.message || 'llm_metrics_failed' });
    }
  }

  // Indexing metrics: domain checklist + manufacturer milestones + yield
  if (parts[0] === 'indexing' && parts[1] === 'domain-checklist' && parts[2] && method === 'GET') {
    try {
      const category = String(parts[2] || '').trim();
      if (!category) return jsonRes(res, 400, { error: 'category_required' });
      const productId = String(params.get('productId') || '').trim();
      const runId = String(params.get('runId') || '').trim();
      const windowMinutes = Math.max(5, toInt(params.get('windowMinutes'), 120));
      const includeUrls = String(params.get('includeUrls') || '').trim().toLowerCase() === 'true';
      const result = await buildIndexingDomainChecklist({
        storage,
        config,
        outputRoot: OUTPUT_ROOT,
        category,
        productId,
        runId,
        windowMinutes,
        includeUrls
      });
      return jsonRes(res, 200, {
        command: 'indexing',
        action: 'domain-checklist',
        ...result
      });
    } catch (err) {
      return jsonRes(res, 500, { error: err?.message || 'indexing_domain_checklist_failed' });
    }
  }

  // Indexing metrics: human review velocity/throughput
  if (parts[0] === 'indexing' && parts[1] === 'review-metrics' && parts[2] && method === 'GET') {
    try {
      const category = String(parts[2] || '').trim();
      const windowHours = Math.max(1, toInt(params.get('windowHours'), 24));
      if (!category) return jsonRes(res, 400, { error: 'category_required' });
      const result = await buildReviewMetrics({
        config,
        category,
        windowHours
      });
      return jsonRes(res, 200, {
        command: 'review',
        action: 'metrics',
        ...result
      });
    } catch (err) {
      return jsonRes(res, 500, { error: err?.message || 'review_metrics_failed' });
    }
  }

  // LLM settings routes (SQLite-backed matrix by category)
  if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && method === 'GET') {
    const category = parts[1];
    const scope = (params.get('scope') || '').trim().toLowerCase();
    const specDb = getSpecDb(category);
    if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
    const rows = specDb.getLlmRouteMatrix(scope || undefined);
    return jsonRes(res, 200, { category, scope: scope || null, rows });
  }

  if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && method === 'PUT') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const specDb = getSpecDb(category);
    if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
    const saved = specDb.saveLlmRouteMatrix(rows);
    broadcastWs('data-change', { type: 'llm-settings-updated', category });
    return jsonRes(res, 200, { ok: true, category, rows: saved });
  }

  if (parts[0] === 'llm-settings' && parts[1] && parts[2] === 'routes' && parts[3] === 'reset' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    if (!specDb) return jsonRes(res, 500, { error: 'specdb_unavailable' });
    const rows = specDb.resetLlmRouteMatrixToDefaults();
    broadcastWs('data-change', { type: 'llm-settings-reset', category });
    return jsonRes(res, 200, { ok: true, category, rows });
  }

  // Queue
  if (parts[0] === 'queue' && parts[1] && method === 'GET') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    if (parts[2] === 'review') {
      const status = params.get('status') || 'needs_review';
      const limit = toInt(params.get('limit'), 200);
      const items = await buildReviewQueue({ storage, config, category, status, limit, specDb });
      // Filter review queue against catalog â€” don't surface phantom products
      const cat = await loadProductCatalog(config, category);
      const catPids = new Set(Object.keys(cat.products || {}));
      const filtered = items.filter(item => catPids.has(item.product_id));
      return jsonRes(res, 200, filtered);
    }
    const loaded = await loadQueueState({ storage, category, specDb }).catch(() => ({ state: { products: {} } }));
    const products = Object.values(loaded.state?.products || {});
    return jsonRes(res, 200, products);
  }

  // Queue mutations: retry, pause, priority, requeue-exhausted
  if (parts[0] === 'queue' && parts[1] && parts[2] === 'retry' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    const body = await readJsonBody(req);
    const { productId } = body;
    if (!productId) return jsonRes(res, 400, { error: 'productId required' });
    try {
      const result = await upsertQueueProduct({ storage, category, productId, patch: { status: 'queued', attempts: 0 }, specDb });
      broadcastWs('data-change', { type: 'queue-retry', category, productId });
      return jsonRes(res, 200, { ok: true, productId, product: result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'retry_failed', message: err.message });
    }
  }

  if (parts[0] === 'queue' && parts[1] && parts[2] === 'pause' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    const body = await readJsonBody(req);
    const { productId } = body;
    if (!productId) return jsonRes(res, 400, { error: 'productId required' });
    try {
      const result = await upsertQueueProduct({ storage, category, productId, patch: { status: 'paused' }, specDb });
      broadcastWs('data-change', { type: 'queue-pause', category, productId });
      return jsonRes(res, 200, { ok: true, productId, product: result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'pause_failed', message: err.message });
    }
  }

  if (parts[0] === 'queue' && parts[1] && parts[2] === 'priority' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    const body = await readJsonBody(req);
    const { productId, priority } = body;
    if (!productId) return jsonRes(res, 400, { error: 'productId required' });
    const p = Math.max(1, Math.min(5, parseInt(String(priority), 10) || 3));
    try {
      const result = await upsertQueueProduct({ storage, category, productId, patch: { priority: p }, specDb });
      broadcastWs('data-change', { type: 'queue-priority', category, productId });
      return jsonRes(res, 200, { ok: true, productId, priority: p, product: result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'priority_failed', message: err.message });
    }
  }

  if (parts[0] === 'queue' && parts[1] && parts[2] === 'requeue-exhausted' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    try {
      const loaded = await loadQueueState({ storage, category, specDb });
      const products = loaded.state?.products || {};
      const requeued = [];
      for (const [pid, row] of Object.entries(products)) {
        const st = String(row.status || '').toLowerCase();
        if (st === 'exhausted' || st === 'failed') {
          products[pid] = { ...row, status: 'queued', attempts: 0, updated_at: new Date().toISOString() };
          requeued.push(pid);
        }
      }
      if (requeued.length > 0) {
        await saveQueueState({ storage, category, state: loaded.state, specDb });
        broadcastWs('data-change', { type: 'queue-requeue', category, count: requeued.length });
      }
      return jsonRes(res, 200, { ok: true, requeued_count: requeued.length, productIds: requeued });
    } catch (err) {
      return jsonRes(res, 500, { error: 'requeue_failed', message: err.message });
    }
  }

  // Billing
  if (parts[0] === 'billing' && parts[1] && parts[2] === 'monthly' && method === 'GET') {
    const category = parts[1];
    const billingDir = path.join(OUTPUT_ROOT, '_billing', category);
    const files = await listFiles(billingDir, '.json');
    if (files.length === 0) return jsonRes(res, 200, { totals: {} });
    const latest = files[files.length - 1];
    const data = await safeReadJson(path.join(billingDir, latest));
    return jsonRes(res, 200, data || { totals: {} });
  }

  // Learning artifacts
  if (parts[0] === 'learning' && parts[1] && parts[2] === 'artifacts' && method === 'GET') {
    const category = parts[1];
    const learningDir = path.join(OUTPUT_ROOT, '_learning', category);
    const files = await listFiles(learningDir);
    const artifacts = [];
    for (const f of files) {
      const st = await safeStat(path.join(learningDir, f));
      artifacts.push({ name: f, path: path.join(learningDir, f), size: st?.size || 0, updated: st?.mtime?.toISOString() || '' });
    }
    return jsonRes(res, 200, artifacts);
  }

  // Studio
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'payload' && method === 'GET') {
    const category = parts[1];
    const catConfig = await loadCategoryConfig(category, { storage, config }).catch(() => ({}));
    return jsonRes(res, 200, {
      category,
      fieldRules: catConfig.fieldRules?.fields || {},
      fieldOrder: catConfig.fieldOrder || Object.keys(catConfig.fieldRules?.fields || {}),
      uiFieldCatalog: catConfig.uiFieldCatalog || null,
      guardrails: catConfig.guardrails || null,
    });
  }

  // Workbook products (reads from product catalog)
  if (parts[0] === 'workbook' && parts[1] && parts[2] === 'products' && method === 'GET') {
    const category = parts[1];
    const catalog = await loadProductCatalog(config, category);
    const products = [];
    const brandSet = new Set();
    for (const [pid, entry] of Object.entries(catalog.products || {})) {
      const brand = String(entry.brand || '').trim();
      const model = String(entry.model || '').trim();
      const variant = cleanVariant(entry.variant);
      if (!brand || !model) continue;
      brandSet.add(brand);
      products.push({
        brand,
        model,
        variant,
        productId: pid,
      });
    }
    return jsonRes(res, 200, { products, brands: [...brandSet].sort() });
  }

  // GET /workbook/:category/context
  if (parts[0] === 'workbook' && parts[1] && parts[2] === 'context' && method === 'GET') {
    const category = parts[1];
    const mapResult = await loadWorkbookMap({ category, config }).catch(() => null);
    if (!mapResult?.map?.workbook_path) {
      return jsonRes(res, 200, { mapSummary: null, keys: [], products: [], enums: {}, componentSummary: {}, error: 'no_workbook_path' });
    }
    try {
      const result = await extractWorkbookContext({ workbookPath: mapResult.map.workbook_path, workbookMap: mapResult.map, category });

      // Enrich products with productId, catalog presence, output presence
      const catCatalog = await loadProductCatalog(config, category);
      const catalogSet = new Set();
      const catalogLookup = new Map();
      for (const [cpid, centry] of Object.entries(catCatalog.products || {})) {
        const b = normText(centry.brand), m = normText(centry.model), v = cleanVariant(centry.variant);
        if (b && m) {
          catalogSet.add(catalogKey(b, m, v));
          catalogLookup.set(catalogKey(b, m, v), centry);
        }
      }
      const finalDir = path.join(OUTPUT_ROOT, 'final', category);
      let outputDirEntries = [];
      try { outputDirEntries = await fs.readdir(finalDir); } catch {}
      const outputSet = new Set(outputDirEntries.map((d) => d.toLowerCase()));
      result.products = (result.products || []).map((p) => {
        const pid = buildProductIdFromParts(category, p.brand, p.model, p.variant);
        const pVariant = cleanVariant(p.variant);
        const catKey1 = catalogKey(normText(p.brand), normText(p.model), pVariant);
        const catKey2 = pVariant ? catalogKey(normText(p.brand), normText(p.model), '') : null;
        const inCat = catalogSet.has(catKey1) || (catKey2 && catalogSet.has(catKey2));
        const catEntry = catalogLookup.get(catKey1) || (catKey2 ? catalogLookup.get(catKey2) : null);
        return {
          ...p,
          id: p.id || (catEntry?.id || 0),
          identifier: p.identifier || (catEntry?.identifier || ''),
          productId: pid,
          inCatalog: inCat,
          hasOutput: outputSet.has(pid.toLowerCase())
        };
      });

      // Enrich enums: load known_values (observed) + field_rules_draft (manual additions)
      const kvPath = path.join(HELPER_ROOT, category, '_generated', 'known_values.json');
      const kvData = await safeReadJson(kvPath);
      const observedValues = kvData?.fields || {};
      const draftPath = path.join(HELPER_ROOT, category, '_control_plane', 'field_rules_draft.json');
      const draftData = await safeReadJson(draftPath);
      const draftFields = draftData?.fields || {};
      const draftEnumAdditions = {};
      for (const [field, rule] of Object.entries(draftFields)) {
        if (rule?.enum_values && Array.isArray(rule.enum_values)) {
          draftEnumAdditions[field] = rule.enum_values;
        }
      }
      result.observedValues = observedValues;
      result.draftEnumAdditions = draftEnumAdditions;

      // Enrich keys: load generated field_rules for mismatch detection
      const frPath = path.join(HELPER_ROOT, category, '_generated', 'field_rules.json');
      const frData = await safeReadJson(frPath);
      const generatedFieldKeys = frData?.fields ? Object.keys(frData.fields) : [];
      result.generatedFieldKeys = generatedFieldKeys;

      return jsonRes(res, 200, result);
    } catch (err) {
      return jsonRes(res, 200, { mapSummary: null, keys: [], products: [], enums: {}, componentSummary: {}, error: err.message });
    }
  }

  // Workbook map
  if (parts[0] === 'workbook' && parts[1] && parts[2] === 'map' && method === 'GET') {
    const category = parts[1];
    // Try control plane first, then fixtures fallback
    let data = await safeReadJson(path.join(HELPER_ROOT, category, '_control_plane', 'workbook_map.json'));
    if (!data) {
      data = await safeReadJson(path.join('fixtures', 'category_compile', `${category}.workbook_map.json`));
    }
    return jsonRes(res, 200, data || {});
  }

  // Studio compile
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'compile' && method === 'POST') {
    const category = parts[1];
    try {
      const status = startProcess('src/cli/spec.js', ['category-compile', '--category', category, '--local']);
      return jsonRes(res, 200, status);
    } catch (err) {
      return jsonRes(res, 409, { error: err.message });
    }
  }

  // Studio: validate rules
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'validate-rules' && method === 'POST') {
    const category = parts[1];
    try {
      const status = startProcess('src/cli/spec.js', ['validate-rules', '--category', category, '--local']);
      return jsonRes(res, 200, status);
    } catch (err) {
      return jsonRes(res, 409, { error: err.message });
    }
  }

  if (parts[0] === 'studio' && parts[1] && parts[2] === 'guardrails' && method === 'GET') {
    const category = parts[1];
    const guardrailPath = path.join(OUTPUT_ROOT, '_studio', category, 'guardrails.json');
    const data = await safeReadJson(guardrailPath);
    return jsonRes(res, 200, data || {});
  }

  // Studio known-values
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'known-values' && method === 'GET') {
    const category = parts[1];
    const kvPath = path.join(HELPER_ROOT, category, '_generated', 'known_values.json');
    const data = await safeReadJson(kvPath);
    return jsonRes(res, 200, data || {});
  }

  // Studio component-db (entity names by type)
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'component-db' && method === 'GET') {
    const category = parts[1];
    const dbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');
    const files = await listFiles(dbDir, '.json');
    const result = {};
    for (const f of files) {
      const data = await safeReadJson(path.join(dbDir, f));
      if (data?.component_type && Array.isArray(data.items)) {
        result[data.component_type] = data.items.map(item => ({
          name: item.name || '',
          maker: item.maker || '',
          aliases: item.aliases || [],
        }));
      }
    }
    return jsonRes(res, 200, result);
  }

  // Studio introspect workbook
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'introspect' && method === 'GET') {
    const category = parts[1];
    const catRoot = path.join(HELPER_ROOT, category);
    // Load workbook map to find workbook path
    const mapData = await safeReadJson(path.join(catRoot, '_control_plane', 'workbook_map.json'));
    const wbPath = mapData?.workbook_path || '';
    if (!wbPath) {
      return jsonRes(res, 200, { sheets: [], suggestedMap: null, error: 'no_workbook_path_configured' });
    }
    try {
      const result = await introspectWorkbook({ workbookPath: wbPath, previewRows: 10, previewCols: 50 });
      return jsonRes(res, 200, result);
    } catch (err) {
      return jsonRes(res, 200, { sheets: [], suggestedMap: null, error: err.message });
    }
  }

  // Studio workbook-map GET (using full loadWorkbookMap with normalization)
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'workbook-map' && method === 'GET') {
    const category = parts[1];
    try {
      const result = await loadWorkbookMap({ category, config });
      return jsonRes(res, 200, result || { file_path: '', map: {} });
    } catch (err) {
      return jsonRes(res, 200, { file_path: '', map: {}, error: err.message });
    }
  }

  // Studio workbook-map PUT (save)
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'workbook-map' && method === 'PUT') {
    const category = parts[1];
    const body = await readJsonBody(req);
    try {
      const result = await saveWorkbookMap({ category, workbookMap: body, config });
      return jsonRes(res, 200, result);
    } catch (err) {
      return jsonRes(res, 500, { error: 'save_failed', message: err.message });
    }
  }

  // Studio workbook-map validate
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'validate-map' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const result = validateWorkbookMap(body, { category });
    return jsonRes(res, 200, result);
  }

  // Studio tooltip bank
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'tooltip-bank' && method === 'GET') {
    const category = parts[1];
    const catRoot = path.join(HELPER_ROOT, category);
    const mapData = await safeReadJson(path.join(catRoot, '_control_plane', 'workbook_map.json'));
    // loadTooltipLibrary is not exported, read tooltip files directly
    const tooltipPath = mapData?.tooltip_source?.path || '';
    const tooltipFiles = [];
    const tooltipEntries = {};
    try {
      const entries = await fs.readdir(catRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && /^hbs_tooltips/i.test(entry.name)) {
          tooltipFiles.push(entry.name);
          const raw = await fs.readFile(path.join(catRoot, entry.name), 'utf8').catch(() => '');
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (typeof parsed === 'object') {
                for (const [k, v] of Object.entries(parsed)) {
                  tooltipEntries[k] = v;
                }
              }
            } catch { /* not JSON, skip */ }
          }
        }
      }
    } catch { /* no files */ }
    return jsonRes(res, 200, { entries: tooltipEntries, files: tooltipFiles, configuredPath: tooltipPath });
  }

  // Studio save drafts
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'save-drafts' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const catRoot = path.join(HELPER_ROOT, category);
    const controlPlane = path.join(catRoot, '_control_plane');
    await fs.mkdir(controlPlane, { recursive: true });
    if (body.fieldRulesDraft) {
      await fs.writeFile(path.join(controlPlane, 'field_rules_draft.json'), JSON.stringify(body.fieldRulesDraft, null, 2));
    }
    if (body.uiFieldCatalogDraft) {
      await fs.writeFile(path.join(controlPlane, 'ui_field_catalog_draft.json'), JSON.stringify(body.uiFieldCatalogDraft, null, 2));
    }
    return jsonRes(res, 200, { ok: true });
  }

  // Studio field rules draft GET
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'drafts' && method === 'GET') {
    const category = parts[1];
    const controlPlane = path.join(HELPER_ROOT, category, '_control_plane');
    const [fieldRulesDraft, uiFieldCatalogDraft] = await Promise.all([
      safeReadJson(path.join(controlPlane, 'field_rules_draft.json')),
      safeReadJson(path.join(controlPlane, 'ui_field_catalog_draft.json')),
    ]);
    return jsonRes(res, 200, { fieldRulesDraft, uiFieldCatalogDraft });
  }

  // Studio generated artifacts list
  if (parts[0] === 'studio' && parts[1] && parts[2] === 'artifacts' && method === 'GET') {
    const category = parts[1];
    const generatedRoot = path.join(HELPER_ROOT, category, '_generated');
    const files = await listFiles(generatedRoot, '.json');
    const artifacts = [];
    for (const f of files) {
      const st = await safeStat(path.join(generatedRoot, f));
      artifacts.push({ name: f, size: st?.size || 0, updated: st?.mtime?.toISOString() || '' });
    }
    return jsonRes(res, 200, artifacts);
  }

  // Review layout
  if (parts[0] === 'review' && parts[1] && parts[2] === 'layout' && method === 'GET') {
    const category = parts[1];
    const layout = await buildReviewLayout({ storage, config, category });
    return jsonRes(res, 200, layout);
  }

  // Review product payload (single) â€” only serve if product exists in catalog
  if (parts[0] === 'review' && parts[1] && parts[2] === 'product' && parts[3] && method === 'GET') {
    const [, category, , productId] = parts;
    const specDb = getSpecDb(category);
    const catalog = await loadProductCatalog(config, category);
    const catalogPids = new Set(Object.keys(catalog.products || {}));
    if (catalogPids.size > 0 && !catalogPids.has(productId)) {
      return jsonRes(res, 404, { error: 'not_in_catalog', message: `Product ${productId} is not in the product catalog` });
    }
    const payload = await buildProductReviewPayload({ storage, config, category, productId, specDb });
    // Enrich identity with catalog id/identifier (normalized.json may predate the backfill)
    const catEntry = catalog.products?.[productId] || {};
    if (payload?.identity) {
      if (!payload.identity.id) payload.identity.id = catEntry.id || 0;
      if (!payload.identity.identifier) payload.identity.identifier = catEntry.identifier || '';
    }
    return jsonRes(res, 200, payload);
  }

  // Review batch products (for multi-product matrix)
  if (parts[0] === 'review' && parts[1] && parts[2] === 'products' && method === 'GET') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    const idsParam = params.get('ids') || '';
    const brandsParam = params.get('brands') || '';
    const limit = toInt(params.get('limit'), 20);
    const wantCandidates = params.get('includeCandidates') !== 'false';
    let productIds;
    if (idsParam) {
      productIds = idsParam.split(',').filter(Boolean);
    } else {
      // Default: get products from queue that need review
      const queue = await buildReviewQueue({ storage, config, category, status: 'needs_review', limit, specDb });
      productIds = queue.map(q => q.product_id || q.productId).filter(Boolean).slice(0, limit);
    }
    // Filter against catalog + SpecDb products table
    const catalog = await loadProductCatalog(config, category);
    const catalogPids = new Set(Object.keys(catalog.products || {}));
    // Also check SpecDb products table
    if (specDb) {
      try {
        const dbProducts = specDb.getAllProducts('active');
        for (const p of dbProducts) catalogPids.add(p.product_id);
      } catch { /* fall through */ }
    }
    productIds = productIds.filter(pid => catalogPids.has(pid));
    // Brand filter â€” if brands param is provided, only include matching products
    const brandsFilter = brandsParam ? new Set(brandsParam.split(',').map(b => b.trim().toLowerCase()).filter(Boolean)) : null;
    const payloads = [];
    for (const pid of productIds) {
      try {
        const payload = await buildProductReviewPayload({ storage, config, category, productId: pid, includeCandidates: wantCandidates, specDb });
        if (payload?.identity) {
          const ce = catalog.products?.[pid] || {};
          if (!payload.identity.id) payload.identity.id = ce.id || 0;
          if (!payload.identity.identifier) payload.identity.identifier = ce.identifier || '';
        }
        if (payload) {
          if (brandsFilter) {
            const brand = String(payload.identity?.brand || '').trim().toLowerCase();
            if (!brandsFilter.has(brand)) continue;
          }
          payloads.push(payload);
        }
      } catch { /* skip failed products */ }
    }
    return jsonRes(res, 200, payloads);
  }

  // Review products index â€” ALL products, lightweight (no candidates), sorted by brand
  if (parts[0] === 'review' && parts[1] && parts[2] === 'products-index' && method === 'GET') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    const catalog = await loadProductCatalog(config, category);
    const catalogProducts = catalog.products || {};
    let productIds = Object.keys(catalogProducts);
    // Supplement with SpecDb products table if catalog is empty
    if (productIds.length === 0) {
      if (specDb) {
        try {
          const dbProducts = specDb.getAllProducts('active');
          productIds = dbProducts.map(p => p.product_id);
          // Backfill catalogProducts for enrichment below
          for (const p of dbProducts) {
            catalogProducts[p.product_id] = { brand: p.brand, model: p.model, variant: p.variant, id: p.id, identifier: p.identifier };
          }
        } catch { /* fall through */ }
      }
    }

    const payloads = [];
    for (const pid of productIds) {
      try {
        const payload = await buildProductReviewPayload({ storage, config, category, productId: pid, includeCandidates: false, specDb });
        if (payload?.identity) {
          const ce = catalogProducts[pid] || {};
          if (!payload.identity.id) payload.identity.id = ce.id || 0;
          if (!payload.identity.identifier) payload.identity.identifier = ce.identifier || '';
        }
        if (payload) payloads.push(payload);
      } catch { /* skip failed products */ }
    }

    // Tag each product with hasRun (has summary data)
    for (const p of payloads) {
      p.hasRun = !!p.metrics.has_run;
    }

    // Enrich each product's fields with key_review_state data
    {
      if (specDb) {
        for (const p of payloads) {
          try {
            const krsRows = specDb.getKeyReviewStatesForItem(p.product_id);
            for (const krs of krsRows) {
              const fieldState = p.fields[krs.field_key];
              if (!fieldState) continue;
              fieldState.keyReview = {
                id: krs.id,
                selectedCandidateId: krs.selected_candidate_id || null,
                primaryStatus: krs.ai_confirm_primary_status || null,
                primaryConfidence: krs.ai_confirm_primary_confidence ?? null,
                sharedStatus: krs.ai_confirm_shared_status || null,
                sharedConfidence: krs.ai_confirm_shared_confidence ?? null,
                userAcceptPrimary: krs.user_accept_primary_status || null,
                userAcceptShared: krs.user_accept_shared_status || null,
                overridePrimary: Boolean(krs.user_override_ai_primary),
                overrideShared: Boolean(krs.user_override_ai_shared),
              };
            }
          } catch { /* best-effort key review enrichment */ }
        }
      }
    }

    // Sort by brand (ascending), then model (ascending)
    payloads.sort((a, b) => {
      const brandA = String(a.identity?.brand || '').toLowerCase();
      const brandB = String(b.identity?.brand || '').toLowerCase();
      if (brandA !== brandB) return brandA.localeCompare(brandB);
      const modelA = String(a.identity?.model || '').toLowerCase();
      const modelB = String(b.identity?.model || '').toLowerCase();
      return modelA.localeCompare(modelB);
    });

    // Extract unique sorted brands
    const brandSet = new Set();
    for (const p of payloads) {
      const brand = String(p.identity?.brand || '').trim();
      if (brand) brandSet.add(brand);
    }
    const brands = [...brandSet].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    // Compute run-only metrics (excludes unrun products that drag averages down)
    const runProducts = payloads.filter(p => p.hasRun);
    const metricsRun = runProducts.length > 0 ? {
      confidence: runProducts.reduce((s, p) => s + p.metrics.confidence, 0) / runProducts.length,
      coverage: runProducts.reduce((s, p) => s + p.metrics.coverage, 0) / runProducts.length,
      flags: runProducts.reduce((s, p) => s + p.metrics.flags, 0),
      missing: runProducts.reduce((s, p) => s + (p.metrics.missing || 0), 0),
      count: runProducts.length,
    } : { confidence: 0, coverage: 0, flags: 0, missing: 0, count: 0 };

    return jsonRes(res, 200, { products: payloads, brands, total: payloads.length, metrics_run: metricsRun });
  }

  // Review candidates for a single field â€” lazy loading for drawer
  if (parts[0] === 'review' && parts[1] && parts[2] === 'candidates' && parts[3] && parts[4] && method === 'GET') {
    const [, category, , productId, field] = parts;
    const specDb = getSpecDb(category);
    // Check product exists â€” catalog OR SpecDb products table
    const catalog = await loadProductCatalog(config, category);
    const catalogPids = new Set(Object.keys(catalog.products || {}));
    if (catalogPids.size > 0 && !catalogPids.has(productId)) {
      // Also check SpecDb products table before returning 404
      const dbProduct = specDb?.getProduct(productId);
      if (!dbProduct) {
        return jsonRes(res, 404, { error: 'not_in_catalog', message: `Product ${productId} is not in the product catalog` });
      }
    }
    const payload = await buildProductReviewPayload({
      storage,
      config,
      category,
      productId,
      includeCandidates: true,
      specDb
    });
    const requestedField = decodeURIComponent(String(field || ''));
    const availableFields = Object.keys(payload.fields || {});
    const resolvedField = payload.fields?.[requestedField]
      ? requestedField
      : (availableFields.find((key) => key.toLowerCase() === requestedField.toLowerCase()) || requestedField);
    const fieldState = payload.fields?.[resolvedField] || { candidates: [] };
    let itemFieldStateId = (() => {
      const n = Number(fieldState?.slot_id ?? fieldState?.id ?? null);
      if (!Number.isFinite(n)) return null;
      const id = Math.trunc(n);
      return id > 0 ? id : null;
    })();
    // Slot-truth contract: drawer candidates must come from the exact same slot payload.
    const allCandidates = Array.isArray(fieldState.candidates) ? [...fieldState.candidates] : [];
    // Enrich response with key_review_state data for this field
    let keyReview = null;
    if (specDb) {
      try {
        const krs = specDb.getKeyReviewState({
          targetKind: 'grid_key',
          itemIdentifier: productId,
          fieldKey: resolvedField,
          itemFieldStateId,
          category,
        });
        if (krs) {
          keyReview = {
            id: krs.id,
            selectedCandidateId: krs.selected_candidate_id || null,
            primaryStatus: krs.ai_confirm_primary_status || null,
            primaryConfidence: krs.ai_confirm_primary_confidence ?? null,
            sharedStatus: krs.ai_confirm_shared_status || null,
            sharedConfidence: krs.ai_confirm_shared_confidence ?? null,
            userAcceptPrimary: krs.user_accept_primary_status || null,
            userAcceptShared: krs.user_accept_shared_status || null,
            overridePrimary: Boolean(krs.user_override_ai_primary),
            overrideShared: Boolean(krs.user_override_ai_shared),
          };
        }
      } catch { /* best-effort */ }
    }
    const selectedValue = fieldState?.selected?.value;
    const selectedValueNorm = String(selectedValue ?? '').trim().toLowerCase();
    const hasSelectedValue = hasKnownValue(selectedValue);
    const selectedCandidateId = String(
      keyReview?.selectedCandidateId
      || fieldState?.accepted_candidate_id
      || '',
    ).trim();
    const existingIds = new Set(allCandidates.map((candidate) => String(candidate?.candidate_id || '').trim()).filter(Boolean));
    const hasSelectedId = selectedCandidateId ? existingIds.has(selectedCandidateId) : false;
    const hasSelectedValueCandidate = hasSelectedValue
      && allCandidates.some((candidate) => String(candidate?.value ?? '').trim().toLowerCase() === selectedValueNorm);
    const sourceTokenRaw = String(fieldState?.source || '').trim().toLowerCase();
    const sourceId = sourceTokenRaw === 'excel import'
      || sourceTokenRaw === 'workbook'
      || sourceTokenRaw === 'component_db'
      || sourceTokenRaw === 'known_values'
      ? 'workbook'
      : (sourceTokenRaw.startsWith('pipeline')
          ? 'pipeline'
          : (sourceTokenRaw === 'manual' || sourceTokenRaw === 'user' ? 'user' : sourceTokenRaw));
    const sourceLabel = sourceId === 'workbook'
      ? 'Excel Import'
      : (sourceId === 'pipeline'
          ? 'Pipeline'
          : (String(fieldState?.source || '').trim() || sourceId || 'Pipeline'));
    const selectedConfidence = Number.isFinite(Number(fieldState?.selected?.confidence))
      ? Math.max(0, Math.min(1, Number(fieldState.selected.confidence)))
      : 0.5;
    const selectedEvidenceUrl = String(fieldState?.evidence_url || '').trim();
    const selectedEvidenceQuote = String(fieldState?.evidence_quote || '').trim()
      || 'Selected value retained from slot state';
    const ensureSelectedCandidate = (candidateId) => {
      const cid = String(candidateId || '').trim();
      if (!cid || existingIds.has(cid) || !hasSelectedValue) return;
      existingIds.add(cid);
      allCandidates.push({
        candidate_id: cid,
        value: selectedValue,
        score: selectedConfidence,
        source_id: sourceId || '',
        source: sourceLabel,
        tier: null,
        method: sourceId === 'workbook' ? 'workbook_import' : (sourceId === 'user' ? 'manual_override' : 'selected_value'),
        is_synthetic_selected: true,
        evidence: {
          url: selectedEvidenceUrl,
          retrieved_at: String(fieldState?.source_timestamp || '').trim(),
          snippet_id: '',
          snippet_hash: '',
          quote: selectedEvidenceQuote,
          quote_span: null,
          snippet_text: selectedEvidenceQuote,
          source_id: sourceId || '',
        },
      });
    };
    if (hasSelectedValue && selectedCandidateId && !hasSelectedId) {
      ensureSelectedCandidate(selectedCandidateId);
    }
    if (hasSelectedValue && !hasSelectedValueCandidate) {
      ensureSelectedCandidate(`selected_${slugify(productId || 'product')}_${slugify(resolvedField || 'field')}`);
    }
    if (specDb) {
      const reviewRows = itemFieldStateId
        ? (specDb.getReviewsForContext('item', String(itemFieldStateId)) || [])
        : [];
      annotateCandidatePrimaryReviews(allCandidates, reviewRows);
    }
    allCandidates.sort((a, b) => {
      const aScore = Number.parseFloat(String(a?.score ?? ''));
      const bScore = Number.parseFloat(String(b?.score ?? ''));
      const left = Number.isFinite(aScore) ? aScore : 0;
      const right = Number.isFinite(bScore) ? bScore : 0;
      if (right !== left) return right - left;
      return String(a?.candidate_id || '').localeCompare(String(b?.candidate_id || ''));
    });
    return jsonRes(res, 200, {
      product_id: productId,
      field: resolvedField,
      candidates: allCandidates,
      candidate_count: allCandidates.length,
      keyReview,
    });
  }

  const handledReviewItemMutation = await handleReviewItemMutationRoute({
    parts,
    method,
    req,
    res,
    context: {
      storage,
      config,
      readJsonBody,
      jsonRes,
      getSpecDb,
      resolveGridFieldStateForMutation,
      setOverrideFromCandidate,
      setManualOverride,
      syncPrimaryLaneAcceptFromItemSelection,
      resolveKeyReviewForLaneMutation,
      getPendingItemPrimaryCandidateIds,
      markPrimaryLaneReviewedInItemState,
      syncItemFieldStateFromPrimaryLaneAccept,
      isMeaningfulValue,
      propagateSharedLaneDecision,
      broadcastWs,
    },
  });
  if (handledReviewItemMutation) return;
  // Review suggest â€” submit suggestion feedback
  if (parts[0] === 'review' && parts[1] && parts[2] === 'suggest' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { type, field, value, evidenceUrl, evidenceQuote, canonical, reason, reviewer, productId } = body;
    if (!type || !field || !value) return jsonRes(res, 400, { error: 'type, field, and value required' });
    const cliArgs = ['src/cli/spec.js', 'review', 'suggest', '--category', category, '--type', type, '--field', field, '--value', String(value)];
    if (evidenceUrl) cliArgs.push('--evidence-url', String(evidenceUrl));
    if (evidenceQuote) cliArgs.push('--evidence-quote', String(evidenceQuote));
    if (canonical) cliArgs.push('--canonical', String(canonical));
    if (reason) cliArgs.push('--reason', String(reason));
    if (reviewer) cliArgs.push('--reviewer', String(reviewer));
    if (productId) cliArgs.push('--product-id', String(productId));
    cliArgs.push('--local');
    try {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('node', cliArgs, { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
      });
      broadcastWs('data-change', { type: 'review-suggest', category });
      return jsonRes(res, 200, { ok: true, output: result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'suggest_failed', message: err.message });
    }
  }

  // â”€â”€ Review Components endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Layout â€” list component types with property columns
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'layout' && method === 'GET') {
    const category = parts[1];
    const runtimeSpecDb = await getSpecDbReady(category);
    if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const layout = await buildComponentReviewLayout({ config, category, specDb: runtimeSpecDb });
    return jsonRes(res, 200, layout);
  }

  // Component items for a specific type
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'components' && method === 'GET') {
    const category = parts[1];
    const componentType = params.get('type') || '';
    if (!componentType) return jsonRes(res, 400, { error: 'type parameter required' });
    const specDb = await getSpecDbReady(category);
    if (!specDb || !specDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const payload = await buildComponentReviewPayloads({ config, category, componentType, specDb });
    return jsonRes(res, 200, payload);
  }

  // Enum review data
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'enums' && method === 'GET') {
    const category = parts[1];
    const specDb = await getSpecDbReady(category);
    if (!specDb || !specDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const payload = await buildEnumReviewPayloads({ config, category, specDb });
    return jsonRes(res, 200, payload);
  }

  const handledReviewComponentMutation = await handleReviewComponentMutationRoute({
    parts,
    method,
    req,
    res,
    context: {
      readJsonBody,
      jsonRes,
      getSpecDbReady,
      syncSyntheticCandidatesFromComponentReview,
      resolveComponentMutationContext,
      isMeaningfulValue,
      candidateLooksWorkbook,
      normalizeLower,
      buildComponentIdentifier,
      applySharedLaneState,
      cascadeComponentChange,
      outputRoot: OUTPUT_ROOT,
      storage,
      loadQueueState,
      saveQueueState,
      remapPendingComponentReviewItemsForNameChange,
      specDbCache,
      broadcastWs,
      getPendingComponentSharedCandidateIdsAsync,
    },
  });
  if (handledReviewComponentMutation !== false) return;

  const handledReviewEnumMutation = await handleReviewEnumMutationRoute({
    parts,
    method,
    req,
    res,
    context: {
      readJsonBody,
      jsonRes,
      getSpecDbReady,
      syncSyntheticCandidatesFromComponentReview,
      resolveEnumMutationContext,
      isMeaningfulValue,
      normalizeLower,
      candidateLooksWorkbook,
      applySharedLaneState,
      getPendingEnumSharedCandidateIds,
      specDbCache,
      storage,
      outputRoot: OUTPUT_ROOT,
      cascadeEnumChange,
      loadQueueState,
      saveQueueState,
      markEnumSuggestionStatus,
      broadcastWs,
    },
  });
  if (handledReviewEnumMutation !== false) return;
  // Component impact analysis
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-impact' && method === 'GET') {
    const category = parts[1];
    const type = params.get('type') || '';
    const name = params.get('name') || '';
    if (!type || !name) return jsonRes(res, 400, { error: 'type and name parameters required' });
    const runtimeSpecDb = getSpecDb(category);
    const affected = await findProductsReferencingComponent({
      outputRoot: OUTPUT_ROOT,
      category,
      componentType: type,
      componentName: name,
      specDb: runtimeSpecDb,
    });
    return jsonRes(res, 200, { affected_products: affected, total: affected.length });
  }

  // â”€â”€ Component AI Review endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Get component review items (flagged for AI/human review)
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-review' && method === 'GET') {
    const category = parts[1];
    const filePath = componentReviewPath({ config, category });
    const data = await safeReadJson(filePath);
    return jsonRes(res, 200, data || { version: 1, category, items: [], updated_at: null });
  }

  // Component review action (approve_new, merge_alias, dismiss)
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-review-action' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { review_id, action, merge_target } = body;
    if (!review_id || !action) return jsonRes(res, 400, { error: 'review_id and action required' });

    const filePath = componentReviewPath({ config, category });
    const data = await safeReadJson(filePath);
    if (!data || !Array.isArray(data.items)) return jsonRes(res, 404, { error: 'No review data found' });

    const item = data.items.find((i) => i.review_id === review_id);
    if (!item) return jsonRes(res, 404, { error: 'Review item not found' });

    if (action === 'approve_new') {
      item.status = 'approved_new';
    } else if (action === 'merge_alias' && merge_target) {
      item.status = 'accepted_alias';
      item.matched_component = merge_target;
      // Write alias to overrides
      const slug = String(merge_target).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const overrideDir = path.join(HELPER_ROOT, category, '_overrides', 'components');
      await fs.mkdir(overrideDir, { recursive: true });
      const overridePath = path.join(overrideDir, `${item.component_type}_${slug}.json`);
      const existing = await safeReadJson(overridePath) || { componentType: item.component_type, name: merge_target, properties: {} };
      if (!existing.identity) existing.identity = {};
      const aliases = Array.isArray(existing.identity.aliases) ? existing.identity.aliases : [];
      const alias = String(item.raw_query).trim();
      if (alias && !aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) {
        aliases.push(alias);
        existing.identity.aliases = aliases;
      }
      existing.updated_at = new Date().toISOString();
      await fs.writeFile(overridePath, JSON.stringify(existing, null, 2));
      invalidateFieldRulesCache(category);
      // Dual-write alias to SpecDb
      const specDb = getSpecDb(category);
      if (specDb && alias) {
        try {
          const idRow = specDb.db.prepare(
            'SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?'
          ).get(specDb.category, item.component_type, merge_target, '');
          if (idRow) {
            specDb.insertAlias(idRow.id, alias, 'user');
          }
          specDbCache.delete(category);
        } catch (_specDbErr) {
          return jsonRes(res, 500, {
            error: 'component_review_alias_specdb_write_failed',
            message: _specDbErr?.message || 'SpecDb write failed',
          });
        }
      }
    } else if (action === 'dismiss') {
      item.status = 'dismissed';
    } else {
      return jsonRes(res, 400, { error: `Unknown action: ${action}` });
    }

    item.human_reviewed_at = new Date().toISOString();
    data.updated_at = new Date().toISOString();
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    broadcastWs('data-change', { type: 'component-review', category });

    return jsonRes(res, 200, { ok: true, review_id, action, status: item.status });
  }

  // Manually trigger AI batch review
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'run-component-review-batch' && method === 'POST') {
    const category = parts[1];
    try {
      const result = await runComponentReviewBatch({ config, category, logger: null });
      // AI batch may write alias overrides â€” invalidate cache so next product run picks them up
      if (result.accepted_alias > 0) invalidateFieldRulesCache(category);
      broadcastWs('data-change', { type: 'component-review', category });
      return jsonRes(res, 200, result);
    } catch (err) {
      return jsonRes(res, 500, { error: err.message });
    }
  }

  // SearXNG runtime controls
  if (parts[0] === 'searxng' && parts[1] === 'status' && method === 'GET') {
    try {
      const status = await getSearxngStatus();
      return jsonRes(res, 200, status);
    } catch (err) {
      return jsonRes(res, 500, {
        error: 'searxng_status_failed',
        message: err?.message || 'searxng_status_failed'
      });
    }
  }

  if (parts[0] === 'searxng' && parts[1] === 'start' && method === 'POST') {
    try {
      const startResult = await startSearxngStack();
      if (!startResult.ok) {
        return jsonRes(res, 500, {
          error: startResult.error || 'searxng_start_failed',
          status: startResult.status || null
        });
      }
      return jsonRes(res, 200, startResult);
    } catch (err) {
      return jsonRes(res, 500, {
        error: 'searxng_start_failed',
        message: err?.message || 'searxng_start_failed'
      });
    }
  }

  // Process control â€” IndexLab mode only
  if (parts[0] === 'process' && parts[1] === 'start' && method === 'POST') {
    const body = await readJsonBody(req);
    const {
      category,
      productId,
      mode = 'indexlab',          // indexlab only
      extractionMode,             // balanced | aggressive | uber_aggressive
      profile,                    // fast | standard | thorough
      dryRun,                     // boolean â€” simulation mode
      fetchConcurrency,           // number - phase 05 fetch parallelism cap
      perHostMinDelayMs,          // number - phase 05 per-host throttle delay
      dynamicCrawleeEnabled,      // boolean - force Crawlee fetch mode when HTTP is not preferred
      crawleeHeadless,            // boolean - run Crawlee browser headless/non-headless
      crawleeRequestHandlerTimeoutSecs, // number - per-request Crawlee handler timeout
      dynamicFetchRetryBudget,    // number - retries for dynamic fetch failures
      dynamicFetchRetryBackoffMs, // number - retry backoff in milliseconds
      dynamicFetchPolicyMapJson,  // string - optional domain policy json
      scannedPdfOcrEnabled,       // boolean - enable scanned PDF OCR lane
      scannedPdfOcrPromoteCandidates, // boolean - promote OCR rows to candidate lanes
      scannedPdfOcrBackend,       // auto | tesseract | none
      scannedPdfOcrMaxPages,      // number - max OCR pages per PDF
      scannedPdfOcrMaxPairs,      // number - max OCR pairs per PDF
      scannedPdfOcrMinCharsPerPage, // number - scanned detection chars/page threshold
      scannedPdfOcrMinLinesPerPage, // number - scanned detection lines/page threshold
      scannedPdfOcrMinConfidence, // number - OCR low-confidence threshold
      resumeMode,                 // auto | force_resume | start_over
      resumeWindowHours,          // number â€” max age window for resume state
      reextractAfterHours,        // number â€” re-extract successful URLs older than this
      reextractIndexed,
      discoveryEnabled,           // boolean â€” enable provider discovery for this run
      searchProvider,             // none|google|bing|searxng|duckduckgo|dual
      phase2LlmEnabled,
      phase2LlmModel,
      phase3LlmTriageEnabled,
      phase3LlmModel,
      llmModelPlan,
      llmModelFast,
      llmModelTriage,
      llmModelReasoning,
      llmModelExtract,
      llmModelValidate,
      llmModelWrite,
      llmTokensPlan,
      llmTokensFast,
      llmTokensTriage,
      llmTokensReasoning,
      llmTokensExtract,
      llmTokensValidate,
      llmTokensWrite,
      llmFallbackEnabled,
      llmPlanFallbackModel,
      llmExtractFallbackModel,
      llmValidateFallbackModel,
      llmWriteFallbackModel,
      llmTokensPlanFallback,
      llmTokensExtractFallback,
      llmTokensValidateFallback,
      llmTokensWriteFallback,
      seed,
      fields,
      providers,
      indexlabOut,
      replaceRunning = true       // boolean â€” stop existing process before starting new one
    } = body;
    const cat = category || 'mouse';

    if (String(mode || 'indexlab').trim() !== 'indexlab') {
      return jsonRes(res, 400, {
        error: 'unsupported_process_mode',
        message: 'Only indexlab mode is supported in GUI process/start.'
      });
    }

    const cliArgs = ['indexlab', '--local'];

    cliArgs.push('--category', cat);

    if (productId) {
      cliArgs.push('--product-id', String(productId).trim());
    } else if (seed) {
      cliArgs.push('--seed', String(seed).trim());
    }
    const normalizedFields = Array.isArray(fields)
      ? fields.map((value) => String(value || '').trim()).filter(Boolean).join(',')
      : String(fields || '').trim();
    if (normalizedFields) {
      cliArgs.push('--fields', normalizedFields);
    }
    const normalizedProviders = Array.isArray(providers)
      ? providers.map((value) => String(value || '').trim()).filter(Boolean).join(',')
      : String(providers || '').trim();
    if (normalizedProviders) {
      cliArgs.push('--providers', normalizedProviders);
    }
    const hasDiscoveryOverride = typeof discoveryEnabled === 'boolean';
    if (hasDiscoveryOverride) {
      cliArgs.push('--discovery-enabled', discoveryEnabled ? 'true' : 'false');
    }
    const normalizedSearchProvider = String(searchProvider || '').trim().toLowerCase();
    if (normalizedSearchProvider) {
      const allowedSearchProviders = new Set(['none', 'google', 'bing', 'searxng', 'duckduckgo', 'dual']);
      if (!allowedSearchProviders.has(normalizedSearchProvider)) {
        return jsonRes(res, 400, {
          error: 'invalid_search_provider',
          message: `Unsupported searchProvider '${normalizedSearchProvider}'.`
        });
      }
      cliArgs.push('--search-provider', normalizedSearchProvider);
    }
    if (hasDiscoveryOverride && discoveryEnabled && (!normalizedSearchProvider || normalizedSearchProvider === 'none')) {
      return jsonRes(res, 400, {
        error: 'discovery_provider_required',
        message: 'discoveryEnabled=true requires searchProvider (google|bing|searxng|duckduckgo|dual).'
      });
    }
    if (indexlabOut) {
      cliArgs.push('--out', String(indexlabOut).trim());
    }

    // Extraction mode (--mode flag)
    if (extractionMode && ['balanced', 'aggressive', 'uber_aggressive'].includes(extractionMode)) {
      cliArgs.push('--mode', extractionMode);
    }

    // Run profile (fast / standard / thorough)
    if (profile && ['fast', 'standard', 'thorough'].includes(profile)) {
      cliArgs.push('--profile', profile);
    }

    // Dry run
    if (dryRun) {
      cliArgs.push('--dry-run');
    }

    const envOverrides = {};
    if (['auto', 'force_resume', 'start_over'].includes(String(resumeMode || '').trim())) {
      envOverrides.INDEXING_RESUME_MODE = String(resumeMode).trim();
    }
    const parsedResumeWindowHours = Number.parseInt(String(resumeWindowHours ?? ''), 10);
    if (Number.isFinite(parsedResumeWindowHours) && parsedResumeWindowHours >= 0) {
      envOverrides.INDEXING_RESUME_MAX_AGE_HOURS = String(parsedResumeWindowHours);
    }
    const parsedReextractAfterHours = Number.parseInt(String(reextractAfterHours ?? ''), 10);
    if (Number.isFinite(parsedReextractAfterHours) && parsedReextractAfterHours >= 0) {
      envOverrides.INDEXING_REEXTRACT_AFTER_HOURS = String(parsedReextractAfterHours);
    }
    if (typeof reextractIndexed === 'boolean') {
      envOverrides.INDEXING_REEXTRACT_ENABLED = reextractIndexed ? 'true' : 'false';
    }
    const parsedFetchConcurrency = Number.parseInt(String(fetchConcurrency ?? ''), 10);
    if (Number.isFinite(parsedFetchConcurrency) && parsedFetchConcurrency > 0) {
      envOverrides.CONCURRENCY = String(Math.max(1, Math.min(64, parsedFetchConcurrency)));
    }
    const parsedPerHostDelay = Number.parseInt(String(perHostMinDelayMs ?? ''), 10);
    if (Number.isFinite(parsedPerHostDelay) && parsedPerHostDelay >= 0) {
      envOverrides.PER_HOST_MIN_DELAY_MS = String(Math.max(0, Math.min(120_000, parsedPerHostDelay)));
    }
    if (typeof dynamicCrawleeEnabled === 'boolean') {
      envOverrides.DYNAMIC_CRAWLEE_ENABLED = dynamicCrawleeEnabled ? 'true' : 'false';
    }
    if (typeof crawleeHeadless === 'boolean') {
      envOverrides.CRAWLEE_HEADLESS = crawleeHeadless ? 'true' : 'false';
    }
    const parsedCrawleeTimeoutSecs = Number.parseInt(String(crawleeRequestHandlerTimeoutSecs ?? ''), 10);
    if (Number.isFinite(parsedCrawleeTimeoutSecs) && parsedCrawleeTimeoutSecs >= 0) {
      envOverrides.CRAWLEE_REQUEST_HANDLER_TIMEOUT_SECS = String(Math.max(0, Math.min(300, parsedCrawleeTimeoutSecs)));
    }
    const parsedDynamicRetryBudget = Number.parseInt(String(dynamicFetchRetryBudget ?? ''), 10);
    if (Number.isFinite(parsedDynamicRetryBudget) && parsedDynamicRetryBudget >= 0) {
      envOverrides.DYNAMIC_FETCH_RETRY_BUDGET = String(Math.max(0, Math.min(5, parsedDynamicRetryBudget)));
    }
    const parsedDynamicRetryBackoffMs = Number.parseInt(String(dynamicFetchRetryBackoffMs ?? ''), 10);
    if (Number.isFinite(parsedDynamicRetryBackoffMs) && parsedDynamicRetryBackoffMs >= 0) {
      envOverrides.DYNAMIC_FETCH_RETRY_BACKOFF_MS = String(Math.max(0, Math.min(30_000, parsedDynamicRetryBackoffMs)));
    }
    const normalizedDynamicFetchPolicyMap = String(dynamicFetchPolicyMapJson || '').trim();
    if (normalizedDynamicFetchPolicyMap) {
      try {
        const parsedDynamicFetchPolicyMap = JSON.parse(normalizedDynamicFetchPolicyMap);
        if (!parsedDynamicFetchPolicyMap || Array.isArray(parsedDynamicFetchPolicyMap) || typeof parsedDynamicFetchPolicyMap !== 'object') {
          return jsonRes(res, 400, {
            error: 'invalid_dynamic_fetch_policy_json',
            message: 'dynamicFetchPolicyMapJson must be a JSON object.'
          });
        }
        envOverrides.DYNAMIC_FETCH_POLICY_MAP_JSON = JSON.stringify(parsedDynamicFetchPolicyMap);
      } catch {
        return jsonRes(res, 400, {
          error: 'invalid_dynamic_fetch_policy_json',
          message: 'dynamicFetchPolicyMapJson must be valid JSON.'
        });
      }
    }
    if (typeof scannedPdfOcrEnabled === 'boolean') {
      envOverrides.SCANNED_PDF_OCR_ENABLED = scannedPdfOcrEnabled ? 'true' : 'false';
    }
    if (typeof scannedPdfOcrPromoteCandidates === 'boolean') {
      envOverrides.SCANNED_PDF_OCR_PROMOTE_CANDIDATES = scannedPdfOcrPromoteCandidates ? 'true' : 'false';
    }
    const normalizedScannedOcrBackend = String(scannedPdfOcrBackend || '').trim().toLowerCase();
    if (normalizedScannedOcrBackend) {
      const allowedScannedOcrBackends = new Set(['auto', 'tesseract', 'none']);
      if (!allowedScannedOcrBackends.has(normalizedScannedOcrBackend)) {
        return jsonRes(res, 400, {
          error: 'invalid_scanned_pdf_ocr_backend',
          message: `Unsupported scannedPdfOcrBackend '${normalizedScannedOcrBackend}'.`
        });
      }
      envOverrides.SCANNED_PDF_OCR_BACKEND = normalizedScannedOcrBackend;
    }
    const parsedScannedOcrMaxPages = Number.parseInt(String(scannedPdfOcrMaxPages ?? ''), 10);
    if (Number.isFinite(parsedScannedOcrMaxPages) && parsedScannedOcrMaxPages >= 1) {
      envOverrides.SCANNED_PDF_OCR_MAX_PAGES = String(Math.max(1, Math.min(100, parsedScannedOcrMaxPages)));
    }
    const parsedScannedOcrMaxPairs = Number.parseInt(String(scannedPdfOcrMaxPairs ?? ''), 10);
    if (Number.isFinite(parsedScannedOcrMaxPairs) && parsedScannedOcrMaxPairs >= 50) {
      envOverrides.SCANNED_PDF_OCR_MAX_PAIRS = String(Math.max(50, Math.min(20_000, parsedScannedOcrMaxPairs)));
    }
    const parsedScannedOcrMinChars = Number.parseInt(String(scannedPdfOcrMinCharsPerPage ?? ''), 10);
    if (Number.isFinite(parsedScannedOcrMinChars) && parsedScannedOcrMinChars >= 1) {
      envOverrides.SCANNED_PDF_OCR_MIN_CHARS_PER_PAGE = String(Math.max(1, Math.min(500, parsedScannedOcrMinChars)));
    }
    const parsedScannedOcrMinLines = Number.parseInt(String(scannedPdfOcrMinLinesPerPage ?? ''), 10);
    if (Number.isFinite(parsedScannedOcrMinLines) && parsedScannedOcrMinLines >= 1) {
      envOverrides.SCANNED_PDF_OCR_MIN_LINES_PER_PAGE = String(Math.max(1, Math.min(100, parsedScannedOcrMinLines)));
    }
    const parsedScannedOcrMinConfidence = Number.parseFloat(String(scannedPdfOcrMinConfidence ?? ''));
    if (Number.isFinite(parsedScannedOcrMinConfidence) && parsedScannedOcrMinConfidence >= 0) {
      const clampedConfidence = Math.max(0, Math.min(1, parsedScannedOcrMinConfidence));
      envOverrides.SCANNED_PDF_OCR_MIN_CONFIDENCE = String(clampedConfidence);
    }
    const hasPhase2LlmOverride = typeof phase2LlmEnabled === 'boolean';
    if (hasPhase2LlmOverride) {
      envOverrides.LLM_PLAN_DISCOVERY_QUERIES = phase2LlmEnabled ? 'true' : 'false';
    }
    const normalizedPhase2LlmModel = String(phase2LlmModel || '').trim();
    if (normalizedPhase2LlmModel) {
      envOverrides.LLM_MODEL_PLAN = normalizedPhase2LlmModel;
    }
    const hasPhase3LlmOverride = typeof phase3LlmTriageEnabled === 'boolean';
    if (hasPhase3LlmOverride) {
      envOverrides.LLM_SERP_RERANK_ENABLED = phase3LlmTriageEnabled ? 'true' : 'false';
    }
    const normalizedPhase3LlmModel = String(phase3LlmModel || '').trim();
    if (normalizedPhase3LlmModel) {
      envOverrides.LLM_MODEL_TRIAGE = normalizedPhase3LlmModel;
      envOverrides.CORTEX_MODEL_RERANK_FAST = normalizedPhase3LlmModel;
    }

    const applyModelOverride = (envKey, value, { allowEmpty = false } = {}) => {
      if (value === undefined || value === null) return false;
      const token = String(value || '').trim();
      if (!token && !allowEmpty) return false;
      envOverrides[envKey] = token;
      return Boolean(token);
    };
    const applyTokenOverride = (envKey, value) => {
      if (value === undefined || value === null || value === '') return false;
      const parsed = Number.parseInt(String(value), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return false;
      envOverrides[envKey] = String(parsed);
      return true;
    };

    const hasRoleModelOverride = [
      applyModelOverride('LLM_MODEL_PLAN', llmModelPlan),
      applyModelOverride('LLM_MODEL_FAST', llmModelFast),
      applyModelOverride('LLM_MODEL_TRIAGE', llmModelTriage),
      applyModelOverride('LLM_MODEL_REASONING', llmModelReasoning),
      applyModelOverride('LLM_MODEL_EXTRACT', llmModelExtract),
      applyModelOverride('LLM_MODEL_VALIDATE', llmModelValidate),
      applyModelOverride('LLM_MODEL_WRITE', llmModelWrite)
    ].some(Boolean);

    const normalizedTriageForCortex = String(llmModelTriage || '').trim();
    if (normalizedTriageForCortex) {
      envOverrides.CORTEX_MODEL_RERANK_FAST = normalizedTriageForCortex;
      envOverrides.CORTEX_MODEL_SEARCH_FAST = normalizedTriageForCortex;
    }

    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_PLAN', llmTokensPlan);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_FAST', llmTokensFast);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_TRIAGE', llmTokensTriage);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_REASONING', llmTokensReasoning);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_EXTRACT', llmTokensExtract);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_VALIDATE', llmTokensValidate);
    applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_WRITE', llmTokensWrite);

    const hasFallbackToggle = typeof llmFallbackEnabled === 'boolean';
    if (hasFallbackToggle && !llmFallbackEnabled) {
      envOverrides.LLM_PLAN_FALLBACK_MODEL = '';
      envOverrides.LLM_EXTRACT_FALLBACK_MODEL = '';
      envOverrides.LLM_VALIDATE_FALLBACK_MODEL = '';
      envOverrides.LLM_WRITE_FALLBACK_MODEL = '';
      envOverrides.LLM_MAX_OUTPUT_TOKENS_PLAN_FALLBACK = '';
      envOverrides.LLM_MAX_OUTPUT_TOKENS_EXTRACT_FALLBACK = '';
      envOverrides.LLM_MAX_OUTPUT_TOKENS_VALIDATE_FALLBACK = '';
      envOverrides.LLM_MAX_OUTPUT_TOKENS_WRITE_FALLBACK = '';
    } else {
      applyModelOverride('LLM_PLAN_FALLBACK_MODEL', llmPlanFallbackModel, { allowEmpty: true });
      applyModelOverride('LLM_EXTRACT_FALLBACK_MODEL', llmExtractFallbackModel, { allowEmpty: true });
      applyModelOverride('LLM_VALIDATE_FALLBACK_MODEL', llmValidateFallbackModel, { allowEmpty: true });
      applyModelOverride('LLM_WRITE_FALLBACK_MODEL', llmWriteFallbackModel, { allowEmpty: true });
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_PLAN_FALLBACK', llmTokensPlanFallback);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_EXTRACT_FALLBACK', llmTokensExtractFallback);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_VALIDATE_FALLBACK', llmTokensValidateFallback);
      applyTokenOverride('LLM_MAX_OUTPUT_TOKENS_WRITE_FALLBACK', llmTokensWriteFallback);
    }

    if (
      (hasPhase2LlmOverride && phase2LlmEnabled)
      || (hasPhase3LlmOverride && phase3LlmTriageEnabled)
      || hasRoleModelOverride
    ) {
      envOverrides.LLM_ENABLED = 'true';
    }

    try {
      if (replaceRunning && isProcessRunning()) {
        await stopProcess(9000);
        const exited = await waitForProcessExit(8000);
        if (!exited && isProcessRunning()) {
          return jsonRes(res, 409, { error: 'process_replace_timeout', message: 'Existing process did not stop in time' });
        }
      }
      const status = startProcess('src/cli/spec.js', cliArgs, envOverrides);
      return jsonRes(res, 200, status);
    } catch (err) {
      return jsonRes(res, 409, { error: err.message });
    }
  }

  if (parts[0] === 'process' && parts[1] === 'stop' && method === 'POST') {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const force = Boolean(body?.force);
    const status = await stopProcess(9000, { force });
    return jsonRes(res, 200, status);
  }

  if (parts[0] === 'process' && parts[1] === 'status' && method === 'GET') {
    return jsonRes(res, 200, processStatus());
  }

  // GraphQL proxy
  if (parts[0] === 'graphql' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const proxyRes = await fetch(`http://localhost:8787/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const proxyData = await proxyRes.json();
      return jsonRes(res, proxyRes.status, proxyData);
    } catch {
      return jsonRes(res, 502, { error: 'graphql_proxy_failed' });
    }
  }

  // â”€â”€ Brand Registry API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // GET /api/v1/brands?category=mouse  (optional filter)
  if (parts[0] === 'brands' && method === 'GET' && !parts[1]) {
    const registry = await loadBrandRegistry(config);
    const category = resolveCategoryAlias(params.get('category'));
    if (category) {
      return jsonRes(res, 200, getBrandsForCategory(registry, category));
    }
    const all = Object.entries(registry.brands || {})
      .map(([slug, brand]) => ({ slug, ...brand }))
      .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    return jsonRes(res, 200, all);
  }

  // POST /api/v1/brands/seed  â€” auto-seed from activeFiltering
  // Accepts optional { category } body â€” 'all' or omitted scans all, otherwise just that category.
  // (must come before the generic POST /brands route)
  if (parts[0] === 'brands' && parts[1] === 'seed' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await seedBrandsFromActiveFiltering({ config, category: body.category || 'all' });
    return jsonRes(res, 200, result);
  }

  // GET /api/v1/brands/{slug}/impact â€” impact analysis for rename/delete
  if (parts[0] === 'brands' && parts[1] && parts[2] === 'impact' && method === 'GET') {
    const result = await getBrandImpactAnalysis({ config, slug: parts[1] });
    return jsonRes(res, result.ok ? 200 : 404, result);
  }

  // POST /api/v1/brands  { name, aliases, categories, website }
  if (parts[0] === 'brands' && method === 'POST' && !parts[1]) {
    const body = await readJsonBody(req);
    const result = await addBrand({
      config,
      name: body.name,
      aliases: body.aliases,
      categories: body.categories,
      website: body.website
    });
    return jsonRes(res, result.ok ? 201 : 400, result);
  }

  // PUT /api/v1/brands/{slug}  { name?, aliases?, categories?, website? }
  if (parts[0] === 'brands' && parts[1] && method === 'PUT') {
    const body = await readJsonBody(req);
    const brandSlug = parts[1];

    // Detect rename: if body.name is provided and differs from current canonical_name
    if (body.name !== undefined) {
      const registry = await loadBrandRegistry(config);
      const existing = registry.brands[brandSlug];
      if (!existing) return jsonRes(res, 404, { ok: false, error: 'brand_not_found', slug: brandSlug });

      if (String(body.name).trim() !== existing.canonical_name) {
        // Name changed â€” cascade rename first
        const renameResult = await renameBrand({
          config,
          slug: brandSlug,
          newName: body.name,
          storage,
          upsertQueue: upsertQueueProduct
        });
        if (!renameResult.ok && renameResult.error) {
          return jsonRes(res, 400, renameResult);
        }

        // Apply remaining non-name patches (aliases, categories, website) to the new slug
        const remainingPatch = {};
        if (body.aliases !== undefined) remainingPatch.aliases = body.aliases;
        if (body.categories !== undefined) remainingPatch.categories = body.categories;
        if (body.website !== undefined) remainingPatch.website = body.website;

        if (Object.keys(remainingPatch).length > 0) {
          await updateBrand({ config, slug: renameResult.newSlug, patch: remainingPatch });
        }

        return jsonRes(res, 200, renameResult);
      }
    }

    // No rename â€” standard update
    const result = await updateBrand({ config, slug: brandSlug, patch: body });
    return jsonRes(res, result.ok ? 200 : 404, result);
  }

  // DELETE /api/v1/brands/{slug}
  if (parts[0] === 'brands' && parts[1] && method === 'DELETE') {
    const force = params.get('force') === 'true';
    const result = await removeBrand({ config, slug: parts[1], force });
    let status = 404;
    if (result.ok) status = 200;
    else if (result.error === 'brand_in_use') status = 409;
    return jsonRes(res, status, result);
  }

  // â”€â”€ Test Mode API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // POST /api/v1/test-mode/create  { sourceCategory }
  if (parts[0] === 'test-mode' && parts[1] === 'create' && method === 'POST') {
    const body = await readJsonBody(req);
    const sourceCategory = body.sourceCategory || 'mouse';
    const testCategory = `_test_${sourceCategory}`;
    const sourceDir = path.join(HELPER_ROOT, sourceCategory, '_generated');
    const sourceStat = await safeStat(sourceDir);
    if (!sourceStat) return jsonRes(res, 400, { ok: false, error: 'source_category_not_found', sourceCategory });

    const testDir = path.join(HELPER_ROOT, testCategory);
    const genDir = path.join(testDir, '_generated');
    const compDbDir = path.join(genDir, 'component_db');
    await fs.mkdir(genDir, { recursive: true });
    await fs.mkdir(compDbDir, { recursive: true });
    await fs.mkdir(path.join(testDir, '_control_plane'), { recursive: true });
    await fs.mkdir(path.join(testDir, '_overrides'), { recursive: true });
    await fs.mkdir(path.join(testDir, '_suggestions'), { recursive: true });

    // Copy generated rule files with progress broadcasts
    const ruleFiles = ['field_rules.json', 'field_rules.runtime.json', 'known_values.json',
      'cross_validation_rules.json', 'parse_templates.json', 'ui_field_catalog.json',
      'key_migrations.json', 'field_groups.json', 'manifest.json'];

    broadcastWs('test-import-progress', { step: 'field_rules', status: 'copying', detail: `Copying ${ruleFiles.length} rule files` });
    let copiedRules = 0;
    for (const f of ruleFiles) {
      const src = path.join(sourceDir, f);
      const dest = path.join(genDir, f);
      try { await fs.copyFile(src, dest); copiedRules++; } catch { /* skip missing */ }
    }
    broadcastWs('test-import-progress', { step: 'field_rules', status: 'done', detail: `${copiedRules} rule files` });

    // Build seed component DBs from source contract analysis (5 deterministic items per type)
    let sourceAnalysis = null;
    try {
      sourceAnalysis = await analyzeContract(HELPER_ROOT, sourceCategory);
    } catch { /* non-fatal */ }

    if (sourceAnalysis) {
      const seedDBs = buildSeedComponentDB(sourceAnalysis, testCategory);
      for (const [dbFile, db] of Object.entries(seedDBs)) {
        broadcastWs('test-import-progress', { step: `component_db/${dbFile}`, status: 'copying', file: `${dbFile}.json` });
        await fs.writeFile(path.join(compDbDir, `${dbFile}.json`), JSON.stringify(db, null, 2));
        broadcastWs('test-import-progress', { step: `component_db/${dbFile}`, status: 'done', detail: `${db.items.length} seed items` });
      }
    } else {
      // Fallback: copy production component_db files if source analysis failed
      const sourceCompDb = path.join(sourceDir, 'component_db');
      const compFiles = await listFiles(sourceCompDb, '.json');
      for (const f of compFiles) {
        const compType = f.replace('.json', '');
        broadcastWs('test-import-progress', { step: `component_db/${compType}`, status: 'copying', file: f });
        await fs.copyFile(path.join(sourceCompDb, f), path.join(compDbDir, f));
        const compData = await safeReadJson(path.join(compDbDir, f));
        const itemCount = (compData?.items || compData?.entities || []).length;
        broadcastWs('test-import-progress', { step: `component_db/${compType}`, status: 'done', detail: `${itemCount} items` });
      }
    }

    // Create products directory in fixtures
    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', testCategory, 'products');
    await fs.mkdir(productsDir, { recursive: true });

    // Analyze the test category contract for summary (re-analyze after seeding)
    let contractSummary = null;
    try {
      const analysis = await analyzeContract(HELPER_ROOT, testCategory);
      contractSummary = analysis.summary;
      broadcastWs('test-import-progress', {
        step: 'complete',
        status: 'done',
        summary: {
          fields: analysis.summary.fieldCount,
          components: analysis.summary.componentTypes.length,
          componentItems: analysis.summary.componentTypes.reduce((s, c) => s + c.itemCount, 0),
          enums: analysis.summary.knownValuesCatalogs.length,
          rules: analysis.summary.crossValidationRules.length
        }
      });
    } catch { /* non-fatal */ }

    return jsonRes(res, 200, { ok: true, category: testCategory, contractSummary });
  }

  // GET /api/v1/test-mode/contract-summary?category=_test_mouse
  if (parts[0] === 'test-mode' && parts[1] === 'contract-summary' && method === 'GET') {
    const category = resolveCategoryAlias(params.get('category') || '');
    if (!category || !category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
    }

    try {
      const analysis = await analyzeContract(HELPER_ROOT, category);
      return jsonRes(res, 200, { ok: true, summary: analysis.summary, matrices: analysis.matrices, scenarioDefs: analysis.scenarioDefs });
    } catch (err) {
      return jsonRes(res, 500, { ok: false, error: err.message });
    }
  }

  // GET /api/v1/test-mode/status?sourceCategory=mouse â€” restore test mode state across navigations
  if (parts[0] === 'test-mode' && parts[1] === 'status' && method === 'GET') {
    const sourceCategory = params.get('sourceCategory') || 'mouse';
    const testCategory = `_test_${sourceCategory}`;
    const genDir = path.join(HELPER_ROOT, testCategory, '_generated');
    const genExists = await safeStat(genDir);

    if (!genExists) {
      return jsonRes(res, 200, { ok: true, exists: false, testCategory: '', testCases: [], runResults: [] });
    }

    // Category exists â€” read test products
    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', testCategory, 'products');
    const productFiles = await listFiles(productsDir, '.json').catch(() => []);
    const testCases = [];
    const runResults = [];

    for (const pf of productFiles) {
      const job = await safeReadJson(path.join(productsDir, pf));
      if (!job?._testCase) continue;
      testCases.push({
        id: job._testCase.id,
        name: job._testCase.name,
        description: job._testCase.description,
        category: job._testCase.category,
        productId: job.productId
      });

      // Check if run artifacts exist for this product
      try {
        const latest = await readLatestArtifacts(storage, testCategory, job.productId);
        const summary = latest.summary && typeof latest.summary === 'object'
          ? latest.summary
          : null;
        if (summary && Object.keys(summary).length > 0) {
          const confidence = toUnitRatio(summary.confidence) ?? toUnitRatio(summary.confidence_percent);
          const coverage = toUnitRatio(summary.coverage_overall) ?? toUnitRatio(summary.coverage_overall_percent);
          const completeness = toUnitRatio(summary.completeness_required) ?? toUnitRatio(summary.completeness_required_percent);
          const trafficLight = deriveTrafficLightCounts({ summary, provenance: latest.provenance });
          runResults.push({
            productId: job.productId,
            status: 'complete',
            testCase: job._testCase,
            confidence,
            coverage,
            completeness,
            trafficLight,
            constraintConflicts: summary?.constraint_analysis?.contradictionCount || summary?.constraint_analysis?.contradiction_count || 0,
            missingRequired: Array.isArray(summary?.missing_required_fields) ? summary.missing_required_fields : [],
            curationSuggestions: summary?.runtime_engine?.curation_suggestions_count || 0,
            runtimeFailures: (summary?.runtime_engine?.failures || []).length,
            durationMs: toInt(summary?.duration_ms, 0) || undefined
          });
        }
      } catch { /* no artifacts yet */ }
    }

    return jsonRes(res, 200, { ok: true, exists: true, testCategory, testCases, runResults });
  }

  // POST /api/v1/test-mode/generate-products  { category }
  if (parts[0] === 'test-mode' && parts[1] === 'generate-products' && method === 'POST') {
    const body = await readJsonBody(req);
    const category = resolveCategoryAlias(body.category);
    if (!category || !category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
    }

    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
    await fs.mkdir(productsDir, { recursive: true });

    // Build contract analysis to get dynamic scenario defs
    let contractAnalysis = null;
    try {
      contractAnalysis = await analyzeContract(HELPER_ROOT, category);
    } catch { /* non-fatal â€” will use default scenarios */ }

    const testProducts = buildTestProducts(category, contractAnalysis);
    const productIds = [];
    const testCases = [];

    for (const product of testProducts) {
      const filePath = path.join(productsDir, `${product.productId}.json`);
      await fs.writeFile(filePath, JSON.stringify(product, null, 2));
      productIds.push(product.productId);
      testCases.push({
        id: product._testCase.id,
        name: product._testCase.name,
        description: product._testCase.description,
        category: product._testCase.category,
        productId: product.productId
      });
    }

    // Build product_catalog.json so catalog/review/sidebar endpoints can find test products
    const catalogProducts = {};
    const testBrands = new Set();
    for (const product of testProducts) {
      const il = product.identityLock || {};
      const brandName = il.brand || 'TestCo';
      testBrands.add(brandName);
      catalogProducts[product.productId] = {
        id: il.id || 0,
        identifier: il.identifier || '',
        brand: brandName,
        model: il.model || '',
        variant: il.variant || '',
        status: 'active',
        seed_urls: [],
        added_at: new Date().toISOString(),
        added_by: 'test-mode'
      };
    }
    const catalogDir = path.join(HELPER_ROOT, category, '_control_plane');
    await fs.mkdir(catalogDir, { recursive: true });
    await fs.writeFile(
      path.join(catalogDir, 'product_catalog.json'),
      JSON.stringify({ _doc: 'Test mode product catalog', _version: 1, products: catalogProducts }, null, 2)
    );

    // Seed brands into the global brand registry so the Brands sub-tab shows data
    // Also add "TestNewBrand" used by new_* component scenarios
    testBrands.add('TestNewBrand');
    for (const brandName of testBrands) {
      const result = await addBrand({ config, name: brandName, aliases: [], categories: [category] });
      if (result.ok === false && result.error === 'brand_already_exists') {
        // Brand exists â€” ensure test category is in its categories list
        const registry = await loadBrandRegistry(config);
        const brand = registry.brands[result.slug];
        if (brand && !brand.categories.includes(category.toLowerCase())) {
          brand.categories.push(category.toLowerCase());
          await saveBrandRegistry(config, registry);
        }
      }
    }

    return jsonRes(res, 200, { ok: true, products: productIds, testCases });
  }

  // POST /api/v1/test-mode/run  { category, productId? }
  if (parts[0] === 'test-mode' && parts[1] === 'run' && method === 'POST') {
    const body = await readJsonBody(req);
    const category = resolveCategoryAlias(body.category);
    if (!category || !category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
    }

    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
    let productFiles;
    if (body.productId) {
      productFiles = [`${body.productId}.json`];
    } else {
      productFiles = await listFiles(productsDir, '.json');
    }
    const resetState = body?.resetState !== false;
    const runtimeSpecDb = await getSpecDbReady(category);
    if (resetState && runtimeSpecDb && !body.productId) {
      resetTestModeSharedReviewState(runtimeSpecDb, category);
    }

    // Read field rules + component DBs + known values for LLM prompt
    const fieldRulesPath = path.join(HELPER_ROOT, category, '_generated', 'field_rules.json');
    const knownValuesPath = path.join(HELPER_ROOT, category, '_generated', 'known_values.json');
    const compDbDir = path.join(HELPER_ROOT, category, '_generated', 'component_db');

    const fieldRules = await safeReadJson(fieldRulesPath) || {};
    const knownValues = await safeReadJson(knownValuesPath) || {};
    const componentDBs = {};
    const compFiles = await listFiles(compDbDir, '.json');
    for (const f of compFiles) {
      const data = await safeReadJson(path.join(compDbDir, f));
      if (data) componentDBs[data?.component_type || f.replace('.json', '')] = data;
    }

    // Build contract analysis for enhanced prompt generation
    let contractAnalysis = null;
    try {
      contractAnalysis = await analyzeContract(HELPER_ROOT, category);
    } catch { /* non-fatal */ }
    const generationOptions = (body && typeof body.generation === 'object' && body.generation !== null)
      ? body.generation
      : {};

    const results = [];
    for (const pf of productFiles) {
      const productPath = path.join(productsDir, pf);
      const job = await safeReadJson(productPath);
      if (!job) { results.push({ file: pf, error: 'read_failed' }); continue; }

      if (resetState && runtimeSpecDb) {
        resetTestModeProductReviewState(runtimeSpecDb, category, job.productId);
      }

      try {
        // Step 1: Generate source data (deterministic by default, LLM if requested)
        let sourceResults;
        if (body.useLlm) {
          sourceResults = await generateTestSourceResults({
            product: job,
            fieldRules,
            componentDBs,
            knownValues,
            config,
            contractAnalysis,
            generationOptions,
          });
        } else {
          sourceResults = buildDeterministicSourceResults({
            product: job,
            contractAnalysis,
            fieldRules,
            componentDBs,
            knownValues,
            generationOptions,
          });
        }

        // Step 2: Run through consensus + downstream pipeline
        const result = await runTestProduct({
          storage, config, job, sourceResults, category
        });
        results.push({ productId: job.productId, status: 'complete', ...result });
      } catch (err) {
        results.push({ productId: job.productId, status: 'error', error: err.message });
      }
    }

    // Optional AI review of flagged component matches
    if (body.aiReview) {
      try {
        await runComponentReviewBatch({ config, category, logger: null });
      } catch { /* non-fatal â€” AI review is optional */ }
    }

    const resyncSpecDb = body?.resyncSpecDb !== false;
    if (runtimeSpecDb && resyncSpecDb) {
      try {
        const { loadFieldRules } = await import('../field-rules/loader.js');
        const { seedSpecDb } = await import('../db/seed.js');
        const seedFieldRules = await loadFieldRules(category, { config });
        await seedSpecDb({ db: runtimeSpecDb, config, category, fieldRules: seedFieldRules });
      } catch (err) {
        results.push({
          status: 'warning',
          warning: 'specdb_resync_failed',
          error: err?.message || 'Unknown SpecDb resync error',
        });
      }
    }

    broadcastWs('data-change', { type: 'review', category });
    return jsonRes(res, 200, { ok: true, results });
  }

  // POST /api/v1/test-mode/validate  { category }
  if (parts[0] === 'test-mode' && parts[1] === 'validate' && method === 'POST') {
    const body = await readJsonBody(req);
    const category = resolveCategoryAlias(body.category);
    if (!category || !category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
    }

    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
    const productFiles = await listFiles(productsDir, '.json');
    const allChecks = [];
    let passed = 0;
    let failed = 0;

    // Read suggestion files once
    const suggestionsEnums = await safeReadJson(path.join(HELPER_ROOT, category, '_suggestions', 'enums.json')) || { suggestions: [] };
    const suggestionsComponents = await safeReadJson(path.join(HELPER_ROOT, category, '_suggestions', 'components.json')) || { suggestions: [] };

    // Build contract analysis to get dynamic scenario defs
    let contractAnalysis = null;
    try {
      contractAnalysis = await analyzeContract(HELPER_ROOT, category);
    } catch { /* non-fatal */ }
    const scenarioDefs = contractAnalysis?.scenarioDefs || null;

    for (const pf of productFiles) {
      const job = await safeReadJson(path.join(productsDir, pf));
      if (!job?._testCase) continue;

      const productId = job.productId;
      const testCase = job._testCase;

      // Read review artifacts
      const latest = await readLatestArtifacts(storage, category, productId);
      const normalizedSpec = latest.normalized;
      const summary = latest.summary;

      const hasRun = Boolean(summary?.runId || summary?.productId);
      if (!hasRun) {
        allChecks.push({ productId, testCase: testCase.name, testCaseId: testCase.id, check: 'has_run', pass: false, detail: 'No output artifacts found' });
        failed++;
        continue;
      }

      // Run contract-driven validation checks
      const scenarioChecks = buildValidationChecks(testCase.id, {
        normalized: normalizedSpec,
        summary,
        suggestionsEnums,
        suggestionsComponents,
        scenarioDefs
      });

      for (const sc of scenarioChecks) {
        allChecks.push({ productId, testCase: testCase.name, testCaseId: testCase.id, ...sc });
        sc.pass ? passed++ : failed++;
      }
    }

    return jsonRes(res, 200, { results: allChecks, summary: { passed, failed, total: passed + failed } });
  }

  // DELETE /api/v1/test-mode/{category}
  if (parts[0] === 'test-mode' && parts[1] && method === 'DELETE') {
    const category = parts[1];
    if (!category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'can_only_delete_test_categories' });
    }

    // Path traversal protection: verify resolved paths stay within expected roots
    const fixturesRoot = path.resolve('fixtures', 's3', 'specs', 'inputs');
    const dirs = [
      path.resolve(HELPER_ROOT, category),
      path.resolve(fixturesRoot, category),
      path.resolve(OUTPUT_ROOT, 'specs', 'outputs', category)
    ];
    for (const dir of dirs) {
      if (!dir.startsWith(path.resolve(HELPER_ROOT)) &&
          !dir.startsWith(fixturesRoot) &&
          !dir.startsWith(path.resolve(OUTPUT_ROOT))) {
        return jsonRes(res, 400, { ok: false, error: 'invalid_category_path' });
      }
      try { await fs.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // Clean up test brands â€” remove test category from brand registrations
    try {
      const registry = await loadBrandRegistry(config);
      const catLower = category.toLowerCase();
      for (const [slug, brand] of Object.entries(registry.brands || {})) {
        const idx = brand.categories.indexOf(catLower);
        if (idx >= 0) {
          brand.categories.splice(idx, 1);
          if (brand.categories.length === 0 && (brand.canonical_name === 'TestCo' || brand.canonical_name === 'TestNewBrand')) {
            delete registry.brands[slug];
          }
        }
      }
      await saveBrandRegistry(config, registry);
    } catch { /* non-fatal */ }

    return jsonRes(res, 200, { ok: true, deleted: category });
  }

  return null; // not handled
}

// â”€â”€ Static File Serving â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DIST_ROOT = process.env.__GUI_DIST_ROOT
  ? path.resolve(process.env.__GUI_DIST_ROOT)
  : path.resolve('tools/gui-react/dist');

function serveStatic(req, res) {
  let filePath = path.join(DIST_ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  // For SPA, serve index.html for non-file paths
  const ext = path.extname(filePath);
  if (!ext) filePath = path.join(DIST_ROOT, 'index.html');

  const stream = createReadStream(filePath);
  stream.on('error', () => {
    // Fallback to index.html for SPA routing
    const indexStream = createReadStream(path.join(DIST_ROOT, 'index.html'));
    indexStream.on('error', () => {
      res.statusCode = 404;
      res.end('Not Found');
    });
    res.setHeader('Content-Type', 'text/html');
    indexStream.pipe(res);
  });
  const contentType = mimeType(path.extname(filePath) || '.html');
  res.setHeader('Content-Type', contentType);
  // Prevent caching of all static files so new builds are always picked up
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  stream.pipe(res);
}

// â”€â”€ WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const wsClients = new Set();

function wsToken(value) {
  return String(value || '').trim().toLowerCase();
}

function wsEventProductId(evt) {
  return String(evt?.productId || evt?.product_id || '').trim();
}

function wsEventMatchesCategory(evt, categoryToken) {
  if (!categoryToken) return true;
  const evtCategory = wsToken(evt?.category || evt?.cat || '');
  if (evtCategory) return evtCategory === categoryToken;
  const pid = wsToken(wsEventProductId(evt));
  return pid.startsWith(`${categoryToken}-`);
}

function wsClientWantsChannel(client, channel) {
  const channels = Array.isArray(client?._channels) ? client._channels : [];
  if (channels.length === 0) return true;
  return channels.includes(channel);
}

function wsFilterPayload(channel, data, client) {
  if (channel === 'events' && Array.isArray(data)) {
    const categoryToken = wsToken(client?._category);
    const productId = String(client?._productId || '').trim();
    let rows = data;
    if (categoryToken) {
      rows = rows.filter((evt) => wsEventMatchesCategory(evt, categoryToken));
    }
    if (productId) {
      rows = rows.filter((evt) => wsEventProductId(evt) === productId);
    }
    return rows.length > 0 ? rows : null;
  }
  if (channel === 'indexlab-event' && Array.isArray(data)) {
    const categoryToken = wsToken(client?._category);
    const productId = String(client?._productId || '').trim();
    let rows = data;
    if (categoryToken) {
      rows = rows.filter((evt) => wsToken(evt?.category || '') === categoryToken);
    }
    if (productId) {
      rows = rows.filter((evt) => String(evt?.product_id || '').trim() === productId);
    }
    return rows.length > 0 ? rows : null;
  }
  if (channel === 'data-change' && data && typeof data === 'object') {
    const categoryToken = wsToken(client?._category);
    const dataCategory = wsToken(data.category);
    if (categoryToken && dataCategory && categoryToken !== dataCategory) {
      return null;
    }
  }
  return data;
}

function broadcastWs(channel, data) {
  const timestamp = new Date().toISOString();
  for (const client of wsClients) {
    if (client.readyState !== 1) continue; // OPEN
    if (!wsClientWantsChannel(client, channel)) continue;
    const filtered = wsFilterPayload(channel, data, client);
    if (filtered === null || filtered === undefined) continue;
    try {
      client.send(JSON.stringify({ channel, data: filtered, ts: timestamp }));
    } catch {
      // ignore broken sockets
    }
  }
}

// â”€â”€ File Watchers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function setupWatchers() {
  const eventsPath = path.join(OUTPUT_ROOT, '_runtime', 'events.jsonl');
  let lastEventSize = 0;
  const indexlabOffsets = new Map();

  // Watch events.jsonl for new lines
  const eventsWatcher = watch(eventsPath, { persistent: true, ignoreInitial: true });
  eventsWatcher.on('change', async () => {
    try {
      const stat = await fs.stat(eventsPath);
      if (stat.size <= lastEventSize) { lastEventSize = stat.size; return; }
      const fd = await fs.open(eventsPath, 'r');
      const buf = Buffer.alloc(stat.size - lastEventSize);
      await fd.read(buf, 0, buf.length, lastEventSize);
      await fd.close();
      lastEventSize = stat.size;
      const newLines = buf.toString('utf8').split('\n').filter(Boolean);
      const events = newLines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (events.length > 0) broadcastWs('events', events);
    } catch { /* ignore */ }
  });

  const indexlabPattern = path.join(INDEXLAB_ROOT, '*', 'run_events.ndjson');
  const indexlabWatcher = watch(indexlabPattern, { persistent: true, ignoreInitial: true });

  const publishIndexLabDelta = async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      const key = path.resolve(filePath);
      const previousSize = indexlabOffsets.get(key) || 0;
      if (stat.size < previousSize) {
        indexlabOffsets.set(key, 0);
      }
      const start = Math.max(0, Math.min(previousSize, stat.size));
      if (stat.size <= start) {
        indexlabOffsets.set(key, stat.size);
        return;
      }
      const fd = await fs.open(filePath, 'r');
      const buf = Buffer.alloc(stat.size - start);
      await fd.read(buf, 0, buf.length, start);
      await fd.close();
      indexlabOffsets.set(key, stat.size);
      const rows = parseNdjson(buf.toString('utf8'));
      if (rows.length > 0) {
        broadcastWs('indexlab-event', rows);
      }
    } catch {
      // ignore watcher errors
    }
  };

  indexlabWatcher.on('add', publishIndexLabDelta);
  indexlabWatcher.on('change', publishIndexLabDelta);
}

// â”€â”€ HTTP Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const server = http.createServer(async (req, res) => {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // API routes
  if (req.url.startsWith('/api/v1/') || req.url === '/health') {
    try {
      const handled = await handleApi(req, res);
      if (handled === null) {
        jsonRes(res, 404, { error: 'not_found' });
      }
    } catch (err) {
      console.error('[gui-server] API error:', err.message);
      jsonRes(res, 500, { error: 'internal', message: err.message });
    }
    return;
  }

  // Static files
  serveStatic(req, res);
});

// WebSocket server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws' || req.url?.startsWith('/ws?')) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wsClients.add(ws);
      ws.on('message', (msg) => {
        try {
          const data = JSON.parse(msg.toString());
          // Store subscription info on the client (for future filtering)
          if (data.subscribe) ws._channels = data.subscribe;
          if (data.category) ws._category = data.category;
          if (data.productId) ws._productId = data.productId;
        } catch { /* ignore */ }
      });
      ws.on('close', () => wsClients.delete(ws));
      ws.on('error', () => wsClients.delete(ws));
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const msg = `[gui-server] running on http://localhost:${PORT}`;
  console.log(msg);
  console.log(`[gui-server] API:     http://localhost:${PORT}/api/v1/health`);
  console.log(`[gui-server] WS:      ws://localhost:${PORT}/ws`);
  console.log(`[gui-server] Static:  ${DIST_ROOT}`);
  try {
    const distFiles = fsSync.readdirSync(path.join(DIST_ROOT, 'assets'));
    console.log(`[gui-server] Assets:  ${distFiles.join(', ')}`);
  } catch { console.log('[gui-server] Assets:  (could not list)'); }
  setupWatchers();

  // Auto-open browser when --open flag is passed (used by SpecFactory.exe launcher)
  if (args.includes('--open')) {
    const url = `http://localhost:${PORT}?_=${Date.now()}`;
    console.log(`[gui-server] Opening browser -> ${url}`);
    // Windows: start, macOS: open, Linux: xdg-open
    const cmd = process.platform === 'win32' ? `start "" "${url}"`
      : process.platform === 'darwin' ? `open "${url}"`
      : `xdg-open "${url}"`;
    execCb(cmd);
  }
});



