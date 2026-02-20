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
import { buildLlmMetrics } from '../publish/publishingPipeline.js';
import { SpecDb } from '../db/specDb.js';
import { findProductsReferencingComponent, cascadeComponentChange, cascadeEnumChange } from '../review/componentImpact.js';
import { componentReviewPath } from '../engine/curationSuggestions.js';
import { runComponentReviewBatch } from '../pipeline/componentReviewBatch.js';
import { invalidateFieldRulesCache } from '../field-rules/loader.js';
import { introspectWorkbook, loadWorkbookMap, saveWorkbookMap, validateWorkbookMap, extractWorkbookContext } from '../ingest/categoryCompile.js';
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

// ── Helpers ──────────────────────────────────────────────────────────
function toInt(v, fallback = 0) {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function toFloat(v, fallback = 0) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
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

function resolvePricingForModel(cfg, model) {
  const modelToken = normalizeModelToken(model);
  const defaultRates = {
    input_per_1m: toFloat(cfg?.llmCostInputPer1M, 0.28),
    output_per_1m: toFloat(cfg?.llmCostOutputPer1M, 0.42),
    cached_input_per_1m: toFloat(cfg?.llmCostCachedInputPer1M, 0)
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
  const productId = String(meta?.product_id || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !productId || !resolvedRunId) {
    return null;
  }

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
  const productId = String(meta?.product_id || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !resolvedRunId) {
    return null;
  }

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
  const productId = String(meta?.product_id || '').trim();
  const resolvedRunId = String(meta?.run_id || token).trim();
  if (!category || !productId || !resolvedRunId) {
    return null;
  }

  const runSummaryKey = storage.resolveOutputKey(category, productId, 'runs', resolvedRunId, 'logs', 'summary.json');
  const runSummary = await storage.readJsonOrNull(runSummaryKey);
  if (!runSummary || typeof runSummary !== 'object') {
    return null;
  }
  const attemptRows = Array.isArray(runSummary.searches_attempted) ? runSummary.searches_attempted : [];
  const selectedUrls = Array.isArray(runSummary.urls_fetched) ? runSummary.urls_fetched : [];
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
    const urlRaw = String(evt.url || evt.finalUrl || '').trim();
    const domain = domainFromUrl(urlRaw || evt.host || '');
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

    if (eventName === 'source_processed' || eventName === 'source_fetch_failed') {
      const statusCode = toInt(evt.status, 0);
      const urlStat = ensureUrlStat(bucket, normalizedUrl);
      bucket.completed_count += 1;
      if (urlStat) {
        urlStat.processed_count += 1;
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
      if (normalizedUrl) {
        bucket.candidates_checked_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.checked_count += 1;
        }
      }
      if (status >= 200 && status < 400) {
        if (normalizedUrl) bucket.fetched_ok_urls.add(normalizedUrl);
        if (urlStat) {
          urlStat.fetched_ok = true;
        }
        const ts = String(evt.ts || '').trim();
        if (ts && (!bucket.last_success_at || parseTsMs(ts) > parseTsMs(bucket.last_success_at))) {
          bucket.last_success_at = ts;
        }
      }
      if (status === 404) {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (status === 403 || status === 429) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
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
      const message = String(evt.message || evt.detail || '').toLowerCase();
      if (/404/.test(message)) {
        bucket.err_404 += 1;
        if (normalizedUrl) incrementMapCounter(bucket.err_404_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.err_404_count += 1;
        }
      }
      if (/(403|429|forbidden|captcha|rate.?limit|blocked)/.test(message)) {
        bucket.blocked_count += 1;
        if (normalizedUrl) incrementMapCounter(bucket.blocked_by_url, normalizedUrl);
        if (urlStat) {
          urlStat.blocked_count += 1;
        }
      }
      if (/(parse|json|xml|cheerio|dom|extract)/.test(message)) {
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

  const rows = [...buckets.values()].map((bucket) => {
    const durations = [...bucket.fetch_durations].filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const avgFetch = durations.length > 0
      ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length
      : 0;
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

// ── Catalog helpers ─────────────────────────────────────────────────
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


// ── Args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
}
const PORT = toInt(argVal('port', '8788'), 8788);
const isLocal = args.includes('--local');

// ── Config + Storage ─────────────────────────────────────────────────
loadDotEnvFile();
const config = loadConfig({ localMode: isLocal || true, outputMode: 'local' });
const storage = createStorage(config);
const OUTPUT_ROOT = path.resolve(config.localOutputRoot || 'out');
const HELPER_ROOT = path.resolve(config.helperFilesRoot || 'helper_files');
const INDEXLAB_ROOT = path.resolve(argVal('indexlab-root', 'artifacts/indexlab'));

// ── Lazy SpecDb Cache ────────────────────────────────────────────────
const specDbCache = new Map();
const specDbSeedPromises = new Map();
const reviewLayoutByCategory = new Map();

function getSpecDb(category) {
  if (specDbCache.has(category)) return specDbCache.get(category);
  // Primary: the seeded spec.sqlite for this category
  const primaryPath = path.join('.specfactory_tmp', category, 'spec.sqlite');
  // Fallback: phase9 database (may not have SpecDb tables)
  const fallbackPath = path.join('.specfactory_tmp', 'phase9', `${category}_all_products.sqlite`);

  // Try primary first
  for (const dbPath of [primaryPath, fallbackPath]) {
    try {
      fsSync.accessSync(dbPath);
      const db = new SpecDb({ dbPath, category });
      // Check if this DB actually has seeded data
      if (db.isSeeded()) {
        specDbCache.set(category, db);
        return db;
      }
      // DB exists but empty — close and try next, unless it's the primary
      if (dbPath === primaryPath) {
        // Primary DB exists but not seeded — trigger background seed and return it
        specDbCache.set(category, db);
        triggerAutoSeed(category, db);
        return db;
      }
      db.close();
    } catch { /* next */ }
  }

  // No DB found — create at the primary path and trigger seed
  try {
    fsSync.mkdirSync(path.dirname(primaryPath), { recursive: true });
    const db = new SpecDb({ dbPath: primaryPath, category });
    specDbCache.set(category, db);
    triggerAutoSeed(category, db);
    return db;
  } catch {
    specDbCache.set(category, null);
    return null;
  }
}

/** Background auto-seed: loads field rules and seeds the SpecDb */
function triggerAutoSeed(category, db) {
  if (specDbSeedPromises.has(category)) return;
  const promise = (async () => {
    try {
      const { loadFieldRules } = await import('../field-rules/loader.js');
      const { seedSpecDb } = await import('../db/seed.js');
      const fieldRules = await loadFieldRules(category, { config });
      const result = await seedSpecDb({ db, config, category, fieldRules });
      console.log(`[auto-seed] ${category}: ${result.components_seeded} components, ${result.list_values_seeded} list values, ${result.products_seeded} products (${result.duration_ms}ms)`);
    } catch (err) {
      console.error(`[auto-seed] ${category} failed:`, err.message);
    } finally {
      specDbSeedPromises.delete(category);
    }
  })();
  specDbSeedPromises.set(category, promise);
}

async function getSpecDbReady(category) {
  const db = getSpecDb(category);
  if (!db) return null;
  const pending = specDbSeedPromises.get(category);
  if (pending) {
    try {
      await pending;
    } catch {
      // keep best available DB handle; caller validates seeded content.
    }
  }
  return getSpecDb(category);
}

function ensureGridKeyReviewState(specDb, category, productId, fieldKey) {
  if (!specDb || !productId || !fieldKey) return null;
  try {
    const existing = specDb.getKeyReviewState({
      category,
      targetKind: 'grid_key',
      itemIdentifier: productId,
      fieldKey,
    });
    if (existing) return existing;

    const ifs = specDb.db.prepare(
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

function toPositiveId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

function resolveGridFieldStateForMutation(specDb, category, body) {
  if (!specDb) return null;
  const itemFieldStateId = toPositiveId(
    body?.itemFieldStateId
    ?? body?.item_field_state_id
    ?? body?.slotId
    ?? body?.slot_id
  );
  if (itemFieldStateId) {
    const byId = specDb.getItemFieldStateById(itemFieldStateId);
    if (byId && String(byId.category || '').trim() === String(category || '').trim()) {
      return byId;
    }
  }

  const productId = String(body?.productId || body?.product_id || '').trim();
  const fieldKey = String(body?.field || body?.fieldKey || body?.field_key || '').trim();
  if (!productId || !fieldKey) return null;
  return specDb.db.prepare(
    'SELECT * FROM item_field_state WHERE category = ? AND product_id = ? AND field_key = ? LIMIT 1'
  ).get(category, productId, fieldKey) || null;
}

function resolveComponentMutationContext(specDb, category, body) {
  if (!specDb) return null;
  const componentValueId = toPositiveId(
    body?.componentValueId
    ?? body?.component_value_id
    ?? body?.slotId
    ?? body?.slot_id
  );
  let componentValueRow = componentValueId ? specDb.getComponentValueById(componentValueId) : null;
  if (componentValueRow && String(componentValueRow.category || '').trim() !== String(category || '').trim()) {
    componentValueRow = null;
  }

  let componentType = String(body?.componentType || '').trim();
  let componentName = String(body?.name || body?.componentName || '').trim();
  let componentMaker = String(body?.maker || body?.componentMaker || '').trim();
  let property = String(body?.property || body?.propertyKey || '').trim();

  if (componentValueRow) {
    componentType = String(componentValueRow.component_type || '').trim();
    componentName = String(componentValueRow.component_name || '').trim();
    componentMaker = String(componentValueRow.component_maker || '').trim();
    property = String(componentValueRow.property_key || '').trim();
  }

  const componentIdentityId = toPositiveId(
    body?.componentIdentityId
    ?? body?.component_identity_id
    ?? body?.identityId
    ?? body?.identity_id
  );
  let identityRow = componentIdentityId ? specDb.getComponentIdentityById(componentIdentityId) : null;
  if (identityRow && String(identityRow.category || '').trim() !== String(category || '').trim()) {
    identityRow = null;
  }
  if (!identityRow && componentType && componentName) {
    identityRow = specDb.getComponentIdentity(componentType, componentName, componentMaker);
  }
  if (identityRow) {
    componentType = String(identityRow.component_type || componentType || '').trim();
    componentName = String(identityRow.canonical_name || componentName || '').trim();
    componentMaker = String(identityRow.maker || componentMaker || '').trim();
  }

  if (!componentValueRow && property && property !== '__name' && property !== '__maker' && property !== '__links' && property !== '__aliases' && componentType && componentName) {
    const rows = specDb.getComponentValuesWithMaker(componentType, componentName, componentMaker) || [];
    componentValueRow = rows.find((row) => String(row?.property_key || '').trim() === property) || null;
  }

  return {
    componentType,
    componentName,
    componentMaker,
    property,
    componentIdentityId: identityRow?.id ?? componentIdentityId ?? null,
    componentIdentityRow: identityRow || null,
    componentValueId: componentValueRow?.id ?? componentValueId ?? null,
    componentValueRow: componentValueRow || null,
  };
}

function resolveEnumMutationContext(specDb, category, body) {
  if (!specDb) return null;
  const listValueId = toPositiveId(body?.listValueId ?? body?.list_value_id ?? body?.valueId ?? body?.value_id);
  const enumListId = toPositiveId(body?.enumListId ?? body?.enum_list_id ?? body?.listId ?? body?.list_id);

  let listValueRow = listValueId ? specDb.getListValueById(listValueId) : null;
  if (listValueRow && String(listValueRow.category || '').trim() !== String(category || '').trim()) {
    listValueRow = null;
  }

  let enumListRow = enumListId ? specDb.getEnumListById(enumListId) : null;
  if (enumListRow && String(enumListRow.category || '').trim() !== String(category || '').trim()) {
    enumListRow = null;
  }
  if (!enumListRow && listValueRow?.list_id) {
    enumListRow = specDb.getEnumListById(listValueRow.list_id);
  }

  const field = String(body?.field || listValueRow?.field_key || enumListRow?.field_key || '').trim();
  const value = body?.value !== undefined && body?.value !== null
    ? String(body.value).trim()
    : String(listValueRow?.value || '').trim();
  const oldValue = body?.oldValue !== undefined
    ? String(body.oldValue || '').trim()
    : (body?.old_value !== undefined
      ? String(body.old_value || '').trim()
      : String(listValueRow?.value || '').trim());

  return {
    field,
    value,
    oldValue,
    listValueId: listValueRow?.id ?? listValueId ?? null,
    listValueRow: listValueRow || null,
    enumListId: enumListRow?.id ?? enumListId ?? null,
    enumListRow: enumListRow || null,
  };
}

function resolveKeyReviewForLaneMutation(specDb, category, body) {
  if (!specDb) return null;
  const numericId = Number(body?.id);
  if (Number.isFinite(numericId) && numericId > 0) {
    const byId = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(numericId);
    if (byId) return byId;
  }

  const fieldStateRow = resolveGridFieldStateForMutation(specDb, category, body);
  if (!fieldStateRow) return null;
  const productId = String(fieldStateRow.product_id || '').trim();
  const fieldKey = String(fieldStateRow.field_key || '').trim();
  if (!productId || !fieldKey) return null;
  return ensureGridKeyReviewState(specDb, category, productId, fieldKey);
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
    needsAiReview: false,
    aiReviewComplete: true,
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

function propagateCandidateLaneAcrossMatchingStates(specDb, category, {
  candidateId,
  lane,
  action,
  at,
} = {}) {
  if (!specDb) return { updated: 0 };
  const cid = String(candidateId || '').trim();
  const laneNorm = String(lane || '').trim().toLowerCase();
  const actionNorm = String(action || '').trim().toLowerCase();
  if (!cid || !['primary', 'shared'].includes(laneNorm)) return { updated: 0 };
  if (!['confirm', 'accept'].includes(actionNorm)) return { updated: 0 };

  let updated = 0;
  const rows = specDb.db.prepare(
    'SELECT * FROM key_review_state WHERE category = ? AND selected_candidate_id = ?'
  ).all(category, cid);
  const when = at || new Date().toISOString();

  for (const row of rows) {
    // Primary lane exists only for grid_key contexts.
    if (laneNorm === 'primary' && String(row?.target_kind || '') !== 'grid_key') continue;

    if (actionNorm === 'accept') {
      specDb.updateKeyReviewUserAccept({ id: row.id, lane: laneNorm, status: 'accepted', at: when });
    } else {
      specDb.updateKeyReviewAiConfirm({ id: row.id, lane: laneNorm, status: 'confirmed', confidence: 1.0, at: when });
    }

    if (laneNorm === 'primary') {
      markPrimaryLaneReviewedInItemState(specDb, category, row);
    }
    updated += 1;
  }
  return { updated };
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
  if (!specDb || !category || !pid) return { clearedCandidates: 0, clearedKeyReview: 0 };

  const stateIds = specDb.db.prepare(`
    SELECT id
    FROM key_review_state
    WHERE category = ?
      AND target_kind = 'grid_key'
      AND item_identifier = ?
  `).all(category, pid).map((row) => row.id);
  const clearedKeyReview = deleteKeyReviewStateRows(specDb, stateIds);

  let deletedCandidates = 0;
  const tx = specDb.db.transaction(() => {
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
    deletedCandidates = specDb.db
      .prepare('DELETE FROM candidates WHERE category = ? AND product_id = ?')
      .run(category, pid).changes;
  });
  tx();

  return {
    clearedCandidates: deletedCandidates,
    clearedKeyReview,
  };
}

function normalizeLower(value) {
  return String(value ?? '').trim().toLowerCase();
}

const UNKNOWN_LIKE_TOKENS = new Set(['', 'unk', 'unknown', 'n/a', 'na', 'null', 'undefined', '-']);

function isMeaningfulValue(value) {
  return !UNKNOWN_LIKE_TOKENS.has(normalizeLower(value));
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

async function syncSyntheticCandidatesFromComponentReview({ category, specDb }) {
  if (!specDb) return { upserted: 0 };
  const filePath = componentReviewPath({ config, category });
  const data = await safeReadJson(filePath);
  const items = Array.isArray(data?.items) ? data.items : [];
  if (!items.length) return { upserted: 0 };

  let upserted = 0;
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    if (status === 'dismissed') continue;
    const productId = String(item?.product_id || '').trim();
    const fieldKey = String(item?.field_key || '').trim();
    if (!productId || !fieldKey) continue;

    const pushCandidate = (candidateId, value, score, method, quote, snippetText) => {
      const text = String(value ?? '').trim();
      if (!text) return;
      specDb.insertCandidate({
        candidate_id: candidateId,
        product_id: productId,
        field_key: fieldKey,
        value: text,
        normalized_value: normalizeLower(text),
        score: Number.isFinite(Number(score)) ? Number(score) : 0.5,
        rank: 1,
        source_url: `pipeline://component-review/${item.review_id || 'pending'}`,
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
        extracted_at: item.created_at || new Date().toISOString(),
        run_id: item.run_id || null,
      });
      upserted += 1;
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
      const attrText = String(attrValue ?? '').trim();
      if (!attrText) continue;
      const attrKey = String(attrKeyRaw || '').trim();
      if (!attrKey) continue;
      const id = buildComponentReviewSyntheticCandidateId({
        productId,
        fieldKey: `${fieldKey}::${attrKey}`,
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
      );
    }
  }
  return { upserted };
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

  const row = await getReviewFieldRow(category, fieldKey);
  if (!row?.field_rule) return { propagated: false };

  const nowIso = new Date().toISOString();
  const candidateNorm = normalizeLower(selectedValue);
  const hasComponentShared = Boolean(row.field_rule.component_type);
  const hasListShared = Boolean(row.field_rule.enum_source || row.field_rule.enum_name);
  let propagated = false;

  // Intentionally no grid/item -> component writes here.
  // Component catalog is authoritative and should never be derived from item acceptance.

  // Intentionally no grid/item -> enum writes here.
  // Enum values are authoritative and should never be derived from item acceptance.

  // Shared decisions fan out across linked grid cells in the same field/value context,
  // even when candidate_id differs by product.
  if (hasComponentShared || hasListShared) {
    try {
      const peerRows = specDb.db.prepare(
        `SELECT id, selected_value
         FROM key_review_state
         WHERE category = ?
           AND target_kind = 'grid_key'
           AND field_key = ?`
      ).all(category, fieldKey);
      for (const peer of peerRows) {
        if (Number(peer?.id) === Number(keyReviewState.id)) continue;
        const peerValueNorm = normalizeLower(peer?.selected_value || '');
        if (!peerValueNorm || peerValueNorm !== candidateNorm) continue;
        specDb.updateKeyReviewUserAccept({ id: peer.id, lane: 'shared', status: 'accepted', at: nowIso });
        propagated = true;
      }
    } catch { /* best-effort shared grid fan-out */ }
  }

  return { propagated };
}

// ── Process Manager ──────────────────────────────────────────────────
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

async function stopProcess(timeoutMs = 8000) {
  const runningProc = childProc;
  if (!runningProc || runningProc.exitCode !== null) {
    return {
      ...processStatus(),
      stop_attempted: false,
      stop_confirmed: true
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

  return {
    ...processStatus(),
    stop_attempted: true,
    stop_confirmed: Boolean(exited || runningProc.exitCode !== null)
  };
}

// ── Route Helpers ────────────────────────────────────────────────────
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
  return { parts, params, pathname };
}

// ── Catalog builder ──────────────────────────────────────────────────
async function buildCatalog(category) {
  const catalog = await loadProductCatalog(config, category);
  const inputKeys = await storage.listInputKeys(category);
  const specDb = getSpecDb(category);
  const queue = await loadQueueState({ storage, category, specDb }).catch(() => ({ state: { products: {} } }));
  const queueProducts = queue.state?.products || {};

  // Map: normKey → row (for dedup)
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

    // Only enrich products already in the catalog — skip orphaned storage inputs
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

// ── Compiled component DB dual-write ─────────────────────────────────
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

// ── Route Handler ────────────────────────────────────────────────────
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

  // Product Catalog CRUD — /api/v1/catalog/{cat}/products[/{pid}]
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

  // Catalog overview — /api/v1/catalog/{cat}  ("all" merges every category)
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

  if (parts[0] === 'indexing' && parts[1] === 'llm-config' && method === 'GET') {
    const models = collectLlmModels(config);
    const modelPricing = models.map((modelName) => ({
      model: modelName,
      provider: llmProviderFromModel(modelName),
      ...resolvePricingForModel(config, modelName)
    }));
    return jsonRes(res, 200, {
      generated_at: new Date().toISOString(),
      phase2: {
        enabled_default: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
        model_default: String(config.llmModelPlan || '').trim()
      },
      phase3: {
        enabled_default: Boolean(config.llmEnabled && config.llmSerpRerankEnabled),
        model_default: String(
          config.llmModelTriage ||
          config.cortexModelRerankFast ||
          config.cortexModelSearchFast ||
          config.llmModelFast ||
          ''
        ).trim()
      },
      model_options: models,
      pricing_defaults: resolvePricingForModel(config, ''),
      model_pricing: modelPricing
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
      // Filter review queue against catalog — don't surface phantom products
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

  // Review product payload (single) — only serve if product exists in catalog
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
    // Brand filter — if brands param is provided, only include matching products
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

  // Review products index — ALL products, lightweight (no candidates), sorted by brand
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

  // Review candidates for a single field — lazy loading for drawer
  if (parts[0] === 'review' && parts[1] && parts[2] === 'candidates' && parts[3] && parts[4] && method === 'GET') {
    const [, category, , productId, field] = parts;
    const specDb = getSpecDb(category);
    if (specDb) {
      await syncSyntheticCandidatesFromComponentReview({ category, specDb }).catch(() => ({ upserted: 0 }));
    }
    // Check product exists — catalog OR SpecDb products table
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
    // Augment with pipeline candidates from component_review.json
    const allCandidates = Array.isArray(fieldState.candidates) ? [...fieldState.candidates] : [];
    try {
      const crPath = componentReviewPath({ config, category });
      const crData = await safeReadJson(crPath);
      if (crData && Array.isArray(crData.items)) {
        const existingValues = new Set(allCandidates.map(c => String(c.value ?? '').trim().toLowerCase()));
        for (const ri of crData.items) {
          if (ri.status !== 'pending_ai') continue;
          if (ri.product_id !== productId) continue;
          if (ri.field_key !== resolvedField && ri.component_type !== resolvedField) continue;
          // Add matched_component or raw_query as a pipeline candidate
          const val = ri.matched_component || ri.raw_query || '';
          if (!val || existingValues.has(val.trim().toLowerCase())) continue;
          existingValues.add(val.trim().toLowerCase());
          allCandidates.push({
            candidate_id: buildComponentReviewSyntheticCandidateId({
              productId,
              fieldKey: resolvedField,
              reviewId: ri.review_id || ri.raw_query,
              value: val,
            }),
            value: val,
            score: ri.combined_score || 0.5,
            source_id: 'pipeline',
            source: 'Pipeline (component review)',
            tier: null,
            method: ri.match_type || 'component_review',
            evidence: {
              url: '',
              retrieved_at: ri.created_at || '',
              snippet_id: '',
              snippet_hash: '',
              quote: `${ri.match_type === 'new_component' ? 'New component' : 'Fuzzy match'}: "${ri.raw_query}"${ri.matched_component ? ` → ${ri.matched_component}` : ''}`,
              quote_span: null,
              snippet_text: `Component review item from product ${ri.product_id}`,
              source_id: 'pipeline',
            },
          });
        }
      }
    } catch (_) { /* ignore missing component_review.json */ }
    // Augment with SpecDb candidates
    if (specDb) {
      try {
        const dbCands = specDb.getCandidatesForField(productId, resolvedField);
        if (dbCands.length > 0) {
          const existingIds = new Set(allCandidates.map(c => c.candidate_id));
          const existingValues = new Set(allCandidates.map(c => String(c.value ?? '').trim().toLowerCase()));
          for (const c of dbCands) {
            if (existingIds.has(c.candidate_id)) continue;
            const val = String(c.value ?? '').trim().toLowerCase();
            if (existingValues.has(val)) continue;
            existingValues.add(val);
            allCandidates.push({
              candidate_id: c.candidate_id,
              value: c.value,
              score: c.score ?? 0,
              source_id: 'specdb',
              source: c.source_host || 'SpecDb',
              tier: c.source_tier ?? null,
              method: c.source_method || 'specdb',
              evidence: {
                url: c.evidence_url || c.source_url || '',
                retrieved_at: c.evidence_retrieved_at || c.extracted_at || '',
                snippet_id: c.snippet_id || '',
                snippet_hash: c.snippet_hash || '',
                quote: c.quote || '',
                quote_span: c.quote_span_start != null ? [c.quote_span_start, c.quote_span_end] : null,
                snippet_text: c.snippet_text || '',
                source_id: 'specdb',
              },
            });
          }
        }
      } catch (_) { /* best-effort SpecDb enrichment */ }
    }
    // Enrich response with key_review_state data for this field
    let keyReview = null;
    if (specDb) {
      try {
        const krs = specDb.getKeyReviewState({ targetKind: 'grid_key', itemIdentifier: productId, fieldKey: resolvedField, category });
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
    return jsonRes(res, 200, {
      product_id: productId,
      field: resolvedField,
      candidates: allCandidates,
      candidate_count: allCandidates.length,
      keyReview,
    });
  }

  // Review override
  if (parts[0] === 'review' && parts[1] && parts[2] === 'override' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { candidateId, value, reason, reviewer } = body;
    const specDb = getSpecDb(category);
    const fieldStateRow = resolveGridFieldStateForMutation(specDb, category, body);
    const productId = String(body?.productId || body?.product_id || fieldStateRow?.product_id || '').trim();
    const field = String(body?.field || body?.fieldKey || body?.field_key || fieldStateRow?.field_key || '').trim();
    if (!productId || !field) {
      return jsonRes(res, 400, {
        error: 'item_context_required',
        message: 'Provide productId + field or itemFieldStateId.',
      });
    }
    try {
      const normalizedCandidateId = String(candidateId || '').trim();
      if (normalizedCandidateId) {
        const result = await setOverrideFromCandidate({
          storage,
          config,
          category,
          productId,
          field,
          candidateId: normalizedCandidateId,
          candidateValue: value ?? body?.candidateValue ?? body?.candidate_value ?? null,
          candidateScore: body?.candidateConfidence ?? body?.candidate_confidence ?? null,
          candidateSource: body?.candidateSource ?? body?.candidate_source ?? '',
          candidateMethod: body?.candidateMethod ?? body?.candidate_method ?? '',
          candidateTier: body?.candidateTier ?? body?.candidate_tier ?? null,
          candidateEvidence: body?.candidateEvidence ?? body?.candidate_evidence ?? null,
          reviewer,
          reason,
          specDb,
        });
        if (specDb) {
          syncPrimaryLaneAcceptFromItemSelection({
            specDb,
            category,
            productId,
            fieldKey: field,
            selectedCandidateId: result?.candidate_id || normalizedCandidateId,
            selectedValue: result?.value ?? body?.candidateValue ?? body?.candidate_value ?? value ?? null,
            confidenceScore: body?.candidateConfidence ?? body?.candidate_confidence ?? null,
            reason: `User accepted primary lane via item override${normalizedCandidateId ? ` (${normalizedCandidateId})` : ''}`,
          });
        }
        broadcastWs('data-change', { type: 'review-override', category, productId, field });
        return jsonRes(res, 200, { ok: true, result });
      }

      if (value === undefined || String(value).trim() === '') {
        return jsonRes(res, 400, { error: 'invalid_override_request', message: 'Provide candidateId or value.' });
      }

      const result = await setManualOverride({
        storage,
        config,
        category,
        productId,
        field,
        value: String(value),
        reviewer,
        reason,
        evidence: {
          url: 'gui://manual-entry',
          quote: `Manually set to "${String(value)}" via GUI`,
        },
        specDb,
      });
      if (specDb) {
        syncPrimaryLaneAcceptFromItemSelection({
          specDb,
          category,
          productId,
          fieldKey: field,
          selectedCandidateId: null,
          selectedValue: result?.value ?? value ?? null,
          confidenceScore: 1.0,
          reason: 'User manually set item value via review override',
        });
      }
      broadcastWs('data-change', { type: 'review-manual-override', category, productId, field });
      return jsonRes(res, 200, { ok: true, result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'override_failed', message: err.message });
    }
  }

  // Review manual override
  if (parts[0] === 'review' && parts[1] && parts[2] === 'manual-override' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { value, evidenceUrl, evidenceQuote, reason, reviewer } = body;
    if (value === undefined || String(value).trim() === '') {
      return jsonRes(res, 400, { error: 'value_required', message: 'manual-override requires value' });
    }
    const specDb = getSpecDb(category);
    const fieldStateRow = resolveGridFieldStateForMutation(specDb, category, body);
    const productId = String(body?.productId || body?.product_id || fieldStateRow?.product_id || '').trim();
    const field = String(body?.field || body?.fieldKey || body?.field_key || fieldStateRow?.field_key || '').trim();
    if (!productId || !field) {
      return jsonRes(res, 400, {
        error: 'item_context_required',
        message: 'Provide productId + field or itemFieldStateId.',
      });
    }
    try {
      const effectiveUrl = evidenceUrl || 'gui://manual-entry';
      const effectiveQuote = evidenceQuote || `Manually set to "${String(value)}" via GUI`;
      const result = await setManualOverride({
        storage,
        config,
        category,
        productId,
        field,
        value: String(value),
        reviewer,
        reason,
        evidence: {
          url: String(effectiveUrl),
          quote: String(effectiveQuote),
          source_id: null,
          retrieved_at: new Date().toISOString(),
        },
        specDb,
      });
      if (specDb) {
        syncPrimaryLaneAcceptFromItemSelection({
          specDb,
          category,
          productId,
          fieldKey: field,
          selectedCandidateId: null,
          selectedValue: result?.value ?? value ?? null,
          confidenceScore: 1.0,
          reason: 'User manually set item value via manual-override endpoint',
        });
      }
      broadcastWs('data-change', { type: 'review-manual-override', category, productId, field });
      return jsonRes(res, 200, { ok: true, result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'manual_override_failed', message: err.message });
    }
  }

  // Review finalize
  if (parts[0] === 'review' && parts[1] && parts[2] === 'finalize' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { productId, apply = true, draft, reviewer } = body;
    const cliArgs = ['src/cli/spec.js', 'review', 'finalize', '--category', category, '--product-id', productId];
    if (apply) cliArgs.push('--apply');
    if (draft) cliArgs.push('--draft');
    if (reviewer) cliArgs.push('--reviewer', String(reviewer));
    cliArgs.push('--local');
    try {
      const result = await new Promise((resolve, reject) => {
        const proc = spawn('node', cliArgs, { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => { stdout += d; });
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
      });
      return jsonRes(res, 200, { ok: true, output: result });
    } catch (err) {
      return jsonRes(res, 500, { error: 'finalize_failed', message: err.message });
    }
  }

  // Review finalize-all — finalize all run products
  if (parts[0] === 'review' && parts[1] && parts[2] === 'finalize-all' && method === 'POST') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    // Re-use products-index logic to find all run products
    const catalog = await loadProductCatalog(config, category);
    const productIds = Object.keys(catalog.products || {});
    const results = [];
    const errors = [];
    for (const pid of productIds) {
      try {
        const layout = await buildReviewLayout({ storage, config, category });
        const payload = await buildProductReviewPayload({ storage, config, category, productId: pid, layout, includeCandidates: false, specDb });
        if (!payload.metrics.has_run) continue;
        const cliArgs = ['src/cli/spec.js', 'review', 'finalize', '--category', category, '--product-id', pid, '--apply', '--local'];
        await new Promise((resolve, reject) => {
          const proc = spawn('node', cliArgs, { cwd: path.resolve('.'), stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '', stderr = '';
          proc.stdout.on('data', d => { stdout += d; });
          proc.stderr.on('data', d => { stderr += d; });
          proc.on('exit', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)));
        });
        results.push(pid);
      } catch (err) {
        errors.push({ productId: pid, error: err.message });
      }
    }
    return jsonRes(res, 200, { ok: true, finalized: results.length, errors: errors.length, details: { finalized: results, errors } });
  }

  // Key review confirm — confirm AI review for a lane (primary or shared)
  if (parts[0] === 'review' && parts[1] && parts[2] === 'key-review-confirm' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const lane = String(body?.lane || '').trim().toLowerCase();
    const candidateId = String(body?.candidateId || body?.candidate_id || '').trim();
    if (!['primary', 'shared'].includes(lane)) {
      return jsonRes(res, 400, { error: 'lane (primary|shared) required' });
    }
    const specDb = getSpecDb(category);
    if (!specDb) return jsonRes(res, 404, { error: 'no_spec_db', message: `No SpecDb for ${category}` });
    try {
      const stateRow = resolveKeyReviewForLaneMutation(specDb, category, body);
      if (!stateRow) {
        return jsonRes(res, 404, { error: 'key_review_state_not_found', message: 'Provide id, itemFieldStateId, or productId + field' });
      }
      if (lane === 'primary' && String(stateRow.target_kind || '') !== 'grid_key') {
        return jsonRes(res, 400, {
          error: 'lane_context_mismatch',
          message: 'Primary lane is only valid for item_key_context (grid_key).',
        });
      }
      const now = new Date().toISOString();
      specDb.updateKeyReviewAiConfirm({ id: stateRow.id, lane, status: 'confirmed', confidence: 1.0, at: now });
      specDb.insertKeyReviewAudit({
        keyReviewStateId: stateRow.id,
        eventType: 'ai_confirm',
        actorType: 'user',
        actorId: null,
        oldValue: lane === 'shared'
          ? (stateRow.ai_confirm_shared_status || 'pending')
          : (stateRow.ai_confirm_primary_status || 'pending'),
        newValue: 'confirmed',
        reason: `User confirmed ${lane} lane via GUI`,
      });
      const updated = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(stateRow.id);
      if (lane === 'primary') {
        syncItemFieldStateFromPrimaryLaneAccept(specDb, category, updated);
        markPrimaryLaneReviewedInItemState(specDb, category, updated);
      }
      broadcastWs('data-change', { type: 'key-review-confirm', category, id: stateRow.id, lane });
      return jsonRes(res, 200, { ok: true, keyReviewState: updated });
    } catch (err) {
      return jsonRes(res, 500, { error: 'confirm_failed', message: err.message });
    }
  }

  // Key review accept — user accepts a lane (primary or shared)
  if (parts[0] === 'review' && parts[1] && parts[2] === 'key-review-accept' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const lane = String(body?.lane || '').trim().toLowerCase();
    const candidateId = String(body?.candidateId || body?.candidate_id || '').trim();
    if (!['primary', 'shared'].includes(lane)) {
      return jsonRes(res, 400, { error: 'lane (primary|shared) required' });
    }
    const specDb = getSpecDb(category);
    if (!specDb) return jsonRes(res, 404, { error: 'no_spec_db', message: `No SpecDb for ${category}` });
    try {
      const stateRow = resolveKeyReviewForLaneMutation(specDb, category, body);
      if (!stateRow) {
        return jsonRes(res, 404, { error: 'key_review_state_not_found', message: 'Provide id, itemFieldStateId, or productId + field' });
      }
      if (lane === 'primary' && String(stateRow.target_kind || '') !== 'grid_key') {
        return jsonRes(res, 400, {
          error: 'lane_context_mismatch',
          message: 'Primary lane is only valid for item_key_context (grid_key).',
        });
      }
      if (candidateId) {
        const candidateRow = specDb.getCandidateById(candidateId);
        const bodyCandidateValue = body?.candidateValue ?? body?.candidate_value ?? null;
        const bodyCandidateConfidence = body?.candidateConfidence ?? body?.candidate_confidence ?? null;
        if (
          candidateRow
          &&
          stateRow.target_kind === 'grid_key'
          && (
            String(candidateRow.product_id || '') !== String(stateRow.item_identifier || '')
            || String(candidateRow.field_key || '') !== String(stateRow.field_key || '')
          )
        ) {
          return jsonRes(res, 400, {
            error: 'candidate_context_mismatch',
            message: `candidate_id '${candidateId}' does not belong to ${stateRow.item_identifier}/${stateRow.field_key}`,
          });
        }
        const selectedValue = candidateRow ? (candidateRow.value ?? null) : bodyCandidateValue;
        const selectedScore = candidateRow
          ? (Number.isFinite(Number(candidateRow.score)) ? Number(candidateRow.score) : null)
          : (Number.isFinite(Number(bodyCandidateConfidence)) ? Number(bodyCandidateConfidence) : null);
        specDb.db.prepare(`
          UPDATE key_review_state
          SET selected_candidate_id = ?,
              selected_value = ?,
              confidence_score = COALESCE(?, confidence_score),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          candidateId,
          selectedValue,
          selectedScore,
          stateRow.id
        );
      }
      const now = new Date().toISOString();
      specDb.updateKeyReviewUserAccept({ id: stateRow.id, lane, status: 'accepted', at: now });
      specDb.insertKeyReviewAudit({
        keyReviewStateId: stateRow.id,
        eventType: 'user_accept',
        actorType: 'user',
        actorId: null,
        oldValue: null,
        newValue: 'accepted',
        reason: `User accepted ${lane} lane via GUI${candidateId ? ` for candidate ${candidateId}` : ''}`,
      });
      const updated = specDb.db.prepare('SELECT * FROM key_review_state WHERE id = ?').get(stateRow.id);
      if (lane === 'primary') {
        syncItemFieldStateFromPrimaryLaneAccept(specDb, category, updated);
        markPrimaryLaneReviewedInItemState(specDb, category, updated);
      }
      if (lane === 'shared') {
        await propagateSharedLaneDecision({
          category,
          specDb,
          keyReviewState: updated,
          laneAction: 'accept',
          candidateValue: body?.candidateValue ?? body?.candidate_value ?? updated?.selected_value ?? null,
        });
      }
      const effectiveCandidateId = String(candidateId || updated?.selected_candidate_id || '').trim();
      if (effectiveCandidateId) {
        propagateCandidateLaneAcrossMatchingStates(specDb, category, {
          candidateId: effectiveCandidateId,
          lane,
          action: 'accept',
          at: now,
        });
      }
      broadcastWs('data-change', { type: 'key-review-accept', category, id: stateRow.id, lane });
      return jsonRes(res, 200, { ok: true, keyReviewState: updated });
    } catch (err) {
      return jsonRes(res, 500, { error: 'accept_failed', message: err.message });
    }
  }

  // Review suggest — submit suggestion feedback
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

  // ── Review Components endpoints ──────────────────────────────────

  // Layout — list component types with property columns
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
    await syncSyntheticCandidatesFromComponentReview({ category, specDb }).catch(() => ({ upserted: 0 }));
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
    await syncSyntheticCandidatesFromComponentReview({ category, specDb }).catch(() => ({ upserted: 0 }));
    const payload = await buildEnumReviewPayloads({ config, category, specDb });
    return jsonRes(res, 200, payload);
  }

  // Component property override
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-override' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const { review_status, candidateId, candidateSource } = body;
    const value = body?.value;
    const runtimeSpecDb = await getSpecDbReady(category);
    if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const componentCtx = resolveComponentMutationContext(runtimeSpecDb, category, body);
    const componentType = String(componentCtx?.componentType || '').trim();
    const name = String(componentCtx?.componentName || '').trim();
    const componentMaker = String(componentCtx?.componentMaker || '').trim();
    const property = String(componentCtx?.property || body?.property || body?.propertyKey || '').trim();
    const componentIdentityId = componentCtx?.componentIdentityId ?? null;
    if (!componentType || !name) {
      return jsonRes(res, 400, {
        error: 'component_context_required',
        message: 'Provide component identity (componentType + name) or slot identifiers.',
      });
    }

    // SQL-first runtime path (legacy JSON override files removed from the write path)
    try {
      const nowIso = new Date().toISOString();
      const acceptedCandidateId = String(candidateId || '').trim() || null;
      const sourceToken = String(candidateSource || '').trim().toLowerCase();
      const resolveSelectionSource = () => {
        if (!acceptedCandidateId) return 'user';
        const candidateLooksWorkbook = acceptedCandidateId.startsWith('wb_')
          || acceptedCandidateId.startsWith('wb-')
          || acceptedCandidateId.includes('::wb_')
          || acceptedCandidateId.includes('::wb-')
          || sourceToken.includes('workbook')
          || sourceToken.includes('excel');
        const candidateLooksUser = sourceToken.includes('manual') || sourceToken.includes('user');
        if (candidateLooksWorkbook) return 'component_db';
        if (candidateLooksUser) return 'user';
        return 'pipeline';
      };
      const selectedSource = resolveSelectionSource();

      if (property && value !== undefined) {
        const isIdentity = property === '__name' || property === '__maker' || property === '__links' || property === '__aliases';

        if (!isIdentity) {
          const existingValues = runtimeSpecDb.getComponentValuesWithMaker(componentType, name, componentMaker);
          const existingProperty = (
            componentCtx?.componentValueRow
            && String(componentCtx.componentValueRow.property_key || '').trim() === String(property || '').trim()
          )
            ? componentCtx.componentValueRow
            : existingValues.find((row) => String(row.property_key || '') === String(property));
          const componentIdentifier = buildComponentIdentifier(componentType, name, componentMaker);
          const existingSharedLaneState = runtimeSpecDb.getKeyReviewState({
            category,
            targetKind: 'component_key',
            fieldKey: String(property),
            componentIdentifier,
            propertyKey: String(property),
          });
          const existingSharedLaneStatus = String(existingSharedLaneState?.ai_confirm_shared_status || '').trim().toLowerCase();
          const keepNeedsReview = acceptedCandidateId
            ? (existingSharedLaneStatus === 'pending' || Boolean(existingProperty?.needs_review))
            : false;
          let parsedConstraints = [];
          if (existingProperty?.constraints) {
            try {
              parsedConstraints = JSON.parse(existingProperty.constraints);
            } catch {
              parsedConstraints = [];
            }
          }
          runtimeSpecDb.upsertComponentValue({
            componentType,
            componentName: name,
            componentMaker,
            propertyKey: property,
            value: String(value),
            confidence: 1.0,
            variancePolicy: existingProperty?.variance_policy ?? null,
            source: selectedSource,
            acceptedCandidateId: acceptedCandidateId || null,
            overridden: !acceptedCandidateId,
            needsReview: keepNeedsReview,
            constraints: parsedConstraints,
          });

          const sharedCandidate = acceptedCandidateId
            ? runtimeSpecDb.getCandidateById(acceptedCandidateId)
            : null;
          const sharedConfidence = Number.isFinite(Number(sharedCandidate?.score))
            ? Number(sharedCandidate.score)
            : 1.0;
          applySharedLaneState({
            specDb: runtimeSpecDb,
            category,
            targetKind: 'component_key',
            fieldKey: String(property),
            componentIdentifier,
            propertyKey: String(property),
            selectedCandidateId: acceptedCandidateId,
            selectedValue: String(value),
            confidenceScore: sharedConfidence,
            laneAction: 'accept',
            nowIso,
          });

          if (!acceptedCandidateId) {
            if (existingProperty?.id) {
              runtimeSpecDb.db.prepare(
                'UPDATE component_values SET accepted_candidate_id = NULL, updated_at = datetime(\'now\') WHERE category = ? AND id = ?'
              ).run(runtimeSpecDb.category, existingProperty.id);
            } else {
              runtimeSpecDb.db.prepare(
                'UPDATE component_values SET accepted_candidate_id = NULL, updated_at = datetime(\'now\') WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ? AND property_key = ?'
              ).run(runtimeSpecDb.category, componentType, name, componentMaker, property);
            }
          } else {
            propagateCandidateLaneAcrossMatchingStates(runtimeSpecDb, runtimeSpecDb.category, {
              candidateId: acceptedCandidateId,
              lane: 'shared',
              action: 'accept',
              at: nowIso,
            });
          }

          await cascadeComponentChange({
            storage,
            outputRoot: OUTPUT_ROOT,
            category,
            componentType,
            componentName: name,
            componentMaker,
            changedProperty: property,
            newValue: value,
            variancePolicy: existingProperty?.variance_policy ?? null,
            constraints: parsedConstraints,
            loadQueueState,
            saveQueueState,
            specDb: runtimeSpecDb,
          });
        } else if (property === '__aliases') {
          const aliases = (Array.isArray(value) ? value : [value])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
          let idRow = componentIdentityId ? { id: componentIdentityId } : null;
          if (!idRow) {
            idRow = runtimeSpecDb.db.prepare(
              'SELECT id FROM component_identity WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?'
            ).get(runtimeSpecDb.category, componentType, name, componentMaker);
          }
          if (!idRow) {
            idRow = runtimeSpecDb.upsertComponentIdentity({
              componentType,
              canonicalName: name,
              maker: componentMaker,
              links: [],
              source: 'component_db',
            });
          }
          if (idRow?.id) {
            runtimeSpecDb.db.prepare('DELETE FROM component_aliases WHERE component_id = ? AND source = ?').run(idRow.id, 'user');
            for (const alias of aliases) {
              runtimeSpecDb.insertAlias(idRow.id, alias, 'user');
            }
          }
          runtimeSpecDb.updateAliasesOverridden(componentType, name, componentMaker, aliases.length > 0);
        } else if (property === '__links') {
          const links = (Array.isArray(value) ? value : [value])
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
          if (componentIdentityId) {
            runtimeSpecDb.db.prepare(`
              UPDATE component_identity
              SET links = ?, source = 'user', updated_at = datetime('now')
              WHERE category = ? AND id = ?
            `).run(JSON.stringify(links), runtimeSpecDb.category, componentIdentityId);
          } else {
            runtimeSpecDb.db.prepare(`
              UPDATE component_identity
              SET links = ?, source = 'user', updated_at = datetime('now')
              WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
            `).run(JSON.stringify(links), runtimeSpecDb.category, componentType, name, componentMaker);
          }
        } else if (property === '__name') {
          const newName = String(value || '').trim();
          if (!newName || newName.length < 2) {
            return jsonRes(res, 400, { error: 'name must be at least 2 characters' });
          }
          const oldComponentIdentifier = buildComponentIdentifier(componentType, name, componentMaker);
          const newComponentIdentifier = buildComponentIdentifier(componentType, newName, componentMaker);
          const tx = runtimeSpecDb.db.transaction(() => {
            if (componentIdentityId) {
              runtimeSpecDb.db.prepare(`
                UPDATE component_identity
                SET canonical_name = ?, source = ?, updated_at = datetime('now')
                WHERE category = ? AND id = ?
              `).run(newName, selectedSource, runtimeSpecDb.category, componentIdentityId);
            } else {
              runtimeSpecDb.db.prepare(`
                UPDATE component_identity
                SET canonical_name = ?, source = ?, updated_at = datetime('now')
                WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
              `).run(newName, selectedSource, runtimeSpecDb.category, componentType, name, componentMaker);
            }
            runtimeSpecDb.db.prepare(`
              UPDATE component_values
              SET component_name = ?, updated_at = datetime('now')
              WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
            `).run(newName, runtimeSpecDb.category, componentType, name, componentMaker);
            runtimeSpecDb.db.prepare(`
              UPDATE item_component_links
              SET component_name = ?, updated_at = datetime('now')
              WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
            `).run(newName, runtimeSpecDb.category, componentType, name, componentMaker);
            if (oldComponentIdentifier !== newComponentIdentifier) {
              runtimeSpecDb.db.prepare(`
                UPDATE key_review_state
                SET component_identifier = ?, updated_at = datetime('now')
                WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ?
              `).run(newComponentIdentifier, runtimeSpecDb.category, oldComponentIdentifier);
            }
          });
          tx();
          await remapPendingComponentReviewItemsForNameChange({
            category,
            componentType,
            oldName: name,
            newName,
            specDb: runtimeSpecDb,
          });
          const sharedCandidate = acceptedCandidateId
            ? runtimeSpecDb.getCandidateById(acceptedCandidateId)
            : null;
          const sharedConfidence = Number.isFinite(Number(sharedCandidate?.score))
            ? Number(sharedCandidate.score)
            : 1.0;
          applySharedLaneState({
            specDb: runtimeSpecDb,
            category,
            targetKind: 'component_key',
            fieldKey: '__name',
            componentIdentifier: newComponentIdentifier,
            propertyKey: '__name',
            selectedCandidateId: acceptedCandidateId,
            selectedValue: newName,
            confidenceScore: sharedConfidence,
            laneAction: 'accept',
            nowIso,
          });
          if (acceptedCandidateId) {
            propagateCandidateLaneAcrossMatchingStates(runtimeSpecDb, runtimeSpecDb.category, {
              candidateId: acceptedCandidateId,
              lane: 'shared',
              action: 'accept',
              at: nowIso,
            });
          }
          await cascadeComponentChange({
            storage,
            outputRoot: OUTPUT_ROOT,
            category,
            componentType,
            componentName: newName,
            componentMaker,
            changedProperty: componentType,
            newValue: newName,
            variancePolicy: 'authoritative',
            constraints: [],
            loadQueueState,
            saveQueueState,
            specDb: runtimeSpecDb,
          });
        } else if (property === '__maker') {
          const newMaker = String(value || '').trim();
          if (!newMaker || newMaker.length < 2) {
            return jsonRes(res, 400, { error: 'maker must be at least 2 characters' });
          }
          const oldComponentIdentifier = buildComponentIdentifier(componentType, name, componentMaker);
          const newComponentIdentifier = buildComponentIdentifier(componentType, name, newMaker);
          const tx = runtimeSpecDb.db.transaction(() => {
            if (componentIdentityId) {
              runtimeSpecDb.db.prepare(`
                UPDATE component_identity
                SET maker = ?, source = ?, updated_at = datetime('now')
                WHERE category = ? AND id = ?
              `).run(newMaker, selectedSource, runtimeSpecDb.category, componentIdentityId);
            } else {
              runtimeSpecDb.db.prepare(`
                UPDATE component_identity
                SET maker = ?, source = ?, updated_at = datetime('now')
                WHERE category = ? AND component_type = ? AND canonical_name = ? AND maker = ?
              `).run(newMaker, selectedSource, runtimeSpecDb.category, componentType, name, componentMaker);
            }
            runtimeSpecDb.db.prepare(`
              UPDATE component_values
              SET component_maker = ?, updated_at = datetime('now')
              WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
            `).run(newMaker, runtimeSpecDb.category, componentType, name, componentMaker);
            runtimeSpecDb.db.prepare(`
              UPDATE item_component_links
              SET component_maker = ?, updated_at = datetime('now')
              WHERE category = ? AND component_type = ? AND component_name = ? AND component_maker = ?
            `).run(newMaker, runtimeSpecDb.category, componentType, name, componentMaker);
            if (oldComponentIdentifier !== newComponentIdentifier) {
              runtimeSpecDb.db.prepare(`
                UPDATE key_review_state
                SET component_identifier = ?, updated_at = datetime('now')
                WHERE category = ? AND target_kind = 'component_key' AND component_identifier = ?
              `).run(newComponentIdentifier, runtimeSpecDb.category, oldComponentIdentifier);
            }
          });
          tx();
          const sharedCandidate = acceptedCandidateId
            ? runtimeSpecDb.getCandidateById(acceptedCandidateId)
            : null;
          const sharedConfidence = Number.isFinite(Number(sharedCandidate?.score))
            ? Number(sharedCandidate.score)
            : 1.0;
          applySharedLaneState({
            specDb: runtimeSpecDb,
            category,
            targetKind: 'component_key',
            fieldKey: '__maker',
            componentIdentifier: newComponentIdentifier,
            propertyKey: '__maker',
            selectedCandidateId: acceptedCandidateId,
            selectedValue: newMaker,
            confidenceScore: sharedConfidence,
            laneAction: 'accept',
            nowIso,
          });
          if (acceptedCandidateId) {
            propagateCandidateLaneAcrossMatchingStates(runtimeSpecDb, runtimeSpecDb.category, {
              candidateId: acceptedCandidateId,
              lane: 'shared',
              action: 'accept',
              at: nowIso,
            });
          }
          await cascadeComponentChange({
            storage,
            outputRoot: OUTPUT_ROOT,
            category,
            componentType,
            componentName: name,
            componentMaker: newMaker,
            changedProperty: `${componentType}_brand`,
            newValue: newMaker,
            variancePolicy: 'authoritative',
            constraints: [],
            loadQueueState,
            saveQueueState,
            specDb: runtimeSpecDb,
          });
        }
      }

      if (review_status) {
        if (componentIdentityId) {
          runtimeSpecDb.db.prepare(`
            UPDATE component_identity
            SET review_status = ?, updated_at = datetime('now')
            WHERE category = ? AND id = ?
          `).run(review_status, runtimeSpecDb.category, componentIdentityId);
        } else {
          runtimeSpecDb.updateComponentReviewStatus(componentType, name, componentMaker, review_status);
        }
      }

      specDbCache.delete(category);
      broadcastWs('data-change', { type: 'component-override', category });
      return jsonRes(res, 200, { ok: true, sql_only: true });
    } catch (sqlErr) {
      return jsonRes(res, 500, {
        error: 'component_override_specdb_write_failed',
        message: sqlErr?.message || 'SpecDb write failed',
      });
    }

  }

  // Component shared-lane confirm without overriding value (context-only decision)
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-key-review-confirm' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);

    const runtimeSpecDb = await getSpecDbReady(category);
    if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const componentCtx = resolveComponentMutationContext(runtimeSpecDb, category, body);
    const componentType = String(componentCtx?.componentType || '').trim();
    const name = String(componentCtx?.componentName || '').trim();
    const componentMaker = String(componentCtx?.componentMaker || '').trim();
    const property = String(componentCtx?.property || body?.property || '').trim();
    if (!componentType || !name || !property) {
      return jsonRes(res, 400, {
        error: 'component_context_required',
        message: 'componentType/name/property or component slot identifiers are required',
      });
    }

    try {
      let propertyRow = null;
      if (property !== '__name' && property !== '__maker') {
        if (componentCtx?.componentValueRow) {
          propertyRow = componentCtx.componentValueRow;
        }
        try {
          if (!propertyRow) {
            const rows = runtimeSpecDb.getComponentValuesWithMaker(componentType, name, componentMaker) || [];
            propertyRow = rows.find((row) => String(row?.property_key || '').trim() === property) || null;
          }
        } catch { /* best-effort */ }
        if (!propertyRow) {
          try {
            const rows = runtimeSpecDb.getComponentValues(componentType, name) || [];
            propertyRow = rows.find((row) => String(row?.property_key || '').trim() === property) || null;
          } catch { /* best-effort */ }
        }
      }

      const componentIdentifier = buildComponentIdentifier(componentType, name, componentMaker);
      const existingState = runtimeSpecDb.getKeyReviewState({
        category,
        targetKind: 'component_key',
        fieldKey: property,
        componentIdentifier,
        propertyKey: property,
      });
      const resolvedValue = String(
        existingState?.selected_value
        ?? (property === '__name' ? name : null)
        ?? (property === '__maker' ? componentMaker : null)
        ?? propertyRow?.value
        ?? ''
      ).trim();
      const confirmScopeValue = String(
        body?.candidateValue
        ?? body?.candidate_value
        ?? ''
      ).trim();
      const stateValue = resolvedValue || confirmScopeValue;
      if (!isMeaningfulValue(stateValue)) {
        return jsonRes(res, 400, { error: 'confirm_value_required', message: 'No resolved value to confirm for this component property' });
      }

      const resolvedCandidateId = String(
        existingState?.selected_candidate_id
        || propertyRow?.accepted_candidate_id
        || ''
      ).trim() || null;
      const resolvedConfidence = Number.isFinite(Number(existingState?.confidence_score))
        ? Number(existingState.confidence_score)
        : (Number.isFinite(Number(propertyRow?.confidence))
          ? Number(propertyRow.confidence)
          : (Number.isFinite(Number(body?.candidateConfidence)) ? Number(body.candidateConfidence) : 1.0));
      const nowIso = new Date().toISOString();
      const state = applySharedLaneState({
        specDb: runtimeSpecDb,
        category,
        targetKind: 'component_key',
        fieldKey: property,
        componentIdentifier,
        propertyKey: property,
        selectedCandidateId: resolvedCandidateId,
        selectedValue: stateValue,
        confidenceScore: resolvedConfidence,
        laneAction: 'confirm',
        nowIso,
      });

      specDbCache.delete(category);
      broadcastWs('data-change', {
        type: 'component-key-review-confirm',
        category,
        componentType,
        name,
        property,
      });
      return jsonRes(res, 200, { ok: true, keyReviewState: state });
    } catch (err) {
      return jsonRes(res, 500, {
        error: 'component_key_review_confirm_failed',
        message: err?.message || 'Component key review confirm failed',
      });
    }
  }

  // Enum value override (add/remove/accept/confirm) — SQL-first runtime path
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'enum-override' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const action = String(body?.action || '').trim().toLowerCase() || 'add'; // 'add' | 'remove' | 'accept' | 'confirm'
    const { candidateId, candidateSource } = body;
    const runtimeSpecDb = await getSpecDbReady(category);
    if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const enumCtx = resolveEnumMutationContext(runtimeSpecDb, category, body);
    const field = String(enumCtx?.field || '').trim();
    const value = String(enumCtx?.value || '').trim();
    const listValueId = enumCtx?.listValueId ?? null;
    if (!field) return jsonRes(res, 400, { error: 'field required' });
    if (!value) return jsonRes(res, 400, { error: 'value required' });

    // SQL-first runtime path (legacy workbook_map/known_values writes removed from write path)
    try {
      const normalized = String(value).trim().toLowerCase();
      const nowIso = new Date().toISOString();
      const acceptedCandidateId = String(candidateId || '').trim() || null;
      const sourceToken = String(candidateSource || '').trim().toLowerCase();
      const priorValue = String(enumCtx?.oldValue || '').trim();
      const normalizedPrior = priorValue.toLowerCase();
      let cascadeAction = null;
      let cascadeValue = String(value).trim();
      let cascadeNewValue = null;
      let cascadePreAffectedProductIds = [];

      if (action === 'remove') {
        try {
          const preRows = [
            ...(runtimeSpecDb.getProductsForFieldValue(field, String(value).trim()) || []),
            ...(runtimeSpecDb.getProductsForListValue(field, String(value).trim()) || [])
          ];
          cascadePreAffectedProductIds = [...new Set(preRows.map((row) => row?.product_id).filter(Boolean))];
        } catch {
          cascadePreAffectedProductIds = [];
        }
        if (listValueId) {
          runtimeSpecDb.deleteListValueById(listValueId);
        } else {
          runtimeSpecDb.deleteListValue(field, String(value).trim());
        }
        cascadeAction = 'remove';
        cascadeValue = String(value).trim();
      } else if (action === 'accept') {
        const resolvedValue = String(value).trim();
        const normalizedResolved = resolvedValue.toLowerCase();
        const isRenameAccept = Boolean(priorValue) && normalizedPrior !== normalizedResolved;
        const oldLv = isRenameAccept
          ? (listValueId
            ? runtimeSpecDb.getListValueById(listValueId)
            : runtimeSpecDb.getListValueByFieldAndValue(field, priorValue))
          : null;
        if (isRenameAccept && oldLv) {
          cascadePreAffectedProductIds = oldLv?.id
            ? (runtimeSpecDb.renameListValueById(oldLv.id, resolvedValue, nowIso) || [])
            : (runtimeSpecDb.renameListValue(field, priorValue, resolvedValue, nowIso) || []);
          cascadeAction = 'rename';
          cascadeValue = priorValue;
          cascadeNewValue = resolvedValue;
        }
        const existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        const existingState = runtimeSpecDb.getKeyReviewState({
          category,
          targetKind: 'enum_key',
          fieldKey: field,
          enumValueNorm: normalizedResolved,
        });
        const priorState = isRenameAccept
          ? runtimeSpecDb.getKeyReviewState({
            category,
            targetKind: 'enum_key',
            fieldKey: field,
            enumValueNorm: normalizedPrior,
          })
          : null;
        const existingStateStatus = String(existingState?.ai_confirm_shared_status || '').trim().toLowerCase();
        const priorStateStatus = String(priorState?.ai_confirm_shared_status || '').trim().toLowerCase();
        const keepNeedsReview = existingStateStatus === 'pending'
          || priorStateStatus === 'pending'
          || Boolean(existingLv?.needs_review)
          || Boolean(oldLv?.needs_review);
        const looksWorkbook = acceptedCandidateId?.startsWith('wb_')
          || acceptedCandidateId?.startsWith('wb-')
          || acceptedCandidateId?.includes('::wb_')
          || acceptedCandidateId?.includes('::wb-')
          || sourceToken.includes('workbook')
          || sourceToken.includes('excel');
        const selectedSource = String(
          existingLv?.source
          || oldLv?.source
          || (looksWorkbook ? 'known_values' : 'pipeline')
        );
        const resolvedCandidateId = acceptedCandidateId
          || existingLv?.accepted_candidate_id
          || oldLv?.accepted_candidate_id
          || null;
        runtimeSpecDb.upsertListValue({
          fieldKey: field,
          value: resolvedValue,
          normalizedValue: normalized,
          source: selectedSource,
          overridden: false,
          needsReview: keepNeedsReview,
          sourceTimestamp: nowIso,
          acceptedCandidateId: resolvedCandidateId,
        });
        const sharedCandidate = resolvedCandidateId
          ? runtimeSpecDb.getCandidateById(resolvedCandidateId)
          : null;
        const sharedConfidence = Number.isFinite(Number(sharedCandidate?.score))
          ? Number(sharedCandidate.score)
          : 1.0;
        applySharedLaneState({
          specDb: runtimeSpecDb,
          category,
          targetKind: 'enum_key',
          fieldKey: field,
          enumValueNorm: normalized,
          selectedCandidateId: resolvedCandidateId,
          selectedValue: resolvedValue,
          confidenceScore: sharedConfidence,
          laneAction: 'accept',
          nowIso,
        });
        if (resolvedCandidateId) {
          propagateCandidateLaneAcrossMatchingStates(runtimeSpecDb, runtimeSpecDb.category, {
            candidateId: resolvedCandidateId,
            lane: 'shared',
            action: 'accept',
            at: nowIso,
          });
        }
      } else if (action === 'confirm') {
        const resolvedValue = String(value).trim();
        let existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        if (!existingLv) {
          runtimeSpecDb.upsertListValue({
            fieldKey: field,
            value: resolvedValue,
            normalizedValue: normalized,
            source: 'pipeline',
            enumPolicy: null,
            overridden: false,
            needsReview: false,
            sourceTimestamp: nowIso,
            acceptedCandidateId: null,
          });
          existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        } else {
          runtimeSpecDb.upsertListValue({
            fieldKey: field,
            value: resolvedValue,
            normalizedValue: normalized,
            source: existingLv.source || 'pipeline',
            enumPolicy: existingLv.enum_policy ?? null,
            overridden: Boolean(existingLv.overridden),
            needsReview: false,
            sourceTimestamp: nowIso,
            acceptedCandidateId: existingLv.accepted_candidate_id || null,
          });
          existingLv = runtimeSpecDb.getListValueByFieldAndValue(field, resolvedValue);
        }
        const resolvedCandidateId = existingLv?.accepted_candidate_id || null;
        const sharedCandidate = resolvedCandidateId
          ? runtimeSpecDb.getCandidateById(resolvedCandidateId)
          : null;
        const sharedConfidence = Number.isFinite(Number(sharedCandidate?.score))
          ? Number(sharedCandidate.score)
          : 1.0;
        applySharedLaneState({
          specDb: runtimeSpecDb,
          category,
          targetKind: 'enum_key',
          fieldKey: field,
          enumValueNorm: normalized,
          selectedCandidateId: resolvedCandidateId,
          selectedValue: resolvedValue,
          confidenceScore: sharedConfidence,
          laneAction: 'confirm',
          nowIso,
        });
      } else {
        const resolvedValue = String(value).trim();
        runtimeSpecDb.upsertListValue({
          fieldKey: field,
          value: resolvedValue,
          normalizedValue: normalized,
          source: 'manual',
          overridden: true,
          needsReview: false,
          sourceTimestamp: nowIso,
          acceptedCandidateId: null,
        });
        applySharedLaneState({
          specDb: runtimeSpecDb,
          category,
          targetKind: 'enum_key',
          fieldKey: field,
          enumValueNorm: normalized,
          selectedCandidateId: null,
          selectedValue: resolvedValue,
          confidenceScore: 1.0,
          laneAction: 'accept',
          nowIso,
        });
      }

      specDbCache.delete(category);

      if (cascadeAction) {
        await cascadeEnumChange({
          storage,
          outputRoot: OUTPUT_ROOT,
          category,
          field,
          action: cascadeAction,
          value: cascadeValue,
          newValue: cascadeNewValue,
          preAffectedProductIds: cascadePreAffectedProductIds,
          loadQueueState,
          saveQueueState,
          specDb: runtimeSpecDb,
        });
      }
      if (action === 'accept' || action === 'add') {
        try { await markEnumSuggestionStatus(category, field, value, 'accepted'); } catch { /* best-effort */ }
        if (priorValue) {
          try { await markEnumSuggestionStatus(category, field, priorValue, 'accepted'); } catch { /* best-effort */ }
        }
      } else if (action === 'remove') {
        try { await markEnumSuggestionStatus(category, field, value, 'dismissed'); } catch { /* best-effort */ }
      }

      broadcastWs('data-change', { type: 'enum-override', category, field, action: action || 'add' });
      return jsonRes(res, 200, { ok: true, field, action: action || 'add', persisted: 'specdb' });
    } catch (sqlErr) {
      return jsonRes(res, 500, {
        error: 'enum_override_specdb_write_failed',
        message: sqlErr?.message || 'SpecDb write failed',
      });
    }

  }

  // Atomic enum rename (remove old + add new in one transaction)
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'enum-rename' && method === 'POST') {
    const category = parts[1];
    const body = await readJsonBody(req);
    const newValueRaw = body?.newValue ?? body?.new_value;
    if (!newValueRaw) return jsonRes(res, 400, { error: 'newValue required' });
    const trimmedNew = String(newValueRaw).trim();
    if (!trimmedNew) return jsonRes(res, 400, { error: 'newValue cannot be empty' });
    const runtimeSpecDb = await getSpecDbReady(category);
    if (!runtimeSpecDb || !runtimeSpecDb.isSeeded()) {
      return jsonRes(res, 503, { error: 'specdb_not_ready', message: `SpecDb not ready for ${category}` });
    }
    const enumCtx = resolveEnumMutationContext(runtimeSpecDb, category, body);
    const field = String(enumCtx?.field || '').trim();
    const oldValue = String(enumCtx?.oldValue || '').trim();
    const listValueId = enumCtx?.listValueId ?? null;
    if (!field || !oldValue) {
      return jsonRes(res, 400, { error: 'field and oldValue (or listValueId) required' });
    }
    if (oldValue.toLowerCase() === trimmedNew.toLowerCase()) {
      return jsonRes(res, 200, { ok: true, field, changed: false });
    }

    // SQL-first runtime path (legacy workbook_map/known_values writes removed from write path)
    try {
      const affectedProductIds = listValueId
        ? (runtimeSpecDb.renameListValueById(listValueId, trimmedNew, new Date().toISOString()) || [])
        : (runtimeSpecDb.renameListValue(
          field,
          oldValue,
          trimmedNew,
          new Date().toISOString()
        ) || []);
      specDbCache.delete(category);

      await cascadeEnumChange({
        storage,
        outputRoot: OUTPUT_ROOT,
        category,
        field,
        action: 'rename',
        value: oldValue,
        newValue: trimmedNew,
        preAffectedProductIds: affectedProductIds,
        loadQueueState,
        saveQueueState,
        specDb: runtimeSpecDb,
      });
      try { await markEnumSuggestionStatus(category, field, oldValue, 'accepted'); } catch { /* best-effort */ }

      broadcastWs('data-change', { type: 'enum-rename', category, field });
      return jsonRes(res, 200, { ok: true, field, oldValue, newValue: trimmedNew, changed: true, persisted: 'specdb' });
    } catch (sqlErr) {
      return jsonRes(res, 500, {
        error: 'enum_rename_specdb_write_failed',
        message: sqlErr?.message || 'SpecDb write failed',
      });
    }

  }

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

  // ── Component AI Review endpoints ──────────────────────────────────

  // Get component review items (flagged for AI/human review)
  if (parts[0] === 'review-components' && parts[1] && parts[2] === 'component-review' && method === 'GET') {
    const category = parts[1];
    const specDb = getSpecDb(category);
    if (specDb) {
      await syncSyntheticCandidatesFromComponentReview({ category, specDb }).catch(() => ({ upserted: 0 }));
    }
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
      // AI batch may write alias overrides — invalidate cache so next product run picks them up
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

  // Process control — IndexLab mode only
  if (parts[0] === 'process' && parts[1] === 'start' && method === 'POST') {
    const body = await readJsonBody(req);
    const {
      category,
      productId,
      mode = 'indexlab',          // indexlab only
      extractionMode,             // balanced | aggressive | uber_aggressive
      profile,                    // fast | standard | thorough
      dryRun,                     // boolean — simulation mode
      resumeMode,                 // auto | force_resume | start_over
      resumeWindowHours,          // number — max age window for resume state
      reextractAfterHours,        // number — re-extract successful URLs older than this
      reextractIndexed,
      discoveryEnabled,           // boolean — enable provider discovery for this run
      searchProvider,             // none|google|bing|searxng|duckduckgo|dual
      phase2LlmEnabled,
      phase2LlmModel,
      phase3LlmTriageEnabled,
      phase3LlmModel,
      seed,
      fields,
      providers,
      indexlabOut,
      replaceRunning = true       // boolean — stop existing process before starting new one
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
    if ((hasPhase2LlmOverride && phase2LlmEnabled) || (hasPhase3LlmOverride && phase3LlmTriageEnabled)) {
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
    const status = await stopProcess(9000);
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

  // ── Brand Registry API ────────────────────────────────────────────

  // GET /api/v1/brands?category=mouse  (optional filter)
  if (parts[0] === 'brands' && method === 'GET' && !parts[1]) {
    const registry = await loadBrandRegistry(config);
    const category = params.get('category');
    if (category) {
      return jsonRes(res, 200, getBrandsForCategory(registry, category));
    }
    const all = Object.entries(registry.brands || {})
      .map(([slug, brand]) => ({ slug, ...brand }))
      .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));
    return jsonRes(res, 200, all);
  }

  // POST /api/v1/brands/seed  — auto-seed from activeFiltering
  // Accepts optional { category } body — 'all' or omitted scans all, otherwise just that category.
  // (must come before the generic POST /brands route)
  if (parts[0] === 'brands' && parts[1] === 'seed' && method === 'POST') {
    const body = await readJsonBody(req).catch(() => ({}));
    const result = await seedBrandsFromActiveFiltering({ config, category: body.category || 'all' });
    return jsonRes(res, 200, result);
  }

  // GET /api/v1/brands/{slug}/impact — impact analysis for rename/delete
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
        // Name changed — cascade rename first
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

    // No rename — standard update
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

  // ── Test Mode API ──────────────────────────────────────────────────

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
    const category = params.get('category') || '';
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

  // GET /api/v1/test-mode/status?sourceCategory=mouse — restore test mode state across navigations
  if (parts[0] === 'test-mode' && parts[1] === 'status' && method === 'GET') {
    const sourceCategory = params.get('sourceCategory') || 'mouse';
    const testCategory = `_test_${sourceCategory}`;
    const genDir = path.join(HELPER_ROOT, testCategory, '_generated');
    const genExists = await safeStat(genDir);

    if (!genExists) {
      return jsonRes(res, 200, { ok: true, exists: false, testCategory: '', testCases: [], runResults: [] });
    }

    // Category exists — read test products
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
        if (latest.summary) {
          runResults.push({
            productId: job.productId,
            status: 'complete',
            testCase: job._testCase,
            confidence: latest.summary?.confidence,
            coverage: latest.summary?.coverage_overall,
            completeness: latest.summary?.completeness_required,
            trafficLight: latest.summary?.traffic_light?.counts,
            constraintConflicts: latest.summary?.constraint_analysis?.contradictionCount || latest.summary?.constraint_analysis?.contradiction_count || 0,
            missingRequired: latest.summary?.missing_required_fields || [],
            curationSuggestions: latest.summary?.runtime_engine?.curation_suggestions_count || 0,
            runtimeFailures: (latest.summary?.runtime_engine?.failures || []).length
          });
        }
      } catch { /* no artifacts yet */ }
    }

    return jsonRes(res, 200, { ok: true, exists: true, testCategory, testCases, runResults });
  }

  // POST /api/v1/test-mode/generate-products  { category }
  if (parts[0] === 'test-mode' && parts[1] === 'generate-products' && method === 'POST') {
    const body = await readJsonBody(req);
    const category = body.category;
    if (!category || !category.startsWith('_test_')) {
      return jsonRes(res, 400, { ok: false, error: 'invalid_test_category' });
    }

    const productsDir = path.join('fixtures', 's3', 'specs', 'inputs', category, 'products');
    await fs.mkdir(productsDir, { recursive: true });

    // Build contract analysis to get dynamic scenario defs
    let contractAnalysis = null;
    try {
      contractAnalysis = await analyzeContract(HELPER_ROOT, category);
    } catch { /* non-fatal — will use default scenarios */ }

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
        // Brand exists — ensure test category is in its categories list
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
    const category = body.category;
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
      } catch { /* non-fatal — AI review is optional */ }
    }

    broadcastWs('data-change', { type: 'review', category });
    return jsonRes(res, 200, { ok: true, results });
  }

  // POST /api/v1/test-mode/validate  { category }
  if (parts[0] === 'test-mode' && parts[1] === 'validate' && method === 'POST') {
    const body = await readJsonBody(req);
    const category = body.category;
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

    // Clean up test brands — remove test category from brand registrations
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

// ── Static File Serving ──────────────────────────────────────────────
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

// ── WebSocket ────────────────────────────────────────────────────────
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

// ── File Watchers ────────────────────────────────────────────────────
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

// ── HTTP Server ──────────────────────────────────────────────────────
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
