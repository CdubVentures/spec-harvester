import crypto from 'node:crypto';
import { buildRunId, normalizeWhitespace, wait } from '../utils/common.js';
import { runWithRetry } from './pipelineSharedHelpers.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { loadProductCatalog } from '../catalog/productCatalog.js';
import { SourcePlanner, buildSourceSummary } from '../planner/sourcePlanner.js';
import { PlaywrightFetcher, DryRunFetcher, HttpFetcher, CrawleeFetcher } from '../fetcher/playwrightFetcher.js';
import { selectFetcherMode } from '../fetcher/fetcherMode.js';
import { extractCandidatesFromPage } from '../extractors/fieldExtractor.js';
import { evaluateAnchorConflicts, mergeAnchorConflictLists } from '../validator/anchors.js';
import {
  buildIdentityReport,
  evaluateSourceIdentity,
  evaluateIdentityGate
} from '../validator/identityGate.js';
import {
  computeCompletenessRequired,
  computeCoverageOverall,
  computeConfidence
} from '../scoring/qualityScoring.js';
import { evaluateValidationGate } from '../validator/qualityGate.js';
import { runConsensusEngine, applySelectionPolicyReducers } from '../scoring/consensusEngine.js';
import { applyListUnionReducers } from '../scoring/listUnionReducer.js';
import { buildIdentityObject, buildAbortedNormalized, buildValidatedNormalized } from '../normalizer/mouseNormalizer.js';
import { exportRunArtifacts } from '../exporter/exporter.js';
import { writeFinalOutputs } from '../exporter/finalExporter.js';
import { buildMarkdownSummary } from '../exporter/summaryWriter.js';
import { EventLogger } from '../logger.js';
import { createAdapterManager } from '../adapters/index.js';
import { discoverCandidateSources } from '../discovery/searchDiscovery.js';
import {
  applyLearningSeeds,
  loadLearningProfile,
  persistLearningProfile
} from '../learning/selfImproveLoop.js';
import {
  buildEvidenceCandidateFingerprint,
  buildEvidencePack
} from '../llm/evidencePack.js';
import {
  extractCandidatesLLM
} from '../llm/extractCandidatesLLM.js';
import { DeterministicParser } from '../extract/deterministicParser.js';
import { ComponentResolver } from '../extract/componentResolver.js';
import { retrieveGoldenExamples } from '../llm/goldenExamples.js';
import {
  writeSummaryMarkdownLLM
} from '../llm/writeSummaryLLM.js';
import { validateCandidatesLLM } from '../llm/validateCandidatesLLM.js';
import {
  loadSourceIntel,
  persistSourceIntel
} from '../intel/sourceIntel.js';
import {
  aggregateEndpointSignals,
  mineEndpointSignals
} from '../intel/endpointMiner.js';
import {
  aggregateTemporalSignals,
  extractTemporalSignals
} from '../intel/temporalSignals.js';
import {
  buildSiteFingerprint,
  computeParserHealth
} from '../intel/siteFingerprint.js';
import { evaluateConstraintGraph } from '../scoring/constraintSolver.js';
import { buildHypothesisQueue, nextBestUrlsFromHypotheses } from '../learning/hypothesisQueue.js';
import { appendCostLedgerEntry, readBillingSnapshot } from '../billing/costLedger.js';
import { createBudgetGuard } from '../billing/budgetGuard.js';
import { normalizeCostRates } from '../billing/costRates.js';
import { loadCategoryBrain, updateCategoryBrain } from '../learning/categoryBrain.js';
import {
  applySupportiveFillToResult,
  buildSupportiveSyntheticSources,
  loadHelperCategoryData,
  resolveHelperProductContext
} from '../helperFiles/index.js';
import {
  applyComponentLibraryPriors,
  loadComponentLibrary,
  updateComponentLibrary
} from '../components/library.js';
import { runDeterministicCritic } from '../validator/critic.js';
import { buildTrafficLight } from '../validator/trafficLight.js';
import { normalizeFieldList, toRawFieldKey } from '../utils/fieldKeys.js';
import { createFieldRulesEngine } from '../engine/fieldRulesEngine.js';
import { applyRuntimeFieldRules } from '../engine/runtimeGate.js';
import {
  appendEnumCurationSuggestions,
  appendComponentCurationSuggestions,
  appendComponentReviewItems,
  appendComponentIdentityObservations
} from '../engine/curationSuggestions.js';
import {
  writeCategoryReviewArtifacts,
  writeProductReviewArtifacts
} from '../review/reviewGridData.js';
import { CortexClient } from '../llm/cortex_client.js';
import { AggressiveOrchestrator } from '../extract/aggressiveOrchestrator.js';
import { createFrontier } from '../research/frontierDb.js';
import { RuntimeTraceWriter } from '../runtime/runtimeTraceWriter.js';
import { computeNeedSet } from '../indexlab/needsetEngine.js';
import { buildIndexingSchemaPackets } from '../indexlab/indexingSchemaPackets.js';
import { validateIndexingSchemaPackets } from '../indexlab/indexingSchemaPacketsValidator.js';
import { buildPhase07PrimeSources } from '../retrieve/primeSourcesBuilder.js';
import {
  normalizeHttpUrlList,
  shouldQueueLlmRetry,
  buildNextLlmRetryRows,
  collectPlannerPendingUrls,
  normalizeResumeMode,
  isResumeStateFresh,
  resumeStateAgeHours,
  selectReextractSeedUrls,
  buildNextSuccessRows
} from '../runtime/indexingResume.js';
import { UberAggressiveOrchestrator } from '../research/uberAggressiveOrchestrator.js';
import {
  availabilityClassForField,
  undisclosedThresholdForField
} from '../learning/fieldAvailability.js';
import { applyInferencePolicies } from '../inference/inferField.js';

function normalizeIdentityToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function ambiguityLevelFromFamilyCount(count = 0) {
  const n = Math.max(0, Number.parseInt(String(count || 0), 10) || 0);
  if (n >= 9) return 'extra_hard';
  if (n >= 6) return 'very_hard';
  if (n >= 4) return 'hard';
  if (n >= 2) return 'medium';
  if (n === 1) return 'easy';
  return 'unknown';
}

function normalizeAmbiguityLevel(value = '') {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'easy' || token === 'low') return 'easy';
  if (token === 'medium' || token === 'mid') return 'medium';
  if (token === 'hard' || token === 'high') return 'hard';
  if (token === 'very_hard' || token === 'very-hard' || token === 'very hard') return 'very_hard';
  if (token === 'extra_hard' || token === 'extra-hard' || token === 'extra hard') return 'extra_hard';
  return 'unknown';
}

async function resolveIdentityAmbiguitySnapshot({ config, category = '', identityLock = {} } = {}) {
  const brandToken = normalizeIdentityToken(identityLock?.brand);
  const modelToken = normalizeIdentityToken(identityLock?.model);
  if (!brandToken || !modelToken) {
    return {
      family_model_count: 0,
      ambiguity_level: 'unknown',
      source: 'missing_identity'
    };
  }

  try {
    const catalog = await loadProductCatalog(config || {}, String(category || '').trim().toLowerCase());
    const rows = Object.values(catalog?.products || {});
    const familyCount = rows.filter((row) =>
      normalizeIdentityToken(row?.brand) === brandToken
      && normalizeIdentityToken(row?.model) === modelToken
    ).length;
    const safeCount = Math.max(1, familyCount);
    return {
      family_model_count: safeCount,
      ambiguity_level: ambiguityLevelFromFamilyCount(safeCount),
      source: 'catalog'
    };
  } catch {
    return {
      family_model_count: 1,
      ambiguity_level: 'easy',
      source: 'fallback'
    };
  }
}

function resolveIdentityLockStatus(identityLock = {}) {
  const brand = normalizeIdentityToken(identityLock?.brand);
  const model = normalizeIdentityToken(identityLock?.model);
  const variant = normalizeIdentityToken(identityLock?.variant);
  const sku = normalizeIdentityToken(identityLock?.sku);
  const lockCount = [brand, model, variant, sku].filter(Boolean).length;
  if (brand && model && (variant || sku)) {
    return 'locked_full';
  }
  if (brand && model) {
    return 'locked_brand_model';
  }
  if (lockCount > 0) {
    return 'locked_partial';
  }
  return 'unlocked';
}

function buildRunIdentityFingerprint({ category = '', productId = '', identityLock = {} } = {}) {
  const lockBrand = normalizeIdentityToken(identityLock?.brand);
  const lockModel = normalizeIdentityToken(identityLock?.model);
  const lockVariant = normalizeIdentityToken(identityLock?.variant);
  const lockSku = normalizeIdentityToken(identityLock?.sku);
  const seed = [
    normalizeIdentityToken(category),
    normalizeIdentityToken(productId),
    lockBrand,
    lockModel,
    lockVariant,
    lockSku
  ].join('|');
  return `sha256:${sha256(seed)}`;
}

function parseMinEvidenceRefs(value, fallback = 1) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Number.parseInt(String(fallback || 1), 10) || 1);
  }
  return Math.max(1, parsed);
}

function sendModeIncludesPrime(value = '') {
  const token = String(value || '').trim().toLowerCase();
  return token.includes('prime');
}

function selectPreferredRouteRow(rows = [], scope = 'field') {
  const scoped = (Array.isArray(rows) ? rows : [])
    .filter((row) => String(row?.scope || '').trim().toLowerCase() === String(scope || '').trim().toLowerCase());
  if (scoped.length === 0) {
    return null;
  }
  return scoped
    .slice()
    .sort((a, b) => {
      const effortA = Number.parseInt(String(a?.effort ?? 0), 10) || 0;
      const effortB = Number.parseInt(String(b?.effort ?? 0), 10) || 0;
      if (effortA !== effortB) return effortB - effortA;
      const minA = parseMinEvidenceRefs(a?.llm_output_min_evidence_refs_required, 1);
      const minB = parseMinEvidenceRefs(b?.llm_output_min_evidence_refs_required, 1);
      return minB - minA;
    })[0] || null;
}

function deriveRouteMatrixPolicy({
  routeRows = [],
  categoryConfig = null
} = {}) {
  const preferredField = selectPreferredRouteRow(routeRows, 'field');
  const preferredComponent = selectPreferredRouteRow(routeRows, 'component');
  const preferredList = selectPreferredRouteRow(routeRows, 'list');
  const ruleMinRefs = [];
  const fieldRules = categoryConfig?.fieldRules?.fields || {};
  for (const rule of Object.values(fieldRules || {})) {
    if (!rule || typeof rule !== 'object') continue;
    ruleMinRefs.push(parseMinEvidenceRefs(rule?.evidence?.min_evidence_refs ?? rule?.min_evidence_refs ?? 1, 1));
  }
  const routeMinRefs = (Array.isArray(routeRows) ? routeRows : [])
    .map((row) => parseMinEvidenceRefs(row?.llm_output_min_evidence_refs_required, 1));
  const minEvidenceRefsEffective = Math.max(
    1,
    ...ruleMinRefs,
    ...routeMinRefs
  );
  const scalarSend = String(
    preferredField?.scalar_linked_send || 'scalar value + prime sources'
  ).trim();
  const componentSend = String(
    preferredComponent?.component_values_send || 'component values + prime sources'
  ).trim();
  const listSend = String(
    preferredList?.list_values_send || 'list values prime sources'
  ).trim();
  const primeVisualSend =
    sendModeIncludesPrime(scalarSend) ||
    sendModeIncludesPrime(componentSend) ||
    sendModeIncludesPrime(listSend);

  return {
    scalar_linked_send: scalarSend,
    component_values_send: componentSend,
    list_values_send: listSend,
    llm_output_min_evidence_refs_required: minEvidenceRefsEffective,
    min_evidence_refs_effective: minEvidenceRefsEffective,
    prime_sources_visual_send: primeVisualSend,
    table_linked_send: primeVisualSend
  };
}

async function loadRouteMatrixPolicyForRun({
  config = {},
  category = '',
  categoryConfig = null,
  logger = null
} = {}) {
  const categoryToken = String(category || '').trim().toLowerCase();
  let routeRows = [];
  if (categoryToken) {
    let specDb = null;
    try {
      const { SpecDb } = await import('../db/specDb.js');
      const dbPath = `${String(config.specDbDir || '.specfactory_tmp').replace(/[\\\/]+$/, '')}/${categoryToken}/spec.sqlite`;
      specDb = new SpecDb({
        dbPath,
        category: categoryToken
      });
      routeRows = specDb.getLlmRouteMatrix();
    } catch (error) {
      logger?.warn?.('route_matrix_policy_load_failed', {
        category: categoryToken,
        message: error?.message || 'unknown_error'
      });
    } finally {
      try {
        specDb?.close?.();
      } catch {
        // best effort
      }
    }
  }
  const derived = deriveRouteMatrixPolicy({
    routeRows,
    categoryConfig
  });
  return {
    ...derived,
    source: routeRows.length > 0 ? 'spec_db' : 'category_rules_default',
    row_count: routeRows.length
  };
}

function bestIdentityFromSources(sourceResults, identityLock = {}) {
  const expectedVariant = normalizeIdentityToken(identityLock?.variant);
  const identityMatched = (sourceResults || []).filter((source) => source.identity?.match);
  const pool = identityMatched.length > 0 ? identityMatched : (sourceResults || []);
  const sorted = [...pool].sort((a, b) => {
    const aMatched = a.identity?.match ? 1 : 0;
    const bMatched = b.identity?.match ? 1 : 0;
    if (bMatched !== aMatched) {
      return bMatched - aMatched;
    }
    if ((b.identity?.score || 0) !== (a.identity?.score || 0)) {
      return (b.identity?.score || 0) - (a.identity?.score || 0);
    }

    const aVariant = normalizeIdentityToken(a.identityCandidates?.variant);
    const bVariant = normalizeIdentityToken(b.identityCandidates?.variant);
    const variantScore = (variant) => {
      if (expectedVariant) {
        if (variant === expectedVariant) {
          return 2;
        }
        if (variant && (variant.includes(expectedVariant) || expectedVariant.includes(variant))) {
          return 1;
        }
        if (!variant) {
          return 0.25;
        }
        return 0;
      }
      return variant ? 0 : 1;
    };
    const aVariantScore = variantScore(aVariant);
    const bVariantScore = variantScore(bVariant);
    if (bVariantScore !== aVariantScore) {
      return bVariantScore - aVariantScore;
    }

    return (a.tier || 99) - (b.tier || 99);
  });
  return sorted[0]?.identityCandidates || {};
}

const METHOD_PRIORITY = {
  network_json: 5,
  adapter_api: 5,
  spec_table_match: 5,
  parse_template: 4.5,
  json_ld: 4,
  embedded_state: 4,
  ldjson: 3,
  pdf_table: 3,
  pdf: 3,
  dom: 2,
  component_db_inference: 2,
  llm_extract: 1
};

function parseFirstNumber(value) {
  const text = String(value || '');
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const num = Number.parseFloat(match[0]);
  return Number.isFinite(num) ? num : null;
}

function hasKnownFieldValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined' && token !== 'n/a';
}

const PASS_TARGET_EXEMPT_FIELDS = new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku']);
const RUN_DEDUPE_MODE = 'serp_url+content_hash';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function normalizeHostToken(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^www\./, '');
}

function hostFromHttpUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return normalizeHostToken(new URL(raw).hostname);
  } catch {
    return '';
  }
}

function compactQueryText(value = '') {
  return normalizeWhitespace(String(value || '').replace(/\s+/g, ' ').trim());
}

function buildRepairSearchQuery({
  domain = '',
  brand = '',
  model = '',
  variant = ''
} = {}) {
  const host = normalizeHostToken(domain);
  if (!host) return '';
  const identity = compactQueryText([brand, model, variant].map((row) => String(row || '').trim()).filter(Boolean).join(' '));
  const identitySegment = identity ? `"${identity}"` : '';
  return compactQueryText(`site:${host} ${identitySegment} (spec OR manual OR pdf OR "user guide")`);
}

function classifyFetchOutcome({
  status = 0,
  message = '',
  contentType = '',
  html = ''
} = {}) {
  const code = toInt(status, 0);
  const msg = String(message || '').toLowerCase();
  const contentTypeToken = String(contentType || '').toLowerCase();
  const htmlSize = String(html || '').trim().length;

  const looksBotChallenge = /(captcha|cloudflare|cf-ray|bot.?challenge|are you human|human verification|robot check)/.test(msg);
  const looksRateLimited = /(429|rate.?limit|too many requests|throttl)/.test(msg);
  const looksLoginWall = /(401|sign[ -]?in|login|authenticate|account required|subscription required)/.test(msg);
  const looksBlocked = /(403|forbidden|blocked|access denied|denied)/.test(msg);
  const looksTimeout = /(timeout|timed out|etimedout|econnreset|econnrefused|socket hang up|network error|dns)/.test(msg);
  const looksBadContent = /(parse|json|xml|cheerio|dom|extract|malformed|invalid content|unsupported content)/.test(msg);

  if (code >= 200 && code < 400) {
    if (contentTypeToken.includes('application/octet-stream') && htmlSize === 0) {
      return 'bad_content';
    }
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

function createFetchOutcomeCounters() {
  return FETCH_OUTCOME_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function createHostBudgetRow() {
  return {
    started_count: 0,
    completed_count: 0,
    dedupe_hits: 0,
    evidence_used: 0,
    parse_fail_count: 0,
    next_retry_ts: '',
    outcome_counts: createFetchOutcomeCounters()
  };
}

function ensureHostBudgetRow(mapRef, host = '') {
  const token = String(host || '').trim().toLowerCase() || '__unknown__';
  if (!mapRef.has(token)) {
    mapRef.set(token, createHostBudgetRow());
  }
  return mapRef.get(token);
}

function noteHostRetryTs(hostRow, retryTs = '') {
  if (!hostRow) return;
  const token = String(retryTs || '').trim();
  if (!token) return;
  const retryMs = Date.parse(token);
  if (!Number.isFinite(retryMs)) return;
  const currentMs = Date.parse(String(hostRow.next_retry_ts || ''));
  if (!Number.isFinite(currentMs) || retryMs > currentMs) {
    hostRow.next_retry_ts = new Date(retryMs).toISOString();
  }
}

function bumpHostOutcome(hostRow, outcome = '') {
  if (!hostRow) return;
  const token = String(outcome || '').trim().toLowerCase();
  if (!token) return;
  if (!Object.prototype.hasOwnProperty.call(hostRow.outcome_counts, token)) {
    hostRow.outcome_counts[token] = 0;
  }
  hostRow.outcome_counts[token] += 1;
}

function applyHostBudgetBackoff(hostRow, { status = 0, outcome = '', config = {}, nowMs = Date.now() } = {}) {
  if (!hostRow) return;
  const code = toInt(status, 0);
  const token = String(outcome || '').trim().toLowerCase();
  let seconds = 0;
  if (code === 429 || token === 'rate_limited') {
    seconds = Math.max(60, toInt(config.frontierCooldown429BaseSeconds, 15 * 60));
  } else if (code === 403 || token === 'blocked' || token === 'login_wall' || token === 'bot_challenge') {
    seconds = Math.max(60, toInt(config.frontierCooldown403BaseSeconds, 30 * 60));
  } else if (token === 'network_timeout' || token === 'fetch_error' || token === 'server_error') {
    seconds = Math.max(60, toInt(config.frontierCooldownTimeoutSeconds, 6 * 60 * 60));
  }
  if (seconds > 0) {
    noteHostRetryTs(hostRow, new Date(nowMs + (seconds * 1000)).toISOString());
  }
}

function resolveHostBudgetState(hostRow, nowMs = Date.now()) {
  const row = hostRow || createHostBudgetRow();
  const outcomes = row.outcome_counts || createFetchOutcomeCounters();
  const started = toInt(row.started_count, 0);
  const completed = toInt(row.completed_count, 0);
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
  score -= toInt(row.dedupe_hits, 0);
  score += Math.min(12, toInt(outcomes.ok, 0) * 2);
  score += Math.min(10, toInt(row.evidence_used, 0) * 2);
  score = Math.max(0, Math.min(100, score));

  const nextRetryMs = Date.parse(String(row.next_retry_ts || ''));
  const cooldownSeconds = Number.isFinite(nextRetryMs)
    ? Math.max(0, Math.ceil((nextRetryMs - nowMs) / 1000))
    : 0;

  const blockedSignals = (
    toInt(outcomes.blocked, 0)
    + toInt(outcomes.rate_limited, 0)
    + toInt(outcomes.login_wall, 0)
    + toInt(outcomes.bot_challenge, 0)
  );

  let state = 'open';
  if (cooldownSeconds > 0 && (score <= 30 || blockedSignals >= 2)) {
    state = 'blocked';
  } else if (cooldownSeconds > 0) {
    state = 'backoff';
  } else if (score < 55 || toInt(outcomes.bad_content, 0) > 0 || toInt(row.parse_fail_count, 0) > 0) {
    state = 'degraded';
  } else if (inFlight > 0) {
    state = 'active';
  }

  return {
    score: Number(score.toFixed(3)),
    state,
    cooldown_seconds: cooldownSeconds,
    next_retry_ts: cooldownSeconds > 0 ? String(row.next_retry_ts || '').trim() || null : null
  };
}

function sha256(value = '') {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function resolveRuntimeControlKey(storage, config = {}) {
  const raw = String(config.runtimeControlFile || '_runtime/control/runtime_overrides.json').trim();
  if (!raw) {
    return storage.resolveOutputKey('_runtime/control/runtime_overrides.json');
  }
  if (raw.startsWith(`${config.s3OutputPrefix || 'specs/outputs'}/`)) {
    return raw;
  }
  return storage.resolveOutputKey(raw);
}

function resolveIndexingResumeKey(storage, category, productId) {
  return storage.resolveOutputKey('_runtime', 'indexing_resume', category, `${productId}.json`);
}

function defaultRuntimeOverrides() {
  return {
    pause: false,
    max_urls_per_product: null,
    max_queries_per_product: null,
    blocked_domains: [],
    force_high_fields: [],
    disable_llm: false,
    disable_search: false,
    notes: ''
  };
}

function normalizeRuntimeOverrides(payload = {}) {
  const input = payload && typeof payload === 'object' ? payload : {};
  return {
    ...defaultRuntimeOverrides(),
    ...input,
    pause: Boolean(input.pause),
    max_urls_per_product: input.max_urls_per_product === null || input.max_urls_per_product === undefined
      ? null
      : Math.max(1, toInt(input.max_urls_per_product, 0)),
    max_queries_per_product: input.max_queries_per_product === null || input.max_queries_per_product === undefined
      ? null
      : Math.max(1, toInt(input.max_queries_per_product, 0)),
    blocked_domains: Array.isArray(input.blocked_domains)
      ? [...new Set(input.blocked_domains.map((row) => String(row || '').trim().toLowerCase().replace(/^www\./, '')).filter(Boolean))]
      : [],
    force_high_fields: Array.isArray(input.force_high_fields)
      ? [...new Set(input.force_high_fields.map((row) => String(row || '').trim()).filter(Boolean))]
      : [],
    disable_llm: Boolean(input.disable_llm),
    disable_search: Boolean(input.disable_search),
    notes: String(input.notes || '')
  };
}

function applyRuntimeOverridesToPlanner(planner, overrides = {}) {
  if (!planner || typeof planner !== 'object') {
    return;
  }
  if (Number.isFinite(Number(overrides.max_urls_per_product)) && Number(overrides.max_urls_per_product) > 0) {
    planner.maxUrls = Math.max(1, Number(overrides.max_urls_per_product));
  }
  for (const host of overrides.blocked_domains || []) {
    planner.blockHost(host, 'runtime_override_blocked_domain');
  }
}

function stableHash(value) {
  let hash = 0;
  const input = String(value || '');
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function collectContributionFields({
  fieldOrder,
  normalized,
  provenance
}) {
  const llmFields = [];
  const componentFields = [];
  for (const field of fieldOrder || []) {
    if (!hasKnownFieldValue(normalized?.fields?.[field])) {
      continue;
    }
    const evidence = Array.isArray(provenance?.[field]?.evidence)
      ? provenance[field].evidence
      : [];
    if (evidence.some((row) => String(row?.method || '').toLowerCase().includes('llm'))) {
      llmFields.push(field);
    }
    if (evidence.some((row) => String(row?.method || '').toLowerCase() === 'component_db')) {
      componentFields.push(field);
    }
  }
  return {
    llmFields: [...new Set(llmFields)],
    componentFields: [...new Set(componentFields)]
  };
}

function plausibilityBoost(field, value) {
  const num = parseFirstNumber(value);
  if (num === null) {
    return 0;
  }

  if (field === 'weight') {
    return num >= 20 && num <= 250 ? 2 : -6;
  }
  if (field === 'lngth' || field === 'width' || field === 'height') {
    return num >= 20 && num <= 200 ? 2 : -6;
  }
  if (field === 'dpi') {
    return num >= 100 && num <= 100000 ? 2 : -6;
  }
  if (field === 'polling_rate') {
    return num >= 125 && num <= 10000 ? 2 : -6;
  }
  if (field === 'ips') {
    return num >= 50 && num <= 1000 ? 2 : -4;
  }
  if (field === 'acceleration') {
    return num >= 10 && num <= 200 ? 2 : -4;
  }

  return 0;
}

function candidateScore(candidate) {
  const methodScore = METHOD_PRIORITY[candidate.method] || 0;
  const keyPath = String(candidate.keyPath || '').toLowerCase();
  const field = String(candidate.field || '');
  const numeric = parseFirstNumber(candidate.value);
  let score = methodScore * 10;
  if (field && keyPath.includes(field.toLowerCase())) {
    score += 2;
  }
  if (numeric !== null) {
    if (field === 'dpi') {
      score += Math.min(6, numeric / 8000);
    } else if (field === 'polling_rate') {
      score += Math.min(6, numeric / 1000);
    } else if (field === 'ips' || field === 'acceleration') {
      score += Math.min(3, numeric / 300);
    }
  }
  score += plausibilityBoost(field, candidate.value);
  return score;
}

function buildCandidateFieldMap(fieldCandidates) {
  const map = {};
  const scoreByField = {};
  for (const row of fieldCandidates || []) {
    if (String(row.value || '').trim().toLowerCase() === 'unk') {
      continue;
    }
    const score = candidateScore(row);
    if (!Object.prototype.hasOwnProperty.call(scoreByField, row.field) || score > scoreByField[row.field]) {
      scoreByField[row.field] = score;
      map[row.field] = row.value;
    }
  }
  return map;
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const candidate of candidates || []) {
    const key = `${candidate.field}|${candidate.value}|${candidate.method}|${candidate.keyPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function markSatisfiedLlmFields(fieldSet, fields = [], anchors = {}) {
  if (!(fieldSet instanceof Set)) {
    return;
  }
  for (const field of fields || []) {
    const token = String(field || '').trim();
    if (!token) {
      continue;
    }
    if (isIdentityLockedField(token) || isAnchorLocked(token, anchors)) {
      continue;
    }
    fieldSet.add(token);
  }
}

function refreshFieldsBelowPassTarget({
  fieldOrder = [],
  provenance = {},
  criticalFieldSet = new Set()
}) {
  const fieldsBelowPassTarget = [];
  const criticalFieldsBelowPassTarget = [];
  for (const field of fieldOrder || []) {
    if (PASS_TARGET_EXEMPT_FIELDS.has(field)) {
      continue;
    }
    const bucket = provenance?.[field] || {};
    const passTarget = Number.parseInt(String(bucket?.pass_target ?? 1), 10);
    const meetsPassTarget = Boolean(bucket?.meets_pass_target);
    if (passTarget <= 0) {
      continue;
    }
    if (!meetsPassTarget) {
      fieldsBelowPassTarget.push(field);
      if (criticalFieldSet.has(field)) {
        criticalFieldsBelowPassTarget.push(field);
      }
    }
  }
  return {
    fieldsBelowPassTarget,
    criticalFieldsBelowPassTarget
  };
}

function selectAggressiveEvidencePack(sourceResults = []) {
  const ranked = (sourceResults || [])
    .filter((row) => row?.llmEvidencePack)
    .sort((a, b) => {
      const aIdentity = a.identity?.match ? 1 : 0;
      const bIdentity = b.identity?.match ? 1 : 0;
      if (bIdentity !== aIdentity) {
        return bIdentity - aIdentity;
      }
      const aAnchor = (a.anchorCheck?.majorConflicts || []).length;
      const bAnchor = (b.anchorCheck?.majorConflicts || []).length;
      if (aAnchor !== bAnchor) {
        return aAnchor - bAnchor;
      }
      const aSnippets = Number(a.llmEvidencePack?.meta?.snippet_count || 0);
      const bSnippets = Number(b.llmEvidencePack?.meta?.snippet_count || 0);
      if (bSnippets !== aSnippets) {
        return bSnippets - aSnippets;
      }
      return Number(a.tier || 99) - Number(b.tier || 99);
    });
  return ranked[0]?.llmEvidencePack || null;
}

function selectAggressiveDomHtml(artifactsByHost = {}) {
  let best = '';
  for (const row of Object.values(artifactsByHost || {})) {
    const html = String(row?.html || '');
    if (html.length > best.length) {
      best = html;
    }
  }
  return best;
}

function buildDomSnippetArtifact(html = '', maxChars = 3_600) {
  const pageHtml = String(html || '');
  if (!pageHtml) return null;
  const cap = Math.max(600, Math.min(20_000, Number(maxChars || 3_600)));
  const candidates = [
    { kind: 'table', pattern: /<table[\s\S]*?<\/table>/i },
    { kind: 'definition_list', pattern: /<dl[\s\S]*?<\/dl>/i },
    { kind: 'spec_section', pattern: /<(section|div)[^>]*(?:spec|technical|feature|performance)[^>]*>[\s\S]*?<\/\1>/i }
  ];
  for (const candidate of candidates) {
    const match = pageHtml.match(candidate.pattern);
    if (match?.[0]) {
      const snippetHtml = String(match[0]).slice(0, cap);
      return {
        kind: candidate.kind,
        html: snippetHtml,
        char_count: snippetHtml.length
      };
    }
  }
  const lower = pageHtml.toLowerCase();
  const pivot = Math.max(0, lower.search(/spec|technical|feature|performance|dimension|polling|sensor|weight/));
  const start = Math.max(0, pivot > 0 ? pivot - Math.floor(cap * 0.25) : 0);
  const end = Math.min(pageHtml.length, start + cap);
  const snippetHtml = pageHtml.slice(start, end);
  if (!snippetHtml.trim()) return null;
  return {
    kind: 'html_window',
    html: snippetHtml,
    char_count: snippetHtml.length
  };
}

function screenshotMimeType(format = '') {
  const token = String(format || '').trim().toLowerCase();
  return token === 'png' ? 'image/png' : 'image/jpeg';
}

function screenshotExtension(format = '') {
  const token = String(format || '').trim().toLowerCase();
  return token === 'png' ? 'png' : 'jpg';
}

function sha256Buffer(value) {
  if (!Buffer.isBuffer(value) || value.length === 0) {
    return '';
  }
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function normalizedSnippetRows(evidencePack) {
  if (!evidencePack) {
    return [];
  }
  if (Array.isArray(evidencePack.snippets)) {
    return evidencePack.snippets
      .map((row) => ({
        id: String(row?.id || '').trim(),
        text: normalizeWhitespace(String(row?.normalized_text || row?.text || '')).toLowerCase()
      }))
      .filter((row) => row.id && row.text);
  }
  if (evidencePack.snippets && typeof evidencePack.snippets === 'object') {
    return Object.entries(evidencePack.snippets)
      .map(([id, row]) => ({
        id: String(id || '').trim(),
        text: normalizeWhitespace(String(row?.normalized_text || row?.text || '')).toLowerCase()
      }))
      .filter((row) => row.id && row.text);
  }
  return [];
}

function enrichFieldCandidatesWithEvidenceRefs(fieldCandidates = [], evidencePack = null) {
  const deterministicBindings = evidencePack?.candidate_bindings && typeof evidencePack.candidate_bindings === 'object'
    ? evidencePack.candidate_bindings
    : {};
  const snippetRows = normalizedSnippetRows(evidencePack);
  if (!snippetRows.length && !Object.keys(deterministicBindings).length) {
    return fieldCandidates;
  }

  return (fieldCandidates || []).map((candidate) => {
    const existingRefs = Array.isArray(candidate?.evidenceRefs)
      ? candidate.evidenceRefs.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (existingRefs.length > 0) {
      return candidate;
    }

    const deterministicFingerprint = buildEvidenceCandidateFingerprint(candidate);
    const deterministicSnippetId = deterministicBindings[deterministicFingerprint];
    if (deterministicSnippetId) {
      return {
        ...candidate,
        evidenceRefs: [deterministicSnippetId],
        evidenceRefOrigin: 'deterministic_binding'
      };
    }

    const value = normalizeWhitespace(String(candidate?.value || '')).toLowerCase();
    if (!value || value === 'unk') {
      return candidate;
    }
    const fieldToken = String(candidate?.field || '').replace(/_/g, ' ').toLowerCase().trim();

    let match = snippetRows.find((row) => row.text.includes(value) && (!fieldToken || row.text.includes(fieldToken)));
    if (!match) {
      match = snippetRows.find((row) => row.text.includes(value));
    }
    if (!match) {
      return candidate;
    }

    return {
      ...candidate,
      evidenceRefs: [match.id],
      evidenceRefOrigin: 'heuristic_snippet_match'
    };
  });
}

function isAnchorLocked(field, anchors) {
  const value = anchors?.[field];
  return String(value || '').trim() !== '';
}

function isIdentityLockedField(field) {
  return ['id', 'brand', 'model', 'base_model', 'category', 'sku'].includes(field);
}

function createEmptyProvenance(fieldOrder, fields) {
  const output = {};
  for (const key of fieldOrder) {
    output[key] = {
      value: fields[key],
      confirmations: 0,
      approved_confirmations: 0,
      pass_target: 0,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return output;
}

function ensureProvenanceField(provenance, field, fallbackValue = 'unk') {
  if (!provenance[field]) {
    provenance[field] = {
      value: fallbackValue,
      confirmations: 0,
      approved_confirmations: 0,
      pass_target: 1,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return provenance[field];
}

function mergePhase08Rows(existing = [], incoming = [], maxRows = 400) {
  const out = [...(existing || [])];
  const seen = new Set(
    out.map((row) => `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`)
  );
  for (const row of incoming || []) {
    const key = `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
    if (out.length >= Math.max(1, Number.parseInt(String(maxRows || 400), 10) || 400)) {
      break;
    }
  }
  return out;
}

function buildPhase08SummaryFromBatches(batchRows = []) {
  const rows = Array.isArray(batchRows) ? batchRows : [];
  const batchCount = rows.length;
  const batchErrors = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'failed').length;
  const rawCandidateCount = rows.reduce((sum, row) => sum + Number(row?.raw_candidate_count || 0), 0);
  const acceptedCandidateCount = rows.reduce((sum, row) => sum + Number(row?.accepted_candidate_count || 0), 0);
  const danglingRefCount = rows.reduce((sum, row) => sum + Number(row?.dropped_invalid_refs || 0), 0);
  const policyViolationCount = rows.reduce(
    (sum, row) => sum
      + Number(row?.dropped_missing_refs || 0)
      + Number(row?.dropped_invalid_refs || 0)
      + Number(row?.dropped_evidence_verifier || 0),
    0
  );
  const minRefsSatisfiedCount = rows.reduce((sum, row) => sum + Number(row?.min_refs_satisfied_count || 0), 0);
  const minRefsTotal = rows.reduce((sum, row) => sum + Number(row?.min_refs_total || 0), 0);
  return {
    batch_count: batchCount,
    batch_error_count: batchErrors,
    schema_fail_rate: batchCount > 0 ? Number((batchErrors / batchCount).toFixed(6)) : 0,
    raw_candidate_count: rawCandidateCount,
    accepted_candidate_count: acceptedCandidateCount,
    dangling_snippet_ref_count: danglingRefCount,
    dangling_snippet_ref_rate: rawCandidateCount > 0 ? Number((danglingRefCount / rawCandidateCount).toFixed(6)) : 0,
    evidence_policy_violation_count: policyViolationCount,
    evidence_policy_violation_rate: rawCandidateCount > 0 ? Number((policyViolationCount / rawCandidateCount).toFixed(6)) : 0,
    min_refs_satisfied_count: minRefsSatisfiedCount,
    min_refs_total: minRefsTotal,
    min_refs_satisfied_rate: minRefsTotal > 0 ? Number((minRefsSatisfiedCount / minRefsTotal).toFixed(6)) : 0
  };
}

function tsvRowFromFields(fieldOrder, fields) {
  return fieldOrder.map((field) => fields[field] ?? 'unk').join('\t');
}

function resolveTargets(job, categoryConfig) {
  return {
    targetCompleteness:
      job.requirements?.targetCompleteness ?? categoryConfig.schema.targets?.targetCompleteness ?? 0.9,
    targetConfidence:
      job.requirements?.targetConfidence ?? categoryConfig.schema.targets?.targetConfidence ?? 0.8
  };
}

function resolveLlmTargetFields(job, categoryConfig) {
  const fromRequirements = Array.isArray(job.requirements?.llmTargetFields)
    ? job.requirements.llmTargetFields
    : [];
  const fromRequired = Array.isArray(job.requirements?.requiredFields)
    ? job.requirements.requiredFields
    : [];
  const base = normalizeFieldList([
    ...fromRequirements,
    ...fromRequired,
    ...(categoryConfig.requiredFields || []),
    ...(categoryConfig.schema?.critical_fields || [])
  ], {
    fieldOrder: categoryConfig.fieldOrder || []
  });
  return [...new Set(base)];
}

function isDiscoveryOnlySourceUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (path.endsWith('/robots.txt')) {
      return true;
    }
    if (path.includes('sitemap') || path.endsWith('.xml')) {
      return true;
    }
    if (path.includes('/search')) {
      return true;
    }
    if (path.includes('/catalogsearch') || path.includes('/find')) {
      return true;
    }
    if ((query.includes('q=') || query.includes('query=')) && path.length <= 16) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isRobotsTxtUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('/robots.txt');
  } catch {
    return false;
  }
}

function isSitemapUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.includes('sitemap') || pathname.endsWith('.xml');
  } catch {
    return false;
  }
}

function hasSitemapXmlSignals(body) {
  const text = String(body || '').toLowerCase();
  return text.includes('<urlset') || text.includes('<sitemapindex') || text.includes('<loc>');
}

function isLikelyIndexableEndpointUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.json') || path.endsWith('.js')) {
      return false;
    }
    if (path.includes('/api/') || path.includes('/graphql')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isSafeManufacturerFollowupUrl(source, url) {
  try {
    const parsed = new URL(url);
    const sourceRootDomain = String(source?.rootDomain || source?.host || '').toLowerCase();
    if (!sourceRootDomain) {
      return false;
    }
    const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host || (!host.endsWith(sourceRootDomain) && sourceRootDomain !== host)) {
      return false;
    }

    const path = parsed.pathname.toLowerCase();
    const signal = [
      '/support',
      '/manual',
      '/spec',
      '/product',
      '/products',
      '/download',
      '/sitemap'
    ];
    return signal.some((token) => path.includes(token));
  } catch {
    return false;
  }
}

function isHelperSyntheticUrl(url) {
  const token = String(url || '').trim().toLowerCase();
  return token.startsWith('helper_files://');
}

function isHelperSyntheticSource(source) {
  if (!source) {
    return false;
  }
  if (source.helperSource) {
    return true;
  }
  if (String(source.host || '').trim().toLowerCase() === 'helper-files.local') {
    return true;
  }
  return isHelperSyntheticUrl(source.url) || isHelperSyntheticUrl(source.finalUrl);
}

function buildFieldReasoning({
  fieldOrder,
  provenance,
  fieldsBelowPassTarget,
  criticalFieldsBelowPassTarget,
  missingRequiredFields,
  constraintAnalysis,
  identityGateValidated,
  llmBudgetBlockedReason,
  sourceResults,
  fieldAvailabilityModel = {},
  fieldYieldArtifact = {},
  searchAttemptCount = 0
}) {
  const fieldsBelowSet = new Set(fieldsBelowPassTarget || []);
  const criticalBelowSet = new Set(criticalFieldsBelowPassTarget || []);
  const missingRequiredSet = new Set(missingRequiredFields || []);
  const contradictionsByField = {};
  const blockedStatuses = new Set([401, 403, 429]);
  const blockedSourceCount = (sourceResults || []).filter((source) =>
    blockedStatuses.has(Number.parseInt(String(source.status || 0), 10))
  ).length;
  const robotsOnlySourceCount = (sourceResults || []).filter((source) =>
    isDiscoveryOnlySourceUrl(source.finalUrl || source.url || '')
  ).length;
  const blockedByRobotsOrTos =
    (sourceResults || []).length > 0 &&
    (blockedSourceCount + robotsOnlySourceCount) >= Math.max(1, Math.ceil((sourceResults || []).length * 0.7));
  const budgetExhausted = String(llmBudgetBlockedReason || '').includes('budget');

  function highYieldDomainCountForField(field) {
    let count = 0;
    for (const row of Object.values(fieldYieldArtifact?.by_domain || {})) {
      const bucket = row?.fields?.[field];
      if (!bucket) {
        continue;
      }
      const seen = Number.parseInt(String(bucket.seen || 0), 10) || 0;
      const yieldValue = Number.parseFloat(String(bucket.yield || 0)) || 0;
      if (seen >= 4 && yieldValue >= 0.5) {
        count += 1;
      }
    }
    return count;
  }

  for (const contradiction of constraintAnalysis?.contradictions || []) {
    for (const field of contradiction.fields || []) {
      if (!contradictionsByField[field]) {
        contradictionsByField[field] = [];
      }
      contradictionsByField[field].push({
        code: contradiction.code,
        severity: contradiction.severity,
        message: contradiction.message
      });
    }
  }

  const output = {};
  for (const field of fieldOrder || []) {
    const row = provenance?.[field] || {};
    const reasons = [];
    if (fieldsBelowSet.has(field)) {
      reasons.push('below_pass_target');
    }
    if (criticalBelowSet.has(field)) {
      reasons.push('critical_field_below_pass_target');
    }
    if (missingRequiredSet.has(field)) {
      reasons.push('missing_required_field');
    }
    if (row.value === 'unk') {
      reasons.push('no_accepted_value');
    }
    if ((contradictionsByField[field] || []).length > 0) {
      reasons.push('constraint_conflict');
    }

    output[field] = {
      value: row.value ?? 'unk',
      confidence: row.confidence ?? 0,
      meets_pass_target: row.meets_pass_target ?? false,
      approved_confirmations: row.approved_confirmations ?? 0,
      pass_target: row.pass_target ?? 0,
      reasons: [...new Set(reasons)],
      contradictions: contradictionsByField[field] || []
    };

    if (String(output[field].value || '').toLowerCase() === 'unk') {
      let unknownReason = 'not_found_after_search';
      const normalizedField = toRawFieldKey(field, { fieldOrder });
      const availabilityClass = availabilityClassForField(fieldAvailabilityModel, normalizedField);
      const highYieldDomainCount = highYieldDomainCountForField(normalizedField);
      const undisclosedThreshold = undisclosedThresholdForField({
        field: normalizedField,
        artifact: fieldAvailabilityModel,
        highYieldDomainCount
      });
      const searchQueryThreshold = availabilityClass === 'expected'
        ? 10
        : availabilityClass === 'rare'
          ? 4
          : 6;

      if (!identityGateValidated) {
        unknownReason = 'identity_ambiguous';
      } else if (budgetExhausted) {
        unknownReason = 'budget_exhausted';
      } else if ((contradictionsByField[field] || []).length > 0) {
        unknownReason = 'conflicting_sources_unresolved';
      } else if (blockedByRobotsOrTos) {
        unknownReason = 'blocked_by_robots_or_tos';
      } else if ((row.confirmations || 0) > 0 && (row.approved_confirmations || 0) === 0) {
        unknownReason = 'parse_failure';
      } else if (
        (sourceResults || []).length >= undisclosedThreshold ||
        Number(searchAttemptCount || 0) >= searchQueryThreshold
      ) {
        unknownReason = 'not_publicly_disclosed';
      }
      output[field].unknown_reason = unknownReason;
    } else {
      output[field].unknown_reason = null;
    }
  }

  return output;
}

function buildTopEvidenceReferences(provenance, limit = 60) {
  const rows = [];
  const seen = new Set();
  for (const [field, row] of Object.entries(provenance || {})) {
    for (const evidence of row?.evidence || []) {
      const key = `${field}|${evidence.url}|${evidence.keyPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      rows.push({
        field,
        url: evidence.url,
        host: evidence.host,
        method: evidence.method,
        keyPath: evidence.keyPath,
        tier: evidence.tier,
        tier_name: evidence.tierName
      });
      if (rows.length >= limit) {
        return rows;
      }
    }
  }
  return rows;
}

function helperSupportsProvisionalFill(helperContext, identityLock = {}) {
  const topMatch = helperContext?.supportive_matches?.[0] || helperContext?.active_match || null;
  if (!topMatch) {
    return false;
  }

  const expectedBrand = normalizeIdentityToken(identityLock?.brand);
  const expectedModel = normalizeIdentityToken(identityLock?.model);
  if (!expectedBrand || !expectedModel) {
    return false;
  }

  const matchBrand = normalizeIdentityToken(topMatch.brand);
  const matchModel = normalizeIdentityToken(topMatch.model);
  if (matchBrand !== expectedBrand || matchModel !== expectedModel) {
    return false;
  }

  const expectedVariant = normalizeIdentityToken(identityLock?.variant);
  if (!expectedVariant) {
    return true;
  }

  const matchVariant = normalizeIdentityToken(topMatch.variant);
  if (!matchVariant) {
    return true;
  }

  return (
    matchVariant === expectedVariant ||
    matchVariant.includes(expectedVariant) ||
    expectedVariant.includes(matchVariant)
  );
}

function deriveNeedSetIdentityState({
  identityGate = {},
  identityConfidence = 0
} = {}) {
  if (identityGate?.validated && Number(identityConfidence || 0) >= 0.99) {
    return 'locked';
  }
  const reasonCodes = Array.isArray(identityGate?.reasonCodes) ? identityGate.reasonCodes : [];
  const hasConflictCode = reasonCodes.some((row) => {
    const token = String(row || '').toLowerCase();
    return token.includes('conflict') || token.includes('mismatch') || token.includes('major_anchor');
  });
  if (hasConflictCode || identityGate?.status === 'IDENTITY_CONFLICT') {
    return 'conflict';
  }
  if (Number(identityConfidence || 0) >= 0.9) {
    return 'provisional';
  }
  return 'unlocked';
}

function resolveExtractionGateOpen({
  identityLock = {},
  identityGate = {}
} = {}) {
  if (identityGate?.validated) {
    return true;
  }
  const reasonCodes = Array.isArray(identityGate?.reasonCodes) ? identityGate.reasonCodes : [];
  const hasHardConflict = reasonCodes.some((row) => {
    const token = String(row || '').toLowerCase();
    return token.includes('conflict') || token.includes('mismatch') || token.includes('major_anchor');
  }) || String(identityGate?.status || '').toUpperCase() === 'IDENTITY_CONFLICT';
  if (hasHardConflict) {
    return false;
  }
  const hasVariant = Boolean(normalizeIdentityToken(identityLock?.variant));
  if (hasVariant) {
    return false;
  }
  const familyCount = Math.max(0, Number.parseInt(String(identityLock?.family_model_count || 0), 10) || 0);
  const ambiguityLevel = normalizeAmbiguityLevel(
    identityLock?.ambiguity_level || ambiguityLevelFromFamilyCount(familyCount)
  );
  if (ambiguityLevel === 'hard' || ambiguityLevel === 'very_hard' || ambiguityLevel === 'extra_hard') {
    return false;
  }
  return Boolean(normalizeIdentityToken(identityLock?.brand) && normalizeIdentityToken(identityLock?.model));
}

function buildNeedSetIdentityAuditRows(identityReport = {}, limit = 24) {
  const pages = Array.isArray(identityReport?.pages) ? identityReport.pages : [];
  return pages
    .map((row) => ({
      source_id: String(row?.source_id || '').trim(),
      url: String(row?.url || '').trim(),
      decision: String(row?.decision || '').trim().toUpperCase(),
      confidence: toFloat(row?.confidence, 0),
      reason_codes: Array.isArray(row?.reason_codes) ? row.reason_codes.slice(0, 12) : []
    }))
    .filter((row) => row.source_id || row.url)
    .slice(0, Math.max(1, Number(limit || 24)));
}

function isIndexingHelperFlowEnabled(config = {}) {
  return Boolean(config?.helperFilesEnabled && config?.indexingHelperFilesEnabled);
}

function emitFieldDecisionEvents({
  logger,
  fieldOrder,
  normalized,
  provenance,
  fieldReasoning,
  trafficLight
}) {
  for (const field of fieldOrder || []) {
    const value = String(normalized?.fields?.[field] ?? 'unk');
    const reasoning = fieldReasoning?.[field] || {};
    const traffic = trafficLight?.by_field?.[field] || {};
    const row = provenance?.[field] || {};

    logger.info('field_decision', {
      field,
      value,
      decision: value.toLowerCase() === 'unk' ? 'unknown' : 'accepted',
      unknown_reason: reasoning.unknown_reason || null,
      reasons: reasoning.reasons || [],
      confidence: row.confidence || 0,
      evidence_count: (row.evidence || []).length,
      traffic_color: traffic.color || null,
      traffic_reason: traffic.reason || null
    });
  }
}

function buildProvisionalHypothesisQueue({
  sourceResults,
  categoryConfig,
  fieldOrder,
  anchors,
  identityLock,
  productId,
  category,
  config,
  requiredFields,
  sourceIntelDomains,
  brand
}) {
  const consensus = runConsensusEngine({
    sourceResults,
    categoryConfig,
    fieldOrder,
    anchors,
    identityLock,
    productId,
    category,
    config
  });

  const provisionalFields = {};
  for (const field of fieldOrder || []) {
    provisionalFields[field] = consensus.fields?.[field] ?? 'unk';
  }

  const provisionalNormalized = {
    fields: provisionalFields
  };

  const completenessStats = computeCompletenessRequired(provisionalNormalized, requiredFields);
  const criticalFieldsBelowPassTarget = consensus.criticalFieldsBelowPassTarget || [];

  const hypothesisQueue = buildHypothesisQueue({
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields,
    provenance: consensus.provenance || {},
    sourceResults,
    sourceIntelDomains,
    brand: brand || '',
    criticalFieldSet: categoryConfig.criticalFieldSet,
    maxItems: Math.max(1, Number(config.maxHypothesisItems || 50))
  });

  return {
    hypothesisQueue,
    missingRequiredFields: completenessStats.missingRequiredFields,
    criticalFieldsBelowPassTarget
  };
}

export async function runProduct({ storage, config, s3Key, jobOverride = null, roundContext = null }) {
  const runId = buildRunId();
  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    onEvent: config.onRuntimeEvent,
    context: {
      runId
    }
  });
  const startMs = Date.now();

  logger.info('run_started', { s3Key, runId, round: roundContext?.round ?? 0 });

  const job = jobOverride || (await storage.readJson(s3Key));
  const productId = job.productId;
  const category = job.category || 'mouse';
  const runArtifactsBase = storage.resolveOutputKey(category, productId, 'runs', runId);
  const baseIdentityLock = job.identityLock || {};
  const identityAmbiguity = await resolveIdentityAmbiguitySnapshot({
    config,
    category,
    identityLock: baseIdentityLock
  });
  const identityLock = {
    ...baseIdentityLock,
    family_model_count: identityAmbiguity.family_model_count,
    ambiguity_level: normalizeAmbiguityLevel(identityAmbiguity.ambiguity_level)
  };
  job.identityLock = identityLock;
  const identityFingerprint = buildRunIdentityFingerprint({
    category,
    productId,
    identityLock
  });
  const identityLockStatus = resolveIdentityLockStatus(identityLock);
  const runtimeMode = String(roundContext?.mode || config.accuracyMode || 'balanced').trim().toLowerCase();
  const uberAggressiveMode = runtimeMode === 'uber_aggressive';
  logger.setContext({
    category,
    productId
  });
  logger.info('run_context', {
    productId,
    runId,
    category,
    run_profile: config.runProfile || 'standard',
    runtime_mode: runtimeMode,
    identity_fingerprint: identityFingerprint,
    identity_lock_status: identityLockStatus,
    family_model_count: identityLock.family_model_count || 0,
    ambiguity_level: identityLock.ambiguity_level || 'unknown',
    dedupe_mode: RUN_DEDUPE_MODE,
    phase_cursor: 'phase_00_bootstrap'
  });
  const traceWriter = toBool(config.runtimeTraceEnabled, true)
    ? new RuntimeTraceWriter({
      storage,
      runId,
      productId
    })
    : null;
  const runtimeControlKey = resolveRuntimeControlKey(storage, config);
  let runtimeOverrides = defaultRuntimeOverrides();
  let runtimeOverridesLastLoadMs = 0;
  const loadRuntimeOverrides = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && now - runtimeOverridesLastLoadMs < 3000) {
      return runtimeOverrides;
    }
    runtimeOverridesLastLoadMs = now;
    try {
      const payload = await storage.readJsonOrNull(runtimeControlKey);
      runtimeOverrides = normalizeRuntimeOverrides(payload || {});
    } catch {
      runtimeOverrides = defaultRuntimeOverrides();
    }
    return runtimeOverrides;
  };

  let frontierDb = null;
  let uberOrchestrator = null;
  if (uberAggressiveMode || toBool(config.uberAggressiveEnabled, false)) {
    const rawFrontierKey = String(config.frontierDbPath || '_intel/frontier/frontier.json').trim();
    const frontierKey = rawFrontierKey.startsWith(`${config.s3OutputPrefix || 'specs/outputs'}/`)
      ? rawFrontierKey
      : storage.resolveOutputKey(rawFrontierKey);
    frontierDb = createFrontier({
      storage,
      key: frontierKey,
      config: { ...config, _logger: logger }
    });
    await frontierDb.load();
    uberOrchestrator = new UberAggressiveOrchestrator({
      config,
      logger,
      frontier: frontierDb
    });
  }
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
  const routeMatrixPolicy = await loadRouteMatrixPolicyForRun({
    config,
    category,
    categoryConfig,
    logger
  });
  logger.info('route_matrix_policy_resolved', {
    category,
    source: routeMatrixPolicy.source,
    row_count: Number(routeMatrixPolicy.row_count || 0),
    scalar_linked_send: routeMatrixPolicy.scalar_linked_send,
    component_values_send: routeMatrixPolicy.component_values_send,
    list_values_send: routeMatrixPolicy.list_values_send,
    min_evidence_refs_effective: Number(routeMatrixPolicy.min_evidence_refs_effective || 1),
    prime_sources_visual_send: Boolean(routeMatrixPolicy.prime_sources_visual_send)
  });
  const previousFinalSpec = await storage.readJsonOrNull(
    storage.resolveOutputKey(category, productId, 'final', 'spec.json')
  );
  let runtimeFieldRulesEngine = null;
  try {
    runtimeFieldRulesEngine = await createFieldRulesEngine(category, {
      config
    });
  } catch (error) {
    logger.warn('field_rules_engine_init_failed', {
      category,
      productId,
      message: error.message
    });
  }
  const deterministicParser = runtimeFieldRulesEngine
    ? new DeterministicParser(runtimeFieldRulesEngine)
    : null;
  const componentResolver = runtimeFieldRulesEngine
    ? new ComponentResolver(runtimeFieldRulesEngine)
    : null;
  const billingMonth = new Date().toISOString().slice(0, 7);

  const fieldOrder = categoryConfig.fieldOrder;
  const requiredFields = job.requirements?.requiredFields || categoryConfig.requiredFields;
  const llmTargetFields = resolveLlmTargetFields(job, categoryConfig);
  const goldenExamples = config.llmEnabled
    ? await retrieveGoldenExamples({
      storage,
      category,
      job,
      limit: 5
    })
    : [];
  const targets = resolveTargets(job, categoryConfig);
  const anchors = job.anchors || {};
  const indexingHelperFlowEnabled = isIndexingHelperFlowEnabled(config);
  let helperData = {
    enabled: false,
    active: [],
    supportive: [],
    supportive_files: [],
    active_index: new Map(),
    supportive_index: new Map()
  };
  let helperContext = {
    enabled: false,
    active_match: null,
    supportive_matches: [],
    seed_urls: [],
    stats: {
      active_total: 0,
      supportive_total: 0,
      supportive_file_count: 0,
      active_matched_count: 0,
      supportive_matched_count: 0
    }
  };
  if (indexingHelperFlowEnabled) {
    try {
      helperData = await loadHelperCategoryData({
        config,
        category,
        categoryConfig
      });
      helperContext = resolveHelperProductContext({
        helperData,
        job
      });
      logger.info('helper_files_context_loaded', {
        category,
        helper_enabled: helperData.enabled,
        active_match: Boolean(helperContext.active_match),
        supportive_matches: helperContext.supportive_matches?.length || 0,
        supportive_files: helperData.supportive_files?.length || 0,
        helper_seed_urls: helperContext.seed_urls?.length || 0
      });
    } catch (error) {
      logger.warn('helper_files_context_failed', {
        category,
        productId,
        message: error.message
      });
    }
  } else {
    logger.info('indexing_helper_flow_disabled', {
      helper_files_enabled: Boolean(config.helperFilesEnabled),
      indexing_helper_files_enabled: Boolean(config.indexingHelperFilesEnabled)
    });
  }
  const categoryBrainLoaded = await loadCategoryBrain({
    storage,
    category
  });
  const learnedConstraints = categoryBrainLoaded?.artifacts?.constraints?.value || {};
  const learnedFieldYield = categoryBrainLoaded?.artifacts?.fieldYield?.value || {};
  const learnedFieldAvailability = categoryBrainLoaded?.artifacts?.fieldAvailability?.value || {};

  const adapterManager = createAdapterManager(config, logger);
  const sourceIntel = await loadSourceIntel({ storage, config, category });
  const planner = new SourcePlanner(job, config, categoryConfig, {
    requiredFields,
    sourceIntel: sourceIntel.data
  });
  await loadRuntimeOverrides({ force: true });
  applyRuntimeOverridesToPlanner(planner, runtimeOverrides);
  const indexingResumeKey = resolveIndexingResumeKey(storage, category, productId);
  const resumeMode = normalizeResumeMode(config.indexingResumeMode);
  const resumeMaxAgeHours = Math.max(0, toInt(config.indexingResumeMaxAgeHours, 48));
  const resumeReextractEnabled = config.indexingReextractEnabled !== false;
  const resumeReextractAfterHours = Math.max(0, toInt(config.indexingReextractAfterHours, 24));
  const resumeReextractSeedLimit = Math.max(1, toInt(config.indexingReextractSeedLimit, 8));
  const resumeSeedLimit = Math.max(4, toInt(config.indexingResumeSeedLimit, 24));
  const resumePersistLimit = Math.max(
    resumeSeedLimit * 4,
    Math.max(40, toInt(config.indexingResumePersistLimit, 160))
  );
  const resumeRetryPersistLimit = Math.max(10, toInt(config.indexingResumeRetryPersistLimit, 80));
  const rawPreviousResumeState = await storage.readJsonOrNull(indexingResumeKey).catch(() => null) || {};
  const previousResumeStateAgeHours = resumeStateAgeHours(rawPreviousResumeState.updated_at);
  const previousResumeStateFresh = isResumeStateFresh(
    rawPreviousResumeState.updated_at,
    resumeMaxAgeHours
  );
  const usePreviousResumeState =
    resumeMode === 'force_resume' ||
    (resumeMode === 'auto' && previousResumeStateFresh);
  const previousResumeState = usePreviousResumeState ? rawPreviousResumeState : {};
  if (resumeMode === 'start_over') {
    logger.info('indexing_resume_start_over', {
      resume_key: indexingResumeKey,
      mode: resumeMode
    });
  } else if (!usePreviousResumeState && rawPreviousResumeState?.updated_at) {
    logger.info('indexing_resume_expired', {
      resume_key: indexingResumeKey,
      mode: resumeMode,
      max_age_hours: resumeMaxAgeHours,
      state_age_hours: Number.isFinite(previousResumeStateAgeHours)
        ? Number(previousResumeStateAgeHours.toFixed(2))
        : null
    });
  }
  const previousResumePendingAll = normalizeHttpUrlList(
    previousResumeState.pending_urls || [],
    resumePersistLimit * 2
  );
  const previousResumePendingSeed = previousResumePendingAll.slice(0, resumeSeedLimit);
  const previousResumePendingUnseeded = previousResumePendingAll.slice(resumeSeedLimit, resumePersistLimit * 2);
  const previousResumeRetryRows = Array.isArray(previousResumeState.llm_retry_urls)
    ? previousResumeState.llm_retry_urls
    : [];
  const previousResumeSuccessRows = Array.isArray(previousResumeState.success_urls)
    ? previousResumeState.success_urls
    : [];
  const previousResumeRetrySeedUrls = normalizeHttpUrlList(
    previousResumeRetryRows.map((row) => row?.url),
    resumeSeedLimit
  );
  const previousResumeReextractSeedUrls = resumeReextractEnabled
    ? selectReextractSeedUrls({
      successRows: previousResumeSuccessRows,
      afterHours: resumeReextractAfterHours,
      limit: resumeReextractSeedLimit
    })
    : [];
  let resumeSeededPendingCount = 0;
  let resumeSeededLlmRetryCount = 0;
  let resumeSeededReextractCount = 0;
  let resumePersistedPendingCount = 0;
  let resumePersistedLlmRetryCount = 0;
  let resumePersistedSuccessCount = 0;
  for (const url of previousResumePendingSeed) {
    if (planner.enqueue(url, 'resume_pending_seed', { forceApproved: true, forceBrandBypass: false })) {
      resumeSeededPendingCount += 1;
    }
  }
  for (const url of previousResumeRetrySeedUrls) {
    if (planner.enqueue(url, 'resume_llm_retry_seed', { forceApproved: true, forceBrandBypass: false })) {
      resumeSeededLlmRetryCount += 1;
    }
  }
  for (const url of previousResumeReextractSeedUrls) {
    if (planner.enqueue(url, 'resume_reextract_seed', { forceApproved: true, forceBrandBypass: false })) {
      resumeSeededReextractCount += 1;
    }
  }
  if (resumeSeededPendingCount > 0 || resumeSeededLlmRetryCount > 0 || resumeSeededReextractCount > 0) {
    logger.info('indexing_resume_loaded', {
      resume_key: indexingResumeKey,
      pending_seeded: resumeSeededPendingCount,
      llm_retry_seeded: resumeSeededLlmRetryCount,
      reextract_seeded: resumeSeededReextractCount,
      resume_mode: resumeMode,
      resume_max_age_hours: resumeMaxAgeHours,
      resume_state_age_hours: Number.isFinite(previousResumeStateAgeHours)
        ? Number(previousResumeStateAgeHours.toFixed(2))
        : null,
      previous_pending_count: previousResumePendingAll.length,
      previous_llm_retry_count: previousResumeRetryRows.length,
      previous_success_count: previousResumeSuccessRows.length
    });
  }

  let learningProfile = null;
  if (config.selfImproveEnabled) {
    learningProfile = await loadLearningProfile({
      storage,
      config,
      category,
      job
    });
    applyLearningSeeds(planner, learningProfile);
  }

  const adapterSeedUrls = adapterManager.collectSeedUrls({ job });
  planner.seed(adapterSeedUrls, { forceBrandBypass: false });
  if (indexingHelperFlowEnabled) {
    planner.seed(helperContext.seed_urls || [], { forceBrandBypass: false });
  }

  const initialFetcherMode = selectFetcherMode(config);
  let fetcher = initialFetcherMode === 'dryrun'
    ? new DryRunFetcher(config, logger)
    : initialFetcherMode === 'http'
      ? new HttpFetcher(config, logger)
      : initialFetcherMode === 'crawlee'
        ? new CrawleeFetcher(config, logger)
        : new PlaywrightFetcher(config, logger);
  let fetcherMode = initialFetcherMode;
  let fetcherStartFallbackReason = '';

  const sourceResults = [];
  const attemptedSourceUrls = new Set();
  const resumeCooldownSkippedUrls = new Set();
  const resumeFetchFailedUrls = new Set();
  const llmRetryReasonByUrl = new Map();
  const successfulSourceMetaByUrl = new Map();
  const repairQueryByDomain = new Set();
  const blockedDomainHitCount = new Map();
  const blockedDomainsApplied = new Set();
  const hostBudgetByHost = new Map();
  const blockedDomainThreshold = Math.max(1, toInt(config.frontierBlockedDomainThreshold, 2));
  const repairSearchEnabled = config.frontierRepairSearchEnabled !== false;
  const llmSatisfiedFields = new Set();
  const helperSupportiveSyntheticSources = (indexingHelperFlowEnabled && config.helperSupportiveEnabled)
    ? buildSupportiveSyntheticSources({
      helperContext,
      job,
      categoryConfig,
      anchors,
      maxSources: Math.max(1, Number(config.helperSupportiveMaxSources || 6))
    })
    : [];
  const artifactsByHost = {};
  let artifactSequence = 0;
  const adapterArtifacts = [];
  let helperFilledFields = [];
  let helperFilledByMethod = {};
  let helperMismatches = [];
  let componentPriorFilledFields = [];
  let componentPriorMatches = [];
  let criticDecisions = {
    accept: [],
    reject: [],
    unknown: []
  };
  let llmValidatorDecisions = {
    enabled: false,
    accept: [],
    reject: [],
    unknown: []
  };
  let trafficLight = {
    by_field: {},
    counts: {
      green: 0,
      yellow: 0,
      red: 0
    }
  };
  let llmCandidatesAccepted = 0;
  let llmSourcesUsed = 0;
  let hypothesisFollowupRoundsExecuted = 0;
  let hypothesisFollowupSeededUrls = 0;
  const billingSnapshot = await readBillingSnapshot({
    storage,
    month: billingMonth,
    productId
  });
  const llmBudgetGuard = createBudgetGuard({
    config,
    monthlySpentUsd: billingSnapshot.monthly_cost_usd,
    productSpentUsd: billingSnapshot.product_cost_usd,
    productCallsTotal: billingSnapshot.product_calls
  });
  llmBudgetGuard.startRound();
  const llmCostRates = normalizeCostRates(config);
  let llmCostUsd = 0;
  let llmCallCount = 0;
  let llmEstimatedUsageCount = 0;
  let llmRetryWithoutSchemaCount = 0;
  let llmBudgetBlockedReason = '';
  const phase08BatchRows = [];
  let phase08FieldContexts = {};
  let phase08PrimeRows = [];
  const llmVerifySampleRate = Math.max(1, Number.parseInt(String(config.llmVerifySampleRate || 10), 10) || 10);
  const llmVerifySampled = (stableHash(`${productId}:${runId}`) % llmVerifySampleRate) === 0;
  const llmVerifyForced = Boolean(roundContext?.force_verify_llm);
  const llmVerifyAggressiveAlways =
    Boolean(config.llmVerifyAggressiveAlways) &&
    ['aggressive', 'uber_aggressive'].includes(String(roundContext?.mode || '').toLowerCase());
  const llmVerifyEnabled = Boolean(
    llmVerifyAggressiveAlways ||
    (config.llmVerifyMode && (llmVerifySampled || llmVerifyForced))
  );
  const llmContext = {
    storage,
    category,
    productId,
    runId,
    round: Number.parseInt(String(roundContext?.round ?? 0), 10) || 0,
    mode: runtimeMode,
    verification: {
      enabled: llmVerifyEnabled,
      done: false,
      trigger: llmVerifyAggressiveAlways
        ? 'aggressive_always'
        : (llmVerifyForced ? 'missing_required_fields' : (llmVerifySampled ? 'sampling' : 'disabled'))
    },
    budgetGuard: llmBudgetGuard,
    costRates: llmCostRates,
    traceWriter,
    route_matrix_policy: routeMatrixPolicy,
    routeMatrixPolicy: routeMatrixPolicy,
    forcedHighFields: [],
    recordUsage: async (usageRow) => {
      llmCallCount += 1;
      llmCostUsd = Number.parseFloat((llmCostUsd + Number(usageRow.cost_usd || 0)).toFixed(8));
      if (usageRow.estimated_usage) {
        llmEstimatedUsageCount += 1;
      }
      if (usageRow.retry_without_schema) {
        llmRetryWithoutSchemaCount += 1;
      }
      await appendCostLedgerEntry({
        storage,
        config,
        entry: {
          ts: new Date().toISOString(),
          provider: usageRow.provider,
          model: usageRow.model,
          category,
          productId,
          runId,
          round: usageRow.round || 0,
          prompt_tokens: usageRow.prompt_tokens || 0,
          completion_tokens: usageRow.completion_tokens || 0,
          cached_prompt_tokens: usageRow.cached_prompt_tokens || 0,
          total_tokens: usageRow.total_tokens || 0,
          cost_usd: usageRow.cost_usd || 0,
          reason: usageRow.reason || 'extract',
          host: usageRow.host || '',
          url_count: usageRow.url_count || 0,
          evidence_chars: usageRow.evidence_chars || 0,
          estimated_usage: Boolean(usageRow.estimated_usage),
          meta: {
            retry_without_schema: Boolean(usageRow.retry_without_schema),
            deepseek_mode_detected: Boolean(usageRow.deepseek_mode_detected),
            json_schema_requested: Boolean(usageRow.json_schema_requested)
          }
        }
      });
    }
  };
  // Merge runtime force_high_fields with escalated fields from prior round
  const escalatedFromRound = Array.isArray(roundContext?.escalated_fields)
    ? roundContext.escalated_fields.filter(Boolean)
    : [];
  llmContext.forcedHighFields = [
    ...new Set([...(runtimeOverrides.force_high_fields || []), ...escalatedFromRound])
  ];

  const discoveryConfig = runtimeOverrides.disable_search
    ? { ...config, discoveryEnabled: false, searchProvider: 'none' }
    : config;
  const discoveryResult = await discoverCandidateSources({
    config: discoveryConfig,
    storage,
    categoryConfig,
    job,
    runId,
    logger,
    planningHints: {
      missingRequiredFields: normalizeFieldList(
        roundContext?.missing_required_fields || requiredFields || [],
        { fieldOrder: categoryConfig.fieldOrder || [] }
      ),
      missingCriticalFields: normalizeFieldList(
        roundContext?.missing_critical_fields || categoryConfig.schema?.critical_fields || [],
        { fieldOrder: categoryConfig.fieldOrder || [] }
      ),
      extraQueries: Array.isArray(roundContext?.extra_queries) ? roundContext.extra_queries : []
    },
    llmContext,
    frontierDb,
    runtimeTraceWriter: traceWriter
  });

  planner.seed(discoveryResult.approvedUrls || [], { forceBrandBypass: false });
  if (discoveryResult.enabled && config.maxCandidateUrls > 0 && config.fetchCandidateSources) {
    planner.seedCandidates(discoveryResult.candidateUrls || []);
  }
  if (traceWriter) {
    const plannerTrace = await traceWriter.writeJson({
      section: 'planner',
      prefix: 'queue_snapshot',
      payload: {
        ts: new Date().toISOString(),
        pending_count:
          (planner.manufacturerQueue?.length || 0) +
          (planner.queue?.length || 0) +
          (planner.candidateQueue?.length || 0),
        blocked_hosts: [...(planner.blockedHosts || new Set())].slice(0, 60),
        stats: planner.getStats()
      },
      ringSize: 20
    });
    logger.info('planner_queue_snapshot_written', {
      pending_count:
        (planner.manufacturerQueue?.length || 0) +
        (planner.queue?.length || 0) +
        (planner.candidateQueue?.length || 0),
      blocked_hosts: [...(planner.blockedHosts || new Set())].slice(0, 12),
      trace_path: plannerTrace.trace_path
    });
  }

  try {
    await fetcher.start();
  } catch (error) {
    fetcherStartFallbackReason = error.message;
    if (config.dryRun || fetcherMode === 'http') {
      throw error;
    }
    logger.warn('fetcher_start_failed', {
      fetcher_mode: fetcherMode,
      message: error.message
    });
    fetcher = new HttpFetcher(config, logger);
    fetcherMode = 'http';
    await fetcher.start();
    logger.info('fetcher_fallback_enabled', {
      fetcher_mode: fetcherMode
    });
  }

  let runtimePauseAnnounced = false;
  const processPlannerQueue = async () => {
    const maybeEmitRepairQuery = ({
      source,
      sourceUrl = '',
      statusCode = 0,
      reason = '',
      cooldownUntil = ''
    } = {}) => {
      if (!repairSearchEnabled) return;
      const domain = normalizeHostToken(source?.host || hostFromHttpUrl(sourceUrl || source?.url || ''));
      if (!domain) return;
      if (repairQueryByDomain.has(domain)) return;
      const query = buildRepairSearchQuery({
        domain,
        brand: job.identityLock?.brand || '',
        model: job.identityLock?.model || '',
        variant: job.identityLock?.variant || ''
      });
      if (!query) return;
      repairQueryByDomain.add(domain);
      logger.info('repair_query_enqueued', {
        domain,
        host: domain,
        query,
        status: Number(statusCode || 0),
        reason: String(reason || '').trim() || null,
        source_url: String(sourceUrl || source?.url || '').trim() || null,
        cooldown_until: String(cooldownUntil || '').trim() || null,
        provider: String(config.searchProvider || '').trim() || 'none',
        doc_hint: 'manual_or_spec',
        field_targets: requiredFields.slice(0, 10)
      });
    };

    const maybeApplyBlockedDomainCooldown = ({
      source,
      statusCode = 0,
      message = ''
    } = {}) => {
      const domain = normalizeHostToken(source?.host || hostFromHttpUrl(source?.url || ''));
      if (!domain) return;
      const blockedByStatus = Number(statusCode) === 403 || Number(statusCode) === 429;
      const blockedByMessage = /(403|429|forbidden|captcha|rate.?limit|blocked)/i.test(String(message || ''));
      if (!blockedByStatus && !blockedByMessage) {
        return;
      }
      const hitCount = (blockedDomainHitCount.get(domain) || 0) + 1;
      blockedDomainHitCount.set(domain, hitCount);
      if (hitCount < blockedDomainThreshold) {
        return;
      }
      if (blockedDomainsApplied.has(domain)) {
        return;
      }
      blockedDomainsApplied.add(domain);
      const removedCount = planner.blockHost(domain, Number(statusCode) === 429 ? 'status_429_backoff' : 'status_403_backoff');
      logger.warn('blocked_domain_cooldown_applied', {
        host: domain,
        status: Number(statusCode || 0) || null,
        blocked_count: hitCount,
        threshold: blockedDomainThreshold,
        removed_count: removedCount
      });
    };

    const fetchSourcePageData = async ({ source, sourceHost, hostBudgetRow } = {}) => {
      hostBudgetRow.started_count += 1;
      const hostBudgetAtStart = resolveHostBudgetState(hostBudgetRow);
      logger.info('source_fetch_started', {
        url: source.url,
        host: source.host,
        tier: source.tier,
        role: source.role,
        approved_domain: source.approvedDomain,
        fetcher_kind: fetcherMode,
        host_budget_score: hostBudgetAtStart.score,
        host_budget_state: hostBudgetAtStart.state
      });

      const fetchStartedAtMs = Date.now();
      try {
        const sourceFetchWrapperAttempts = Math.max(1, toInt(config.sourceFetchWrapperAttempts, 1));
        const sourceFetchWrapperBackoffMs = Math.max(0, toInt(config.sourceFetchWrapperBackoffMs, 0));
        const pageData = await runWithRetry(
          () => fetcher.fetch(source),
          {
            attempts: sourceFetchWrapperAttempts,
            shouldRetry: (error, { attempt, maxAttempts }) => {
              if (attempt >= maxAttempts) {
                return false;
              }
              const message = String(error?.message || '').toLowerCase();
              return (
                message.includes('no_result')
                || message.includes('timeout')
                || message.includes('timed out')
                || message.includes('network')
              );
            },
            onRetry: (error, { attempt, maxAttempts }) => {
              logger.warn('source_fetch_wrapper_retry', {
                url: source.url,
                host: source.host,
                attempt,
                max_attempts: maxAttempts,
                reason: String(error?.message || 'retryable_error')
              });
            },
            backoffMs: sourceFetchWrapperBackoffMs
          }
        );
        return {
          ok: true,
          pageData,
          fetchDurationMs: Math.max(0, Date.now() - fetchStartedAtMs)
        };
      } catch (error) {
        const fetchDurationMs = Math.max(0, Date.now() - fetchStartedAtMs);
        const fetchFailureOutcome = classifyFetchOutcome({
          status: 0,
          message: error.message
        });
        hostBudgetRow.completed_count += 1;
        bumpHostOutcome(hostBudgetRow, fetchFailureOutcome);
        applyHostBudgetBackoff(hostBudgetRow, {
          status: 0,
          outcome: fetchFailureOutcome,
          config
        });
        const hostBudgetAfterFailure = resolveHostBudgetState(hostBudgetRow);
        logger.error('source_fetch_failed', {
          url: source.url,
          host: source.host,
          fetcher_kind: fetcherMode,
          fetch_ms: fetchDurationMs,
          status: 0,
          outcome: fetchFailureOutcome,
          host_budget_score: hostBudgetAfterFailure.score,
          host_budget_state: hostBudgetAfterFailure.state,
          message: error.message
        });
        resumeFetchFailedUrls.add(String(source.url || '').trim());
        frontierDb?.recordFetch?.({
          productId,
          url: source.url,
          status: 0,
          elapsedMs: fetchDurationMs,
          error: error.message
        });
        maybeApplyBlockedDomainCooldown({
          source,
          statusCode: 0,
          message: error.message
        });
        if (traceWriter) {
          const fetchTrace = await traceWriter.writeJson({
            section: 'fetch',
            prefix: 'fetch',
            payload: {
              url: source.url,
              host: source.host,
              status: 0,
              fetch_ms: fetchDurationMs,
              outcome: fetchFailureOutcome,
              error: error.message
            },
            ringSize: Math.max(10, toInt(config.runtimeTraceFetchRing, 30))
          });
          logger.info('fetch_trace_written', {
            url: source.url,
            status: 0,
            content_type: null,
            trace_path: fetchTrace.trace_path
          });
        }
        return {
          ok: false
        };
      }
    };

    const collectKnownCandidatesFromSource = (mergedFieldCandidatesWithEvidence = []) => {
      const sourceFieldValueMap = {};
      const knownCandidatesFromSource = (mergedFieldCandidatesWithEvidence || [])
        .filter((candidate) => {
          const value = String(candidate.value || '').trim().toLowerCase();
          return value && value !== 'unk';
        })
        .map((candidate) => {
          const field = String(candidate.field || '').trim();
          if (field && sourceFieldValueMap[field] === undefined) {
            sourceFieldValueMap[field] = String(candidate.value || '');
          }
          return field;
        })
        .filter(Boolean);
      return {
        sourceFieldValueMap,
        knownCandidatesFromSource
      };
    };

    const buildSourceProcessedPayload = ({
      source,
      sourceUrl,
      fetchDurationMs,
      parseDurationMs,
      pageData,
      sourceFetchOutcome,
      fetchContentType,
      pageContentHash,
      pageBytes,
      identity,
      anchorStatus,
      mergedFieldCandidatesWithEvidence,
      llmFieldCandidates,
      articleExtractionMeta,
      staticDomMeta,
      structuredMeta,
      pdfExtractionMeta,
      screenshotUri,
      domSnippetUri,
      hostBudgetAfterSource
    } = {}) => ({
      url: source.url,
      final_url: sourceUrl,
      host: source.host,
      fetcher_kind: fetcherMode,
      fetch_ms: fetchDurationMs,
      parse_ms: parseDurationMs,
      status: pageData.status,
      outcome: sourceFetchOutcome,
      content_type: fetchContentType,
      content_hash: pageContentHash,
      bytes: pageBytes,
      identity_match: identity.match,
      identity_score: identity.score,
      anchor_status: anchorStatus,
      candidate_count: mergedFieldCandidatesWithEvidence.length,
      candidate_source: source.candidateSource,
      llm_candidate_count: llmFieldCandidates.length,
      fetch_attempts: Number(pageData?.fetchTelemetry?.attempts || 0),
      fetch_retry_count: Number(pageData?.fetchTelemetry?.retry_count || 0),
      fetch_policy_matched_host: String(pageData?.fetchTelemetry?.policy?.matched_host || '').trim(),
      fetch_policy_override_applied: Boolean(pageData?.fetchTelemetry?.policy?.override_applied),
      article_title: String(articleExtractionMeta.title || ''),
      article_excerpt: String(articleExtractionMeta.excerpt || ''),
      article_preview: String(articleExtractionMeta.preview || ''),
      article_extraction_method: String(articleExtractionMeta.method || ''),
      article_quality_score: Number(articleExtractionMeta.quality_score || 0),
      article_char_count: Number(articleExtractionMeta.char_count || 0),
      article_heading_count: Number(articleExtractionMeta.heading_count || 0),
      article_duplicate_sentence_ratio: Number(articleExtractionMeta.duplicate_sentence_ratio || 0),
      article_low_quality: Boolean(articleExtractionMeta.low_quality),
      article_fallback_reason: String(articleExtractionMeta.fallback_reason || ''),
      article_policy_mode: String(articleExtractionMeta.policy_mode || ''),
      article_policy_matched_host: String(articleExtractionMeta.policy_matched_host || ''),
      article_policy_override_applied: Boolean(articleExtractionMeta.policy_override_applied),
      static_dom_mode: String(staticDomMeta.mode || ''),
      static_dom_accepted_field_candidates: Number(staticDomMeta.accepted_field_candidates || 0),
      static_dom_rejected_field_candidates: Number(staticDomMeta.rejected_field_candidates || 0),
      static_dom_parse_error_count: Number(staticDomMeta.parse_error_count || 0),
      static_dom_rejected_field_candidates_audit_count: Number(staticDomMeta.rejected_field_candidates_audit_count || 0),
      structured_json_ld_count: Number(structuredMeta.json_ld_count || 0),
      structured_microdata_count: Number(structuredMeta.microdata_count || 0),
      structured_opengraph_count: Number(structuredMeta.opengraph_count || 0),
      structured_candidates: Number(structuredMeta.structured_candidates || 0),
      structured_rejected_candidates: Number(structuredMeta.structured_rejected_candidates || 0),
      structured_error_count: Number(structuredMeta.error_count || 0),
      structured_snippet_rows: Array.isArray(structuredMeta.snippet_rows)
        ? structuredMeta.snippet_rows.slice(0, 20)
        : [],
      pdf_docs_parsed: Number(pdfExtractionMeta.docs_parsed || 0),
      pdf_pairs_total: Number(pdfExtractionMeta.pair_count || 0),
      pdf_kv_pairs: Number(pdfExtractionMeta.kv_pair_count || 0),
      pdf_table_pairs: Number(pdfExtractionMeta.table_pair_count || 0),
      pdf_pages_scanned: Number(pdfExtractionMeta.pages_scanned || 0),
      pdf_error_count: Number(pdfExtractionMeta.error_count || 0),
      pdf_backend_selected: String(pdfExtractionMeta.backend_selected || ''),
      scanned_pdf_docs_detected: Number(pdfExtractionMeta.scanned_docs_detected || 0),
      scanned_pdf_ocr_docs_attempted: Number(pdfExtractionMeta.scanned_docs_ocr_attempted || 0),
      scanned_pdf_ocr_docs_succeeded: Number(pdfExtractionMeta.scanned_docs_ocr_succeeded || 0),
      scanned_pdf_ocr_pairs: Number(pdfExtractionMeta.scanned_ocr_pair_count || 0),
      scanned_pdf_ocr_kv_pairs: Number(pdfExtractionMeta.scanned_ocr_kv_pair_count || 0),
      scanned_pdf_ocr_table_pairs: Number(pdfExtractionMeta.scanned_ocr_table_pair_count || 0),
      scanned_pdf_ocr_low_conf_pairs: Number(pdfExtractionMeta.scanned_ocr_low_confidence_pairs || 0),
      scanned_pdf_ocr_error_count: Number(pdfExtractionMeta.scanned_ocr_error_count || 0),
      scanned_pdf_ocr_backend_selected: String(pdfExtractionMeta.scanned_ocr_backend_selected || ''),
      scanned_pdf_ocr_confidence_avg: Number(pdfExtractionMeta.scanned_ocr_confidence_avg || 0),
      screenshot_uri: screenshotUri || '',
      dom_snippet_uri: domSnippetUri || '',
      host_budget_score: hostBudgetAfterSource.score,
      host_budget_state: hostBudgetAfterSource.state
    });

    const shouldSkipSourceBeforeFetch = ({
      source,
      sourceHost,
      hostBudgetRow
    } = {}) => {
      if ((runtimeOverrides.blocked_domains || []).includes(String(source.host || '').toLowerCase().replace(/^www\./, ''))) {
        logger.info('runtime_domain_block_applied', {
          host: source.host,
          url: source.url
        });
        resumeCooldownSkippedUrls.add(String(source.url || '').trim());
        return true;
      }

      const cooldownDecision = frontierDb?.shouldSkipUrl?.(source.url) || { skip: false };
      if (cooldownDecision.skip) {
        hostBudgetRow.dedupe_hits += 1;
        noteHostRetryTs(hostBudgetRow, cooldownDecision.next_retry_ts || '');
        const hostBudget = resolveHostBudgetState(hostBudgetRow);
        logger.info('source_fetch_skipped', {
          url: source.url,
          host: sourceHost || source.host || '',
          skip_reason: 'cooldown',
          reason: cooldownDecision.reason || 'frontier_cooldown',
          next_retry_ts: cooldownDecision.next_retry_ts || null,
          host_budget_score: hostBudget.score,
          host_budget_state: hostBudget.state
        });
        logger.info('url_cooldown_applied', {
          url: source.url,
          status: null,
          cooldown_seconds: null,
          next_retry_ts: cooldownDecision.next_retry_ts || null,
          reason: cooldownDecision.reason || 'frontier_cooldown'
        });
        resumeCooldownSkippedUrls.add(String(source.url || '').trim());
        return true;
      }

      const hostBudgetBeforeFetch = resolveHostBudgetState(hostBudgetRow);
      if (hostBudgetBeforeFetch.state === 'blocked') {
        logger.info('source_fetch_skipped', {
          url: source.url,
          host: sourceHost || source.host || '',
          skip_reason: 'blocked_budget',
          reason: 'host_budget_blocked',
          next_retry_ts: hostBudgetBeforeFetch.next_retry_ts || null,
          host_budget_score: hostBudgetBeforeFetch.score,
          host_budget_state: hostBudgetBeforeFetch.state
        });
        resumeCooldownSkippedUrls.add(String(source.url || '').trim());
        return true;
      }
      if (hostBudgetBeforeFetch.state === 'backoff') {
        logger.info('source_fetch_skipped', {
          url: source.url,
          host: sourceHost || source.host || '',
          skip_reason: 'retry_later',
          reason: 'host_budget_backoff',
          next_retry_ts: hostBudgetBeforeFetch.next_retry_ts || null,
          host_budget_score: hostBudgetBeforeFetch.score,
          host_budget_state: hostBudgetBeforeFetch.state
        });
        resumeCooldownSkippedUrls.add(String(source.url || '').trim());
        return true;
      }

      return false;
    };

    const buildSourceArtifacts = async ({
      source,
      pageData,
      sourceStatusCode,
      fetchDurationMs,
      fetchContentType,
      sourceFetchOutcome
    } = {}) => {
      const domSnippetArtifact = buildDomSnippetArtifact(
        pageData.html,
        Math.max(600, toInt(config.domSnippetMaxChars, 3_600))
      );
      const artifactHostKey = `${source.host}__${String(artifactSequence).padStart(4, '0')}`;
      artifactSequence += 1;

      const domSnippetUri = domSnippetArtifact
        ? `${runArtifactsBase}/raw/dom/${artifactHostKey}/dom_snippet.html`
        : '';
      if (domSnippetArtifact && domSnippetUri) {
        domSnippetArtifact.uri = domSnippetUri;
        domSnippetArtifact.content_hash = `sha256:${sha256(domSnippetArtifact.html || '')}`;
      }

      const screenshotArtifact = pageData?.screenshot && typeof pageData.screenshot === 'object'
        ? pageData.screenshot
        : null;
      const screenshotBytes = Buffer.isBuffer(screenshotArtifact?.bytes)
        ? screenshotArtifact.bytes
        : null;
      const screenshotFormat = String(screenshotArtifact?.format || 'jpeg').trim().toLowerCase() === 'png'
        ? 'png'
        : 'jpeg';
      const screenshotUri = screenshotArtifact
        ? `${runArtifactsBase}/raw/screenshots/${artifactHostKey}/screenshot.${screenshotExtension(screenshotFormat)}`
        : '';
      const screenshotFileUri = screenshotArtifact && screenshotUri && typeof storage.resolveLocalPath === 'function'
        ? storage.resolveLocalPath(screenshotUri)
        : screenshotUri;
      if (screenshotArtifact && screenshotUri) {
        screenshotArtifact.uri = screenshotUri;
        screenshotArtifact.file_uri = screenshotFileUri;
        screenshotArtifact.mime_type = screenshotMimeType(screenshotFormat);
        screenshotArtifact.content_hash = screenshotArtifact.content_hash || sha256Buffer(screenshotBytes);
      }
      if (domSnippetArtifact && domSnippetUri) {
        try {
          await storage.writeObject(
            domSnippetUri,
            domSnippetArtifact.html || '',
            { contentType: 'text/html; charset=utf-8' }
          );
        } catch (error) {
          logger.warn('dom_snippet_persist_failed', {
            url: source.url,
            uri: domSnippetUri,
            message: error?.message || 'write_failed'
          });
        }
      }
      if (screenshotArtifact && screenshotUri && Buffer.isBuffer(screenshotBytes)) {
        try {
          await storage.writeObject(
            screenshotUri,
            screenshotBytes,
            { contentType: screenshotMimeType(screenshotFormat) }
          );
        } catch (error) {
          logger.warn('screenshot_persist_failed', {
            url: source.url,
            uri: screenshotUri,
            message: error?.message || 'write_failed'
          });
        }
      }
      if (traceWriter) {
        const fetchTrace = await traceWriter.writeJson({
          section: 'fetch',
          prefix: 'fetch',
          payload: {
            ts: new Date().toISOString(),
            url: source.url,
            final_url: pageData.finalUrl || source.url,
            host: source.host,
            status: sourceStatusCode,
            outcome: sourceFetchOutcome,
            fetch_ms: fetchDurationMs,
            content_type: fetchContentType,
            title: pageData.title || '',
            html_chars: String(pageData.html || '').length,
            network_count: Array.isArray(pageData.networkResponses) ? pageData.networkResponses.length : 0,
            dom_snippet_uri: domSnippetUri || null,
            screenshot_uri: screenshotUri || null
          },
          ringSize: Math.max(10, toInt(config.runtimeTraceFetchRing, 30))
        });
        logger.info('fetch_trace_written', {
          url: source.url,
          status: sourceStatusCode,
          fetch_ms: fetchDurationMs,
          content_type: fetchContentType,
          trace_path: fetchTrace.trace_path
        });

        const htmlPreview = String(pageData.html || '').slice(0, 200_000);
        if (htmlPreview) {
          const htmlTrace = await traceWriter.writeText({
            section: 'fetch_html_preview',
            prefix: 'fetch',
            extension: 'html',
            text: htmlPreview,
            ringSize: Math.max(10, toInt(config.runtimeTraceFetchRing, 30)),
            contentType: 'text/html; charset=utf-8'
          });
          logger.info('artifact_written', {
            kind: 'html_preview',
            path: htmlTrace.trace_path
          });
        }

        const networkRows = Array.isArray(pageData.networkResponses) ? pageData.networkResponses.slice(0, 40) : [];
        if (networkRows.length > 0) {
          const networkTrace = await traceWriter.writeJson({
            section: 'fetch_network_preview',
            prefix: 'fetch',
            payload: networkRows,
            ringSize: Math.max(10, toInt(config.runtimeTraceFetchRing, 30))
          });
          logger.info('artifact_written', {
            kind: 'network_preview',
            path: networkTrace.trace_path
          });
        }
      }
      return {
        domSnippetArtifact,
        artifactHostKey,
        domSnippetUri,
        screenshotArtifact,
        screenshotUri,
        screenshotFileUri
      };
    };

    const runSourceExtraction = async ({
      source,
      pageData,
      sourceStatusCode,
      fetchDurationMs,
      fetchContentType,
      sourceFetchOutcome,
      parseStartedAtMs,
      hostBudgetRow,
      domSnippetArtifact,
      artifactHostKey,
      domSnippetUri,
      screenshotArtifact,
      screenshotUri,
      screenshotFileUri
    } = {}) => {
      maybeApplyBlockedDomainCooldown({
        source,
        statusCode: sourceStatusCode,
        message: String(pageData?.error || '')
      });

      planner.discoverFromHtml(source.url, pageData.html);
      if (source.role === 'manufacturer') {
        if (isRobotsTxtUrl(source.url)) {
          planner.discoverFromRobots(source.url, pageData.html);
        }
        if (isSitemapUrl(source.url) || hasSitemapXmlSignals(pageData.html)) {
          planner.discoverFromSitemap(source.url, pageData.html);
        }
      }

      const sourceUrl = pageData.finalUrl || source.url;
      const discoveryOnlySource = isDiscoveryOnlySourceUrl(sourceUrl);
      const endpointIntel = mineEndpointSignals({
        source,
        pageData,
        criticalFields: [...(categoryConfig.criticalFieldSet || new Set())],
        networkScanLimit: Math.max(50, Number(config.endpointNetworkScanLimit || 600)),
        limit: Math.max(1, Number(config.endpointSignalLimit || 30)),
        suggestionLimit: Math.max(1, Number(config.endpointSuggestionLimit || 12))
      });
      const fingerprint = buildSiteFingerprint({ source, pageData });

      if (source.role === 'manufacturer') {
        for (const suggestion of endpointIntel.nextBestUrls || []) {
          if (!isLikelyIndexableEndpointUrl(suggestion.url)) {
            continue;
          }
          if (!isSafeManufacturerFollowupUrl(source, suggestion.url)) {
            continue;
          }
          planner.enqueue(suggestion.url, `endpoint:${source.url}`);
        }
      }

      const extraction = discoveryOnlySource
        ? {
          identityCandidates: {},
          fieldCandidates: [],
          staticDom: {
            parserStats: {
              mode: '',
              accepted_field_candidates: 0,
              rejected_field_candidates: 0,
              parse_error_count: 0
            },
            auditRejectedFieldCandidates: []
          },
          structuredMetadata: {
            stats: {
              json_ld_count: 0,
              microdata_count: 0,
              opengraph_count: 0,
              structured_candidates: 0,
              structured_rejected_candidates: 0
            },
            snippetRows: [],
            errors: []
          }
        }
        : extractCandidatesFromPage({
          host: source.host,
          html: pageData.html,
          canonicalUrl: sourceUrl,
          title: pageData.title,
          ldjsonBlocks: pageData.ldjsonBlocks,
          embeddedState: pageData.embeddedState,
          networkResponses: pageData.networkResponses,
          structuredMetadata: pageData.structuredMetadata || null,
          staticDomExtractorEnabled: config.staticDomExtractorEnabled !== false,
          staticDomMode: config.staticDomMode || 'cheerio',
          htmlTableExtractorV2: config.htmlTableExtractorV2 !== false,
          staticDomTargetMatchThreshold: Number(config.staticDomTargetMatchThreshold || 0.55),
          staticDomMaxEvidenceSnippets: Number(config.staticDomMaxEvidenceSnippets || 120),
          identityTarget: job.identityLock || {}
        });

      const adapterExtra = discoveryOnlySource
        ? {
          additionalUrls: [],
          fieldCandidates: [],
          identityCandidates: {},
          pdfDocs: [],
          adapterArtifacts: []
        }
        : await adapterManager.extractForPage({
          source,
          pageData,
          job,
          runId
        });

      for (const url of adapterExtra.additionalUrls || []) {
        planner.enqueue(url, `adapter:${source.url}`);
      }
      const baseDeterministicFieldCandidates = dedupeCandidates([
        ...(extraction.fieldCandidates || []),
        ...(adapterExtra.fieldCandidates || [])
      ]);
      let deterministicFieldCandidates = [...baseDeterministicFieldCandidates];

      let llmExtraction = {
        identityCandidates: {},
        fieldCandidates: [],
        conflicts: [],
        notes: []
      };
      let evidencePack = null;
      const evidenceEligibleSource =
        !discoveryOnlySource &&
        sourceStatusCode > 0 &&
        sourceStatusCode < 500;
      if (evidenceEligibleSource) {
        evidencePack = buildEvidencePack({
          source: {
            ...source,
            status: sourceStatusCode,
            finalUrl: pageData.finalUrl || source.url,
            fetchedAt: new Date().toISOString(),
            fetchMethod: fetcherMode,
            productId,
            category
          },
          pageData: {
            ...pageData,
            domSnippet: domSnippetArtifact
          },
          adapterExtra,
          config,
          targetFields: llmTargetFields,
          deterministicCandidates: baseDeterministicFieldCandidates
        });
        if (evidencePack && screenshotUri) {
          const visualAssetId = `img_${sha256(`${artifactHostKey}|${screenshotUri}`).slice(0, 12)}`;
          const visualAsset = {
            id: visualAssetId,
            kind: 'screenshot_capture',
            source_id: String(evidencePack?.meta?.source_id || source.host || '').trim(),
            source_url: String(pageData.finalUrl || source.url || '').trim(),
            file_uri: screenshotFileUri || screenshotUri,
            mime_type: String(screenshotArtifact?.mime_type || '').trim() || null,
            content_hash: String(screenshotArtifact?.content_hash || '').trim() || null,
            width: Number(screenshotArtifact?.width || 0) || null,
            height: Number(screenshotArtifact?.height || 0) || null,
            size_bytes: Buffer.isBuffer(screenshotArtifact?.bytes)
              ? screenshotArtifact.bytes.length
              : (Number.isFinite(Number(screenshotArtifact?.bytes)) ? Number(screenshotArtifact.bytes) : null),
            captured_at: String(screenshotArtifact?.captured_at || new Date().toISOString()).trim()
          };
          const existingVisualAssets = Array.isArray(evidencePack.visual_assets)
            ? evidencePack.visual_assets
            : [];
          evidencePack.visual_assets = [
            ...existingVisualAssets,
            visualAsset
          ];
          evidencePack.meta = {
            ...(evidencePack.meta || {}),
            visual_artifacts: {
              ...(evidencePack.meta?.visual_artifacts || {}),
              screenshot_uri: screenshotFileUri || screenshotUri,
              screenshot_content_hash: String(screenshotArtifact?.content_hash || '').trim() || '',
              dom_snippet_uri: domSnippetUri || '',
              dom_snippet_content_hash: String(domSnippetArtifact?.content_hash || '').trim() || ''
            }
          };
        }
      }

      if (deterministicParser && evidencePack) {
        const parserCandidates = deterministicParser.extractFromEvidencePack(evidencePack, {
          targetFields: llmTargetFields
        });
        if (parserCandidates.length > 0) {
          deterministicFieldCandidates = dedupeCandidates([
            ...deterministicFieldCandidates,
            ...parserCandidates
          ]);
        }
      }

      if (componentResolver) {
        deterministicFieldCandidates = componentResolver.resolveFromCandidates(deterministicFieldCandidates);
      }

      const deterministicFilledFieldSet = new Set(
        deterministicFieldCandidates
          .filter((row) => String(row?.value || '').trim().toLowerCase() !== 'unk')
          .map((row) => String(row?.field || '').trim())
          .filter(Boolean)
      );
      const llmTargetFieldsForSource = llmTargetFields.filter((field) => (
        !deterministicFilledFieldSet.has(field) &&
        !llmSatisfiedFields.has(field) &&
        !isIdentityLockedField(field) &&
        !isAnchorLocked(field, anchors)
      ));

      const llmEligibleSource =
        config.llmEnabled &&
        !runtimeOverrides.disable_llm &&
        Boolean(evidencePack) &&
        sourceStatusCode < 400 &&
        llmTargetFieldsForSource.length > 0;
      let llmSkipReason = '';
      if (llmEligibleSource) {
        llmExtraction = await extractCandidatesLLM({
          job,
          categoryConfig,
          evidencePack,
          goldenExamples,
          targetFields: llmTargetFieldsForSource,
          config,
          logger,
          llmContext,
          componentDBs: runtimeFieldRulesEngine?.componentDBs || {},
          knownValues: runtimeFieldRulesEngine?.knownValues || {}
        });
      } else if (config.llmEnabled) {
        llmSkipReason = discoveryOnlySource
          ? 'discovery_only_source'
          : sourceStatusCode >= 500
            ? 'http_status_source_unavailable'
            : sourceStatusCode >= 400
              ? 'http_status_not_extractable'
              : runtimeOverrides.disable_llm
                ? 'runtime_override_disable_llm'
                : llmTargetFieldsForSource.length === 0
                  ? 'no_remaining_llm_target_fields'
                  : 'source_not_extractable';
        logger.info('llm_extract_skipped_source', {
          url: source.url,
          status: sourceStatusCode || null,
          reason: llmSkipReason
        });
        if (shouldQueueLlmRetry({
          reason: llmSkipReason,
          status: sourceStatusCode,
          discoveryOnly: discoveryOnlySource
        })) {
          llmRetryReasonByUrl.set(sourceUrl, llmSkipReason);
          logger.info('llm_retry_source_queued', {
            url: sourceUrl,
            reason: llmSkipReason
          });
        }
      }
      if (llmExtraction?.phase08 && typeof llmExtraction.phase08 === 'object') {
        const sourceUrlForPhase08 = String(source.finalUrl || source.url || '').trim();
        const sourceHostForPhase08 = normalizeHostToken(source.host || hostFromHttpUrl(sourceUrlForPhase08));
        const phase08Rows = Array.isArray(llmExtraction.phase08.batches)
          ? llmExtraction.phase08.batches
          : [];
        phase08BatchRows.push(
          ...phase08Rows.map((row) => ({
            ...row,
            source_url: sourceUrlForPhase08 || null,
            source_host: sourceHostForPhase08 || null
          }))
        );
        phase08FieldContexts = {
          ...phase08FieldContexts,
          ...(llmExtraction.phase08.field_contexts || {})
        };
        phase08PrimeRows = mergePhase08Rows(
          phase08PrimeRows,
          Array.isArray(llmExtraction?.phase08?.prime_sources?.rows)
            ? llmExtraction.phase08.prime_sources.rows
            : [],
          500
        );
      }

      const llmFieldCandidates = (llmExtraction.fieldCandidates || []).filter((row) => {
        if (isIdentityLockedField(row.field)) {
          return false;
        }
        if (isAnchorLocked(row.field, anchors)) {
          return false;
        }
        return true;
      });
      const llmNotesLower = (llmExtraction.notes || [])
        .map((note) => String(note || '').toLowerCase())
        .join(' | ');
      if (
        llmEligibleSource &&
        llmFieldCandidates.length === 0 &&
        (llmNotesLower.includes('budget guard') || llmNotesLower.includes('skipped by budget'))
      ) {
        const budgetReason = 'llm_budget_guard_blocked';
        llmRetryReasonByUrl.set(sourceUrl, budgetReason);
        logger.info('llm_retry_source_queued', {
          url: sourceUrl,
          reason: budgetReason
        });
      }

      const mergedFieldCandidates = dedupeCandidates([
        ...deterministicFieldCandidates,
        ...llmFieldCandidates
      ]);
      const mergedFieldCandidatesWithEvidence = enrichFieldCandidatesWithEvidenceRefs(
        mergedFieldCandidates,
        evidencePack
      );
      const temporalSignals = extractTemporalSignals({
        source,
        pageData,
        fieldCandidates: mergedFieldCandidatesWithEvidence
      });

      const mergedIdentityCandidates = {
        ...(extraction.identityCandidates || {}),
        ...(adapterExtra.identityCandidates || {})
      };
      for (const [key, value] of Object.entries(llmExtraction.identityCandidates || {})) {
        if (String(job.identityLock?.[key] || '').trim() !== '') {
          continue;
        }
        if (!mergedIdentityCandidates[key]) {
          mergedIdentityCandidates[key] = value;
        }
      }

      const candidateFieldMap = buildCandidateFieldMap(mergedFieldCandidatesWithEvidence);
      const anchorCheck = evaluateAnchorConflicts(anchors, candidateFieldMap);
      const identity = evaluateSourceIdentity(
        {
          ...source,
          title: pageData.title,
          identityCandidates: mergedIdentityCandidates,
          connectionHint: candidateFieldMap.connection
        },
        job.identityLock || {}
      );

      const anchorStatus =
        anchorCheck.majorConflicts.length > 0
          ? 'failed_major_conflict'
          : anchorCheck.conflicts.length > 0
            ? 'minor_conflicts'
            : 'pass';
      const manufacturerBrandMismatch =
        source.role === 'manufacturer' &&
        source.approvedDomain &&
        Array.isArray(identity.criticalConflicts) &&
        identity.criticalConflicts.includes('brand_mismatch') &&
        !(identity.reasons || []).includes('brand_match');
      const parserHealth = computeParserHealth({
        source,
        mergedFieldCandidates: mergedFieldCandidatesWithEvidence,
        identity,
        anchorCheck,
        criticalFieldSet: categoryConfig.criticalFieldSet,
        endpointSignals: endpointIntel.endpointSignals
      });

      const artifactRefs = {
        host_key: artifactHostKey,
        screenshot_uri: screenshotUri || '',
        screenshot_file_uri: screenshotFileUri || '',
        screenshot_mime_type: String(screenshotArtifact?.mime_type || '').trim() || null,
        screenshot_content_hash: String(screenshotArtifact?.content_hash || '').trim() || null,
        screenshot_width: Number(screenshotArtifact?.width || 0) || null,
        screenshot_height: Number(screenshotArtifact?.height || 0) || null,
        screenshot_size_bytes: Buffer.isBuffer(screenshotArtifact?.bytes)
          ? screenshotArtifact.bytes.length
          : (Number.isFinite(Number(screenshotArtifact?.bytes)) ? Number(screenshotArtifact.bytes) : null),
        dom_snippet_uri: domSnippetUri || '',
        dom_snippet_content_hash: String(domSnippetArtifact?.content_hash || '').trim() || null
      };

      const staticDomStats = extraction?.staticDom?.parserStats && typeof extraction.staticDom.parserStats === 'object'
        ? extraction.staticDom.parserStats
        : {};
      const staticDomAuditRejectedCount = Array.isArray(extraction?.staticDom?.auditRejectedFieldCandidates)
        ? extraction.staticDom.auditRejectedFieldCandidates.length
        : 0;
      const structuredStats = extraction?.structuredMetadata?.stats && typeof extraction.structuredMetadata.stats === 'object'
        ? extraction.structuredMetadata.stats
        : {};
      const structuredSnippetRows = Array.isArray(extraction?.structuredMetadata?.snippetRows)
        ? extraction.structuredMetadata.snippetRows
        : [];
      const structuredErrors = Array.isArray(extraction?.structuredMetadata?.errors)
        ? extraction.structuredMetadata.errors
        : [];
      const pdfExtractionMeta = (
        evidencePack?.meta?.pdf_extraction
        && typeof evidencePack.meta.pdf_extraction === 'object'
      )
        ? evidencePack.meta.pdf_extraction
        : {};

      await finalizeProcessedSource({
        source,
        pageData,
        sourceStatusCode,
        discoveryOnlySource,
        sourceUrl,
        mergedIdentityCandidates,
        mergedFieldCandidatesWithEvidence,
        anchorCheck,
        anchorStatus,
        endpointIntel,
        temporalSignals,
        evidencePack,
        artifactHostKey,
        artifactRefs,
        fingerprint,
        parserHealth,
        manufacturerBrandMismatch,
        identity,
        llmExtraction,
        fetchContentType,
        fetchDurationMs,
        sourceFetchOutcome,
        hostBudgetRow,
        parseStartedAtMs,
        llmFieldCandidates,
        domSnippetArtifact,
        adapterExtra,
        staticDomStats,
        staticDomAuditRejectedCount,
        structuredStats,
        structuredSnippetRows,
        structuredErrors,
        pdfExtractionMeta,
        screenshotUri,
        domSnippetUri
      });
    };
    const processFetchedSource = async ({
      source,
      hostBudgetRow,
      sourceFetch
    } = {}) => {
      const pageData = sourceFetch.pageData;
      const fetchDurationMs = sourceFetch.fetchDurationMs;
      const parseStartedAtMs = Date.now();
      const sourceStatusCode = Number.parseInt(String(pageData.status || 0), 10) || 0;
      let fetchContentType = 'text/html';
      const finalToken = String(pageData.finalUrl || source.url || "").toLowerCase();
      if (finalToken.endsWith('.pdf')) {
        fetchContentType = 'application/pdf';
      } else if (finalToken.endsWith('.json')) {
        fetchContentType = 'application/json';
      } else if (!String(pageData.html || '').trim()) {
        fetchContentType = 'application/octet-stream';
      }
      const sourceFetchOutcome = classifyFetchOutcome({
        status: sourceStatusCode,
        contentType: fetchContentType,
        html: pageData.html || ''
      });

      const artifactContext = await buildSourceArtifacts({
        source,
        pageData,
        sourceStatusCode,
        fetchDurationMs,
        fetchContentType,
        sourceFetchOutcome
      });

      await runSourceExtraction({
        source,
        pageData,
        sourceStatusCode,
        fetchDurationMs,
        fetchContentType,
        sourceFetchOutcome,
        parseStartedAtMs,
        hostBudgetRow,
        ...artifactContext
      });
    };
    const finalizeProcessedSource = async ({
      source,
      pageData,
      sourceStatusCode,
      discoveryOnlySource,
      sourceUrl,
      mergedIdentityCandidates,
      mergedFieldCandidatesWithEvidence,
      anchorCheck,
      anchorStatus,
      endpointIntel,
      temporalSignals,
      evidencePack,
      artifactHostKey,
      artifactRefs,
      fingerprint,
      parserHealth,
      manufacturerBrandMismatch,
      identity,
      llmExtraction,
      fetchContentType,
      fetchDurationMs,
      sourceFetchOutcome,
      hostBudgetRow,
      parseStartedAtMs,
      llmFieldCandidates,
      domSnippetArtifact,
      adapterExtra,
      staticDomStats,
      staticDomAuditRejectedCount,
      structuredStats,
      structuredSnippetRows,
      structuredErrors,
      pdfExtractionMeta,
      screenshotUri,
      domSnippetUri
    } = {}) => {
      sourceResults.push({
        ...source,
        ts: new Date().toISOString(),
        status: pageData.status,
        finalUrl: pageData.finalUrl,
        discoveryOnly: discoveryOnlySource,
        title: pageData.title,
        identity,
        identityCandidates: mergedIdentityCandidates,
        fieldCandidates: mergedFieldCandidatesWithEvidence,
        anchorCheck,
        anchorStatus,
        endpointSignals: endpointIntel.endpointSignals,
        endpointSuggestions: endpointIntel.nextBestUrls,
        temporalSignals,
        llmEvidencePack: evidencePack,
        artifact_host_key: artifactHostKey,
        artifact_refs: artifactRefs,
        fingerprint,
        parserHealth
      });
      if (!discoveryOnlySource && sourceStatusCode >= 200 && sourceStatusCode < 400) {
        successfulSourceMetaByUrl.set(sourceUrl, {
          last_success_at: new Date().toISOString(),
          status: sourceStatusCode
        });
      }

      if (manufacturerBrandMismatch) {
        const removedCount = planner.blockHost(source.host, 'brand_mismatch');
        logger.warn('manufacturer_host_blocked', {
          host: source.host,
          url: source.url,
          reason: 'brand_mismatch',
          removed_count: removedCount
        });
      }

      if (discoveryOnlySource) {
        logger.info('source_discovery_only', {
          url: sourceUrl
        });
      }

      const { sourceFieldValueMap, knownCandidatesFromSource } = collectKnownCandidatesFromSource(
        mergedFieldCandidatesWithEvidence
      );

      if (
        source.approvedDomain &&
        identity.match &&
        (anchorCheck.majorConflicts || []).length === 0
      ) {
        planner.markFieldsFilled(knownCandidatesFromSource);
        markSatisfiedLlmFields(llmSatisfiedFields, knownCandidatesFromSource, anchors);
      }

      if (knownCandidatesFromSource.length > 0) {
        const uniqueFields = [...new Set(knownCandidatesFromSource)];
        logger.info('fields_filled_from_source', {
          url: sourceUrl,
          host: source.host,
          filled_fields: uniqueFields.slice(0, 40),
          count: uniqueFields.length
        });
        if (traceWriter) {
          await traceWriter.appendJsonl({
            section: 'fields',
            filename: 'field_timeline.jsonl',
            row: {
              ts: new Date().toISOString(),
              url: sourceUrl,
              host: source.host,
              fields: uniqueFields.slice(0, 60)
            }
          });
        }
      }

      for (const conflict of llmExtraction.conflicts || []) {
        const field = String(conflict?.field || '').trim();
        if (!field) {
          continue;
        }
        logger.info('field_conflict_detected', {
          field,
          value_a: String(conflict?.value_a || conflict?.left || ''),
          value_b: String(conflict?.value_b || conflict?.right || ''),
          sources: Array.isArray(conflict?.sources) ? conflict.sources.slice(0, 6) : []
        });
      }

      const pageHtml = String(pageData.html || '');
      const pageContentHash = sha256(pageHtml);
      const pageBytes = pageHtml.length;
      const frontierFetchRow = frontierDb?.recordFetch?.({
        productId,
        url: source.url,
        finalUrl: sourceUrl,
        status: sourceStatusCode,
        contentType: fetchContentType,
        contentHash: pageContentHash,
        bytes: pageBytes,
        elapsedMs: fetchDurationMs,
        fieldsFound: [...new Set(knownCandidatesFromSource)],
        confidence: toFloat(identity.score, 0),
        conflictFlag: (anchorCheck.majorConflicts || []).length > 0
      });
      for (const field of [...new Set(knownCandidatesFromSource)]) {
        frontierDb?.recordYield?.({
          url: sourceUrl,
          fieldKey: field,
          valueHash: sha256(String(sourceFieldValueMap[field] || '')),
          confidence: toFloat(identity.score, 0),
          conflictFlag: false
        });
      }
      if (sourceStatusCode === 404 || sourceStatusCode === 410) {
        const cooldownUntil = String(
          frontierFetchRow?.cooldown?.next_retry_ts || frontierFetchRow?.cooldown_next_retry_ts || ''
        ).trim();
        maybeEmitRepairQuery({
          source,
          sourceUrl,
          statusCode: sourceStatusCode,
          reason: sourceStatusCode === 410 ? 'status_410' : 'status_404',
          cooldownUntil
        });
      }

      artifactsByHost[artifactHostKey] = {
        html: pageData.html,
        ldjsonBlocks: pageData.ldjsonBlocks,
        embeddedState: pageData.embeddedState,
        networkResponses: pageData.networkResponses,
        screenshot: pageData.screenshot || null,
        domSnippet: domSnippetArtifact,
        pdfDocs: adapterExtra.pdfDocs || [],
        extractedCandidates: mergedFieldCandidatesWithEvidence
      };

      adapterArtifacts.push(...(adapterExtra.adapterArtifacts || []));
      if (config.llmEnabled) {
        adapterArtifacts.push({
          name: `llm_${source.host}`,
          payload: {
            url: source.url,
            evidence_ref_count: evidencePack?.references?.length || 0,
            llm_candidate_count: llmFieldCandidates.length,
            llm_conflicts: llmExtraction.conflicts,
            llm_notes: llmExtraction.notes
          }
        });
      }

      if (llmFieldCandidates.length > 0) {
        llmSourcesUsed += 1;
        llmCandidatesAccepted += llmFieldCandidates.length;
      }

      hostBudgetRow.completed_count += 1;
      bumpHostOutcome(hostBudgetRow, sourceFetchOutcome);
      if (sourceFetchOutcome === 'bad_content') {
        hostBudgetRow.parse_fail_count += 1;
      }
      if (knownCandidatesFromSource.length > 0) {
        hostBudgetRow.evidence_used += 1;
      }
      const hostCooldownUntil = String(
        frontierFetchRow?.cooldown?.next_retry_ts || frontierFetchRow?.cooldown_next_retry_ts || ''
      ).trim();
      if (hostCooldownUntil) {
        noteHostRetryTs(hostBudgetRow, hostCooldownUntil);
      } else {
        applyHostBudgetBackoff(hostBudgetRow, {
          status: sourceStatusCode,
          outcome: sourceFetchOutcome,
          config
        });
      }
      const hostBudgetAfterSource = resolveHostBudgetState(hostBudgetRow);
      const parseDurationMs = Math.max(0, Date.now() - parseStartedAtMs);
      const articleExtractionMeta = (
        evidencePack?.meta?.article_extraction
        && typeof evidencePack.meta.article_extraction === 'object'
      )
        ? evidencePack.meta.article_extraction
        : {};
      const staticDomMeta = {
        mode: String(staticDomStats?.mode || '').trim(),
        accepted_field_candidates: Number(staticDomStats?.accepted_field_candidates || 0),
        rejected_field_candidates: Number(staticDomStats?.rejected_field_candidates || 0),
        parse_error_count: Number(staticDomStats?.parse_error_count || 0),
        rejected_field_candidates_audit_count: Number(staticDomAuditRejectedCount || 0)
      };
      const structuredMeta = {
        json_ld_count: Number(structuredStats?.json_ld_count || 0),
        microdata_count: Number(structuredStats?.microdata_count || 0),
        opengraph_count: Number(structuredStats?.opengraph_count || 0),
        structured_candidates: Number(structuredStats?.structured_candidates || 0),
        structured_rejected_candidates: Number(structuredStats?.structured_rejected_candidates || 0),
        error_count: Array.isArray(structuredErrors) ? structuredErrors.length : 0,
        snippet_rows: Array.isArray(structuredSnippetRows)
          ? structuredSnippetRows.slice(0, 40).map((row) => ({
            source_surface: String(row?.source_surface || row?.method || '').trim(),
            key_path: String(row?.key_path || '').trim(),
            value_preview: String(row?.value_preview || '').trim(),
            target_match_score: Number(row?.target_match_score || 0),
            target_match_passed: Boolean(row?.target_match_passed)
          }))
          : []
      };
      logger.info('source_processed', buildSourceProcessedPayload({
        source,
        sourceUrl,
        fetchDurationMs,
        parseDurationMs,
        pageData,
        sourceFetchOutcome,
        fetchContentType,
        pageContentHash,
        pageBytes,
        identity,
        anchorStatus,
        mergedFieldCandidatesWithEvidence,
        llmFieldCandidates,
        articleExtractionMeta,
        staticDomMeta,
        structuredMeta,
        pdfExtractionMeta,
        screenshotUri,
        domSnippetUri,
        hostBudgetAfterSource
      }));
    };

    const prepareNextPlannerSource = async () => {
      await loadRuntimeOverrides();
      applyRuntimeOverridesToPlanner(planner, runtimeOverrides);
      llmContext.forcedHighFields = runtimeOverrides.force_high_fields || [];
      if (runtimeOverrides.pause) {
        if (!runtimePauseAnnounced) {
          logger.info('runtime_pause_applied', {
            reason: 'runtime_override',
            control_key: runtimeControlKey
          });
          runtimePauseAnnounced = true;
        }
        await wait(1000);
        return { mode: 'skip' };
      }
      if (runtimePauseAnnounced) {
        logger.info('runtime_pause_resumed', {
          reason: 'runtime_override'
        });
        runtimePauseAnnounced = false;
      }

      const elapsedSeconds = (Date.now() - startMs) / 1000;
      if (elapsedSeconds >= config.maxRunSeconds) {
        logger.warn('max_run_seconds_reached', { maxRunSeconds: config.maxRunSeconds });
        return { mode: 'stop' };
      }

      const source = planner.next();
      if (!source) {
        return { mode: 'skip' };
      }
      const sourceHost = normalizeHostToken(source.host || hostFromHttpUrl(source.url || ''));
      const hostBudgetRow = ensureHostBudgetRow(hostBudgetByHost, sourceHost);
      attemptedSourceUrls.add(String(source.url || '').trim());
      return {
        mode: 'process',
        source,
        sourceHost,
        hostBudgetRow
      };
    };

    while (planner.hasNext()) {
      const preflight = await prepareNextPlannerSource();
      if (preflight.mode === 'stop') {
        break;
      }
      if (preflight.mode !== 'process') {
        continue;
      }
      const { source, sourceHost, hostBudgetRow } = preflight;
      if (shouldSkipSourceBeforeFetch({ source, sourceHost, hostBudgetRow })) {
        continue;
      }

      const sourceFetch = await fetchSourcePageData({
        source,
        sourceHost,
        hostBudgetRow
      });
      if (!sourceFetch.ok) {
        continue;
      }
      await processFetchedSource({
        source,
        hostBudgetRow,
        sourceFetch
      });

    }
  };

  try {
    await processPlannerQueue();

    const maxFollowupRounds = Math.max(0, Number(config.hypothesisAutoFollowupRounds || 0));
    const followupPerRound = Math.max(1, Number(config.hypothesisFollowupUrlsPerRound || 12));
    for (let round = 1; round <= maxFollowupRounds; round += 1) {
      const elapsedSeconds = (Date.now() - startMs) / 1000;
      if (elapsedSeconds >= config.maxRunSeconds) {
        logger.warn('max_run_seconds_reached', { maxRunSeconds: config.maxRunSeconds });
        break;
      }

      const provisional = buildProvisionalHypothesisQueue({
        sourceResults: sourceResults.filter((source) => !isHelperSyntheticSource(source)),
        categoryConfig,
        fieldOrder,
        anchors,
        identityLock: job.identityLock || {},
        productId,
        category,
        config,
        requiredFields,
        sourceIntelDomains: sourceIntel.data?.domains || {},
        brand: job.identityLock?.brand || ''
      });

      const consideredUrls = new Set(
        sourceResults
          .map((source) => source.finalUrl || source.url)
          .filter(Boolean)
      );
      const roundSeedUrls = [];
      for (const suggestion of nextBestUrlsFromHypotheses({
        hypothesisQueue: provisional.hypothesisQueue,
        limit: followupPerRound * 4
      })) {
        const url = String(suggestion.url || '').trim();
        if (!url || consideredUrls.has(url)) {
          continue;
        }
        consideredUrls.add(url);
        roundSeedUrls.push(url);
        if (roundSeedUrls.length >= followupPerRound) {
          break;
        }
      }

      if (!roundSeedUrls.length) {
        logger.info('hypothesis_followup_skipped', {
          round,
          reason: 'no_candidate_urls',
          missing_required_count: provisional.missingRequiredFields.length,
          critical_fields_remaining: provisional.criticalFieldsBelowPassTarget.length
        });
        break;
      }

      let enqueuedCount = 0;
      for (const url of roundSeedUrls) {
        if (planner.enqueue(url, `hypothesis_followup:${round}`)) {
          enqueuedCount += 1;
        }
      }

      if (!enqueuedCount) {
        logger.info('hypothesis_followup_skipped', {
          round,
          reason: 'queue_rejected_all',
          requested_urls: roundSeedUrls.length
        });
        break;
      }

      hypothesisFollowupRoundsExecuted += 1;
      hypothesisFollowupSeededUrls += enqueuedCount;
      logger.info('hypothesis_followup_round_started', {
        round,
        enqueued_urls: enqueuedCount,
        missing_required_count: provisional.missingRequiredFields.length,
        critical_fields_remaining: provisional.criticalFieldsBelowPassTarget.length
      });
      await processPlannerQueue();
    }
  } finally {
    await fetcher.stop();
  }

  const resumePendingUrls = normalizeHttpUrlList(
    [
      ...collectPlannerPendingUrls(planner),
      ...resumeCooldownSkippedUrls,
      ...resumeFetchFailedUrls,
      ...previousResumePendingUnseeded
    ],
    resumePersistLimit
  );
  const resumeLlmRetryRows = buildNextLlmRetryRows({
    previousRows: previousResumeRetryRows,
    newReasonByUrl: llmRetryReasonByUrl,
    attemptedUrls: attemptedSourceUrls,
    nowIso: new Date().toISOString(),
    limit: resumeRetryPersistLimit
  });
  const resumeSuccessRows = buildNextSuccessRows({
    previousRows: previousResumeSuccessRows,
    newSuccessByUrl: successfulSourceMetaByUrl,
    nowIso: new Date().toISOString(),
    limit: Math.max(80, toInt(config.indexingResumeSuccessPersistLimit, 240))
  });
  const resumeStatePayload = {
    category,
    productId,
    runId,
    updated_at: new Date().toISOString(),
    pending_urls: resumePendingUrls,
    llm_retry_urls: resumeLlmRetryRows,
    success_urls: resumeSuccessRows,
    stats: {
      seeded_pending_count: resumeSeededPendingCount,
      seeded_llm_retry_count: resumeSeededLlmRetryCount,
      seeded_reextract_count: resumeSeededReextractCount,
      persisted_pending_count: resumePendingUrls.length,
      persisted_llm_retry_count: resumeLlmRetryRows.length,
      persisted_success_count: resumeSuccessRows.length,
      cooldown_skipped_count: resumeCooldownSkippedUrls.size,
      fetch_failed_count: resumeFetchFailedUrls.size
    }
  };
  await storage.writeObject(
    indexingResumeKey,
    Buffer.from(`${JSON.stringify(resumeStatePayload, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  resumePersistedPendingCount = resumePendingUrls.length;
  resumePersistedLlmRetryCount = resumeLlmRetryRows.length;
  resumePersistedSuccessCount = resumeSuccessRows.length;
  logger.info('indexing_resume_written', {
    resume_key: indexingResumeKey,
    pending_urls: resumePersistedPendingCount,
    llm_retry_urls: resumePersistedLlmRetryCount,
    success_urls: resumePersistedSuccessCount
  });

  const dedicated = await adapterManager.runDedicatedAdapters({
    job,
    runId,
    storage
  });

  adapterArtifacts.push(...(dedicated.adapterArtifacts || []));

  const allSyntheticSources = [
    ...(dedicated.syntheticSources || []),
    ...helperSupportiveSyntheticSources
  ];
  for (const syntheticSource of allSyntheticSources) {
    const candidateMap = buildCandidateFieldMap(syntheticSource.fieldCandidates || []);
    const anchorCheck = evaluateAnchorConflicts(anchors, candidateMap);
    const identity = evaluateSourceIdentity(
      {
        ...syntheticSource,
        title: syntheticSource.title,
        identityCandidates: syntheticSource.identityCandidates,
        connectionHint: candidateMap.connection
      },
      job.identityLock || {}
    );

    const anchorStatus =
      anchorCheck.majorConflicts.length > 0
        ? 'failed_major_conflict'
        : anchorCheck.conflicts.length > 0
          ? 'minor_conflicts'
          : 'pass';

    sourceResults.push({
      ...syntheticSource,
      identity,
      anchorCheck,
      anchorStatus
    });
  }

  const identityGate = evaluateIdentityGate(sourceResults);
  const identityConfidence = identityGate.certainty;
  const identityReport = buildIdentityReport({
    productId,
    runId,
    sourceResults,
    identityGate
  });
  const extractedIdentity = bestIdentityFromSources(sourceResults, job.identityLock || {});
  const identity = buildIdentityObject(job, extractedIdentity, {
    allowDerivedVariant: Boolean(identityGate.validated)
  });

  const sourceSummary = buildSourceSummary(sourceResults);
  const allAnchorConflicts = mergeAnchorConflictLists(sourceResults.map((s) => s.anchorCheck));
  const anchorMajorConflictsCount = allAnchorConflicts.filter((item) => item.severity === 'MAJOR').length;

  const consensus = runConsensusEngine({
    sourceResults,
    categoryConfig,
    fieldOrder,
    anchors,
    identityLock: job.identityLock || {},
    productId,
    category,
    config,
    fieldRulesEngine: runtimeFieldRulesEngine
  });

  // Post-consensus: apply object-form selection_policy reducers (list → scalar)
  if (runtimeFieldRulesEngine) {
    const reduced = applySelectionPolicyReducers({
      fields: consensus.fields,
      candidates: consensus.candidates,
      fieldRulesEngine: runtimeFieldRulesEngine
    });
    Object.assign(consensus.fields, reduced.fields);
  }

  // Post-consensus: apply item_union list merge (set_union / ordered_union)
  if (runtimeFieldRulesEngine) {
    const unionResult = applyListUnionReducers({
      fields: consensus.fields,
      candidates: consensus.candidates,
      fieldRulesEngine: runtimeFieldRulesEngine
    });
    Object.assign(consensus.fields, unionResult.fields);
  }

  let normalized;
  let provenance;
  let candidates;
  let fieldsBelowPassTarget;
  let criticalFieldsBelowPassTarget;
  let newValuesProposed;
  const allowHelperProvisionalFill =
    indexingHelperFlowEnabled && helperSupportsProvisionalFill(helperContext, job.identityLock || {});

  if (!identityGate.validated || identityConfidence < 0.99) {
    normalized = buildAbortedNormalized({
      productId,
      runId,
      category,
      identity,
      sourceSummary,
      notes: [
        'MODEL_AMBIGUITY_ALERT',
        allowHelperProvisionalFill
          ? 'Identity certainty below 99%: helper-assisted provisional fields allowed.'
          : 'Identity certainty below 99%: spec fields withheld.'
      ],
      confidence: identityConfidence,
      completenessRequired: 0,
      coverageOverall: 0,
      fieldOrder
    });

    provenance = createEmptyProvenance(fieldOrder, normalized.fields);
    candidates = {};
    fieldsBelowPassTarget = fieldOrder.filter((field) => !PASS_TARGET_EXEMPT_FIELDS.has(field));
    criticalFieldsBelowPassTarget = [...categoryConfig.criticalFieldSet].filter((field) => fieldsBelowPassTarget.includes(field));
    newValuesProposed = [];
  } else {
    const fields = {
      ...consensus.fields,
      id: productId,
      brand: identity.brand,
      model: identity.model,
      base_model: identity.base_model,
      category,
      sku: identity.sku
    };

    normalized = buildValidatedNormalized({
      productId,
      runId,
      category,
      identity,
      fields,
      quality: {
        validated: false,
        confidence: 0,
        completeness_required: 0,
        coverage_overall: 0,
        notes: []
      },
      sourceSummary
    });

    provenance = consensus.provenance;
    candidates = consensus.candidates;
    fieldsBelowPassTarget = consensus.fieldsBelowPassTarget;
    criticalFieldsBelowPassTarget = consensus.criticalFieldsBelowPassTarget;
    newValuesProposed = consensus.newValuesProposed;
  }

  if (indexingHelperFlowEnabled && config.helperSupportiveFillMissing && (identityGate.validated || allowHelperProvisionalFill)) {
    const helperFill = applySupportiveFillToResult({
      helperContext,
      normalized,
      provenance,
      fieldsBelowPassTarget,
      criticalFieldsBelowPassTarget,
      categoryConfig
    });
    helperFilledFields = helperFill.filled_fields || [];
    helperFilledByMethod = helperFill.filled_by_method || {};
    helperMismatches = helperFill.mismatches || [];
    fieldsBelowPassTarget = helperFill.fields_below_pass_target || fieldsBelowPassTarget;
    criticalFieldsBelowPassTarget =
      helperFill.critical_fields_below_pass_target || criticalFieldsBelowPassTarget;
    logger.info('helper_supportive_fill_applied', {
      fields_filled: helperFilledFields.length,
      fields_filled_by_method: helperFilledByMethod,
      identity_gate_validated: identityGate.validated,
      provisional_mode: !identityGate.validated && allowHelperProvisionalFill
    });
  }

  if (identityGate.validated) {
    const componentLibrary = await loadComponentLibrary({ storage });
    const componentPrior = applyComponentLibraryPriors({
      normalized,
      provenance,
      library: componentLibrary,
      fieldOrder,
      logger
    });
    componentPriorFilledFields = componentPrior.filled_fields || [];
    componentPriorMatches = componentPrior.matched_components || [];
    if (componentPriorFilledFields.length > 0) {
      const belowSet = new Set(fieldsBelowPassTarget || []);
      const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
      for (const field of componentPriorFilledFields) {
        belowSet.delete(field);
        criticalSet.delete(field);
      }
      fieldsBelowPassTarget = [...belowSet];
      criticalFieldsBelowPassTarget = [...criticalSet];
    }
  }

  criticDecisions = runDeterministicCritic({
    normalized,
    provenance,
    fieldReasoning: {},
    categoryConfig,
    constraints: learnedConstraints
  });
  if ((criticDecisions.reject || []).length > 0) {
    const belowSet = new Set(fieldsBelowPassTarget || []);
    const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
    for (const row of criticDecisions.reject || []) {
      if (!row?.field) {
        continue;
      }
      belowSet.add(row.field);
      if (categoryConfig.criticalFieldSet.has(row.field)) {
        criticalSet.add(row.field);
      }
    }
    fieldsBelowPassTarget = [...belowSet];
    criticalFieldsBelowPassTarget = [...criticalSet];
  }

  const uncertainFieldsForValidator = normalizeFieldList([
    ...(fieldsBelowPassTarget || []),
    ...(criticalFieldsBelowPassTarget || []),
    ...((criticDecisions.reject || []).map((row) => row.field).filter(Boolean))
  ], {
    fieldOrder
  });
  const shouldRunLlmValidator =
    Boolean(config.llmEnabled && config.llmApiKey) &&
    uncertainFieldsForValidator.length > 0 &&
    (
      (criticDecisions.reject || []).length > 0 ||
      (criticalFieldsBelowPassTarget || []).length > 0 ||
      identityConfidence < 0.995
    );
  if (shouldRunLlmValidator) {
    llmValidatorDecisions = await validateCandidatesLLM({
      job,
      normalized,
      provenance,
      categoryConfig,
      constraints: learnedConstraints,
      uncertainFields: uncertainFieldsForValidator,
      config,
      logger,
      llmContext
    });
    if ((llmValidatorDecisions.accept || []).length > 0) {
      const belowSet = new Set(fieldsBelowPassTarget || []);
      const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
      for (const row of llmValidatorDecisions.accept || []) {
        if (!row?.field || !hasKnownFieldValue(row.value)) {
          continue;
        }
        normalized.fields[row.field] = row.value;
        const bucket = ensureProvenanceField(provenance, row.field, row.value);
        bucket.value = row.value;
        bucket.confirmations = Math.max(1, Number.parseInt(String(bucket.confirmations || 0), 10) || 0);
        bucket.approved_confirmations = Math.max(1, Number.parseInt(String(bucket.approved_confirmations || 0), 10) || 0);
        bucket.pass_target = Math.max(1, Number.parseInt(String(bucket.pass_target || 1), 10) || 1);
        bucket.meets_pass_target = true;
        bucket.confidence = Math.max(Number(bucket.confidence || 0), Number(row.confidence || 0.8));
        bucket.evidence = [
          ...(Array.isArray(bucket.evidence) ? bucket.evidence : []),
          {
            url: 'llm://validator',
            host: 'llm.local',
            rootDomain: 'llm.local',
            tier: 2,
            tierName: 'database',
            method: 'llm_validate',
            keyPath: `llm.validate.${row.field}`,
            approvedDomain: false,
            reason: row.reason
          }
        ];
        belowSet.delete(row.field);
        criticalSet.delete(row.field);
      }
      fieldsBelowPassTarget = [...belowSet];
      criticalFieldsBelowPassTarget = [...criticalSet];
    }
    if ((llmValidatorDecisions.reject || []).length > 0) {
      const belowSet = new Set(fieldsBelowPassTarget || []);
      const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
      for (const row of llmValidatorDecisions.reject || []) {
        if (!row?.field) {
          continue;
        }
        belowSet.add(row.field);
        if (categoryConfig.criticalFieldSet.has(row.field)) {
          criticalSet.add(row.field);
        }
      }
      fieldsBelowPassTarget = [...belowSet];
      criticalFieldsBelowPassTarget = [...criticalSet];
    }
  }

  const temporalEvidence = aggregateTemporalSignals(sourceResults, 40);
  const inferenceResult = applyInferencePolicies({
    categoryConfig,
    normalized,
    provenance,
    summaryHint: {
      temporal_evidence: temporalEvidence
    },
    sourceResults,
    logger
  });
  if ((inferenceResult.filled_fields || []).length > 0) {
    const belowSet = new Set(fieldsBelowPassTarget || []);
    const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
    for (const field of inferenceResult.filled_fields) {
      belowSet.delete(field);
      criticalSet.delete(field);
    }
    fieldsBelowPassTarget = [...belowSet];
    criticalFieldsBelowPassTarget = [...criticalSet];
  }

  let aggressiveExtraction = {
    enabled: false,
    stage: 'disabled'
  };
  let runtimeEvidencePack = selectAggressiveEvidencePack(sourceResults) || null;
  if (config.aggressiveModeEnabled || ['aggressive', 'uber_aggressive'].includes(String(roundContext?.mode || '').toLowerCase())) {
    try {
      const bestEvidencePack = runtimeEvidencePack;
      const aggressiveDomHtml = selectAggressiveDomHtml(artifactsByHost);
      const aggressiveEvidencePack = bestEvidencePack
        ? {
          ...bestEvidencePack,
          meta: {
            ...(bestEvidencePack.meta || {}),
            raw_html: aggressiveDomHtml || bestEvidencePack?.meta?.raw_html || ''
          }
        }
        : {
          meta: {
            raw_html: aggressiveDomHtml || '',
            host: 'dom'
          },
          references: [],
          snippets: []
        };
      const aggressiveOrchestrator = new AggressiveOrchestrator({
        storage,
        config,
        logger
      });
      aggressiveExtraction = await aggressiveOrchestrator.run({
        category,
        productId,
        identity,
        normalized,
        provenance,
        evidencePack: aggressiveEvidencePack,
        fieldOrder,
        criticalFieldSet: categoryConfig.criticalFieldSet,
        fieldsBelowPassTarget,
        criticalFieldsBelowPassTarget,
        discoveryResult,
        sourceResults,
        roundContext
      });
      if (aggressiveExtraction?.enabled) {
        const refreshed = refreshFieldsBelowPassTarget({
          fieldOrder,
          provenance,
          criticalFieldSet: categoryConfig.criticalFieldSet
        });
        fieldsBelowPassTarget = refreshed.fieldsBelowPassTarget;
        criticalFieldsBelowPassTarget = refreshed.criticalFieldsBelowPassTarget;
      }
    } catch (error) {
      logger.warn('aggressive_extraction_failed', {
        category,
        productId,
        runId,
        message: error.message
      });
      aggressiveExtraction = {
        enabled: true,
        stage: 'failed',
        error: error.message
      };
    }
  }

  const componentReviewQueue = [];
  const identityObservations = [];
  const runtimeGateResult = applyRuntimeFieldRules({
    engine: runtimeFieldRulesEngine,
    fields: normalized.fields,
    provenance,
    fieldOrder,
    enforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    strictEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    evidencePack: runtimeEvidencePack,
    extractedValues: normalized.fields,
    componentReviewQueue,
    identityObservations,
  });
  normalized.fields = runtimeGateResult.fields;
  if ((runtimeGateResult.failures || []).length > 0) {
    const belowSet = new Set(fieldsBelowPassTarget || []);
    const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
    for (const failure of runtimeGateResult.failures) {
      if (!failure?.field) {
        continue;
      }
      belowSet.add(failure.field);
      if (categoryConfig.criticalFieldSet.has(failure.field)) {
        criticalSet.add(failure.field);
      }

      const bucket = ensureProvenanceField(provenance, failure.field, 'unk');
      bucket.value = 'unk';
      bucket.meets_pass_target = false;
      bucket.confidence = Math.min(Number(bucket.confidence || 0), 0.2);
      bucket.evidence = [
        ...(Array.isArray(bucket.evidence) ? bucket.evidence : []),
        {
          url: 'engine://field-rules',
          host: 'engine.local',
          rootDomain: 'engine.local',
          tier: 1,
          tierName: 'manufacturer',
          method: 'field_rules_engine',
          keyPath: `engine.${failure.field}`,
          approvedDomain: true,
          reason: failure.reason_code || 'normalize_failed'
        }
      ];
    }
    fieldsBelowPassTarget = [...belowSet];
    criticalFieldsBelowPassTarget = [...criticalSet];
  }
  let curationSuggestionResult = null;
  const allSuggestions = runtimeGateResult.curation_suggestions || [];
  const enumSuggestions = allSuggestions.filter(s => s.suggestion_type !== 'new_component');
  const componentSuggestions = allSuggestions.filter(s => s.suggestion_type === 'new_component');
  if (enumSuggestions.length > 0) {
    try {
      curationSuggestionResult = await appendEnumCurationSuggestions({
        config,
        category,
        productId,
        runId,
        suggestions: enumSuggestions
      });
      logger.info('runtime_curation_suggestions_persisted', {
        category,
        productId,
        runId,
        appended_count: curationSuggestionResult.appended_count,
        total_count: curationSuggestionResult.total_count
      });
    } catch (error) {
      logger.warn('runtime_curation_suggestions_failed', {
        category,
        productId,
        runId,
        message: error.message
      });
    }
  }
  if (componentSuggestions.length > 0) {
    try {
      const compResult = await appendComponentCurationSuggestions({
        config,
        category,
        productId,
        runId,
        suggestions: componentSuggestions
      });
      logger.info('runtime_component_suggestions_persisted', {
        category,
        productId,
        runId,
        appended_count: compResult.appended_count,
        total_count: compResult.total_count
      });
    } catch (error) {
      logger.warn('runtime_component_suggestions_failed', {
        category,
        productId,
        runId,
        message: error.message
      });
    }
  }

  // Persist component review items (flagged for AI review)
  // componentReviewQueue was passed to applyRuntimeFieldRules and populated in-place
  if (componentReviewQueue.length > 0) {
    try {
      const reviewResult = await appendComponentReviewItems({
        config,
        category,
        productId,
        runId,
        items: componentReviewQueue
      });
      logger.info('component_review_items_persisted', {
        category,
        productId,
        runId,
        appended_count: reviewResult.appended_count,
        total_count: reviewResult.total_count
      });
    } catch (error) {
      logger.warn('component_review_items_failed', {
        category,
        productId,
        runId,
        message: error.message
      });
    }
  }

  // Persist identity observations (successful matches)
  // identityObservations was passed to applyRuntimeFieldRules and populated in-place
  if (identityObservations.length > 0) {
    try {
      const obsResult = await appendComponentIdentityObservations({
        config,
        category,
        productId,
        runId,
        observations: identityObservations
      });
      logger.info('component_identity_observations_persisted', {
        category,
        productId,
        runId,
        appended_count: obsResult.appended_count,
        total_count: obsResult.total_count
      });
    } catch (error) {
      logger.warn('component_identity_observations_failed', {
        category,
        productId,
        runId,
        message: error.message
      });
    }
  }

  const completenessStats = computeCompletenessRequired(normalized, requiredFields);
  const coverageStats = computeCoverageOverall({
    fields: normalized.fields,
    fieldOrder,
    editorialFields: categoryConfig.schema.editorial_fields
  });

  const confidence = computeConfidence({
    identityConfidence,
    provenance,
    anchorConflictsCount: allAnchorConflicts.length,
    agreementScore: consensus.agreementScore || 0
  });

  const gate = evaluateValidationGate({
    identityGateValidated: identityGate.validated,
    identityConfidence,
    anchorMajorConflictsCount,
    completenessRequired: completenessStats.completenessRequired,
    targetCompleteness: targets.targetCompleteness,
    confidence,
    targetConfidence: targets.targetConfidence,
    criticalFieldsBelowPassTarget
  });

  gate.coverageOverallPercent = Number.parseFloat((coverageStats.coverageOverall * 100).toFixed(2));
  const publishable =
    gate.validated &&
    identityGate.validated &&
    identityConfidence >= 0.99 &&
    !identityGate.needsReview;
  const publishBlockers = [...new Set([
    ...(gate.validated ? [] : (gate.reasons || [])),
    ...(identityGate.reasonCodes || [])
  ])].filter(Boolean);
  if (!publishable && publishBlockers.length === 0) {
    publishBlockers.push(gate.validatedReason || 'MODEL_AMBIGUITY_ALERT');
  }

  normalized.quality.completeness_required = completenessStats.completenessRequired;
  normalized.quality.coverage_overall = coverageStats.coverageOverall;
  normalized.quality.confidence = confidence;
  normalized.quality.validated = gate.validated;
  normalized.quality.notes = gate.reasons;

  const durationMs = Date.now() - startMs;
  const validatedReason = gate.validatedReason;
  const manufacturerSources = sourceResults.filter((source) => source.role === 'manufacturer');
  const manufacturerMajorConflicts = manufacturerSources.reduce(
    (count, source) => count + ((source.anchorCheck?.majorConflicts || []).length > 0 ? 1 : 0),
    0
  );
  const endpointMining = aggregateEndpointSignals(sourceResults, 80);
  const constraintAnalysis = evaluateConstraintGraph({
    fields: normalized.fields,
    provenance,
    criticalFieldSet: categoryConfig.criticalFieldSet
  });
  const hypothesisSourceResults = sourceResults.filter((source) => !isHelperSyntheticSource(source));
  const hypothesisQueue = buildHypothesisQueue({
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields,
    provenance,
    sourceResults: hypothesisSourceResults,
    sourceIntelDomains: sourceIntel.data?.domains || {},
    brand: job.identityLock?.brand || identity.brand || '',
    criticalFieldSet: categoryConfig.criticalFieldSet,
    maxItems: Math.max(1, Number(config.maxHypothesisItems || 50))
  });
  const llmBudgetSnapshot = llmBudgetGuard.snapshot();
  llmBudgetBlockedReason = llmBudgetSnapshot.state.blockedReason || '';
  const fieldReasoning = buildFieldReasoning({
    fieldOrder,
    provenance,
    fieldsBelowPassTarget,
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields,
    constraintAnalysis,
    identityGateValidated: identityGate.validated,
    llmBudgetBlockedReason,
    sourceResults: hypothesisSourceResults,
    fieldAvailabilityModel: learnedFieldAvailability,
    fieldYieldArtifact: learnedFieldYield,
    searchAttemptCount: (discoveryResult.search_attempts || []).length
  });
  trafficLight = buildTrafficLight({
    fieldOrder,
    provenance,
    fieldReasoning
  });
  const needSetIdentityState = deriveNeedSetIdentityState({
    identityGate,
    identityConfidence
  });
  const extractionGateOpen = resolveExtractionGateOpen({
    identityLock: job.identityLock || {},
    identityGate
  });
  const needSetIdentityAuditRows = buildNeedSetIdentityAuditRows(identityReport, 24);
  const needSetIdentityContext = {
    status: needSetIdentityState,
    confidence: identityConfidence,
    identity_gate_validated: identityGate.validated,
    extraction_gate_open: extractionGateOpen,
    family_model_count: Number(identityLock.family_model_count || 0),
    ambiguity_level: normalizeAmbiguityLevel(identityLock.ambiguity_level || ''),
    publishable,
    publish_blockers: publishBlockers,
    reason_codes: identityReport.reason_codes || identityGate.reasonCodes || [],
    page_count: identityReport.pages?.length || 0,
    max_match_score: Math.max(
      0,
      ...sourceResults.map((source) => Number(source?.identity?.score || 0)).filter((value) => Number.isFinite(value))
    ),
    audit_rows: needSetIdentityAuditRows
  };
  const needSet = computeNeedSet({
    runId,
    category,
    productId,
    fieldOrder,
    provenance,
    fieldRules: categoryConfig.fieldRules,
    fieldReasoning,
    constraintAnalysis,
    identityContext: needSetIdentityContext
  });
  const phase07PrimeSources = buildPhase07PrimeSources({
    runId,
    category,
    productId,
    needSet,
    provenance,
    sourceResults,
    fieldRules: categoryConfig.fieldRules || {},
    identity: {
      brand: job.identityLock?.brand || identity.brand || '',
      model: job.identityLock?.model || identity.model || '',
      variant: job.identityLock?.variant || identity.variant || '',
      sku: job.identityLock?.sku || identity.sku || ''
    },
    options: {
      maxHitsPerField: 24,
      maxPrimeSourcesPerField: 8
    }
  });
  const phase08SummaryFromBatches = buildPhase08SummaryFromBatches(phase08BatchRows);
  const phase08Extraction = {
    run_id: runId,
    category,
    product_id: productId,
    generated_at: new Date().toISOString(),
    summary: phase08SummaryFromBatches,
    batches: phase08BatchRows.slice(0, 500),
    field_contexts: phase08FieldContexts,
    prime_sources: {
      rows: phase08PrimeRows.slice(0, 500)
    },
    validator: {
      context_field_count: Number(llmValidatorDecisions?.phase08?.context_field_count || 0),
      prime_source_rows: Number(llmValidatorDecisions?.phase08?.prime_source_rows || 0),
      payload_chars: Number(llmValidatorDecisions?.phase08?.payload_chars || 0)
    }
  };

  const parserHealthRows = sourceResults
    .map((source) => source.parserHealth)
    .filter(Boolean);
  const parserHealthAverage = parserHealthRows.length
    ? parserHealthRows.reduce((sum, row) => sum + (row.health_score || 0), 0) / parserHealthRows.length
    : 0;
  const fingerprintCount = new Set(
    sourceResults
      .map((source) => source.fingerprint?.id)
      .filter(Boolean)
  ).size;
  const contribution = collectContributionFields({
    fieldOrder,
    normalized,
    provenance
  });

  let cortexSidecar = {
    enabled: Boolean(config.cortexEnabled),
    attempted: false,
    mode: 'disabled',
    fallback_to_non_sidecar: true,
    fallback_reason: 'sidecar_disabled',
    deep_task_count: 0
  };
  if (config.cortexEnabled) {
    const cortexTasks = [
      {
        id: 'evidence-audit',
        type: 'evidence_audit',
        critical: true,
        payload: {
          critical_fields_below_pass_target: criticalFieldsBelowPassTarget
        }
      },
      {
        id: 'conflict-triage',
        type: 'conflict_resolution',
        critical: true,
        payload: {
          anchor_major_conflicts_count: anchorMajorConflictsCount,
          contradiction_count: constraintAnalysis?.contradictionCount || 0
        }
      },
      {
        id: 'critical-gap-fill',
        type: 'critical_gap_fill',
        critical: true,
        payload: {
          missing_required_fields: completenessStats.missingRequiredFields
        }
      }
    ];
    try {
      const client = new CortexClient({ config });
      const cortexResult = await client.runPass({
        tasks: cortexTasks,
        context: {
          confidence,
          critical_conflicts_remain:
            anchorMajorConflictsCount > 0 || (constraintAnalysis?.contradictionCount || 0) > 0,
          critical_gaps_remain: criticalFieldsBelowPassTarget.length > 0,
          evidence_audit_failed_on_critical: false
        }
      });
      cortexSidecar = {
        enabled: true,
        attempted: true,
        mode: cortexResult.mode,
        fallback_to_non_sidecar: Boolean(cortexResult.fallback_to_non_sidecar),
        fallback_reason: cortexResult.fallback_reason || null,
        deep_task_count: Number(cortexResult?.plan?.deep_task_count || 0)
      };
    } catch (error) {
      logger.warn('cortex_sidecar_failed', {
        message: error.message
      });
      cortexSidecar = {
        enabled: true,
        attempted: true,
        mode: 'fallback',
        fallback_to_non_sidecar: true,
        fallback_reason: 'sidecar_execution_error',
        deep_task_count: 0
      };
    }
  }

  const summary = {
    productId,
    runId,
    category,
    run_profile: config.runProfile || 'standard',
    runtime_mode: runtimeMode,
    identity_fingerprint: identityFingerprint,
    identity_lock_status: identityLockStatus,
    dedupe_mode: RUN_DEDUPE_MODE,
    phase_cursor: 'completed',
    validated: gate.validated,
    reason: validatedReason,
    validated_reason: validatedReason,
    validation_reasons: gate.reasons,
    confidence,
    confidence_percent: gate.confidencePercent,
    completeness_required: completenessStats.completenessRequired,
    completeness_required_percent: gate.completenessRequiredPercent,
    coverage_overall: coverageStats.coverageOverall,
    coverage_overall_percent: gate.coverageOverallPercent,
    target_completeness: targets.targetCompleteness,
    target_confidence: targets.targetConfidence,
    required_fields: completenessStats.requiredFields,
    missing_required_fields: completenessStats.missingRequiredFields,
    anchor_fields_present: Boolean(
      Object.values(anchors).find((value) => String(value || '').trim() !== '')
    ),
    anchor_conflicts: allAnchorConflicts,
    anchor_major_conflicts_count: anchorMajorConflictsCount,
    identity_confidence: identityConfidence,
    identity_gate_validated: identityGate.validated,
    extraction_gate_open: extractionGateOpen,
    identity_ambiguity: {
      family_model_count: Number(identityLock.family_model_count || 0),
      ambiguity_level: normalizeAmbiguityLevel(identityLock.ambiguity_level || '')
    },
    identity_gate: identityGate,
    publishable,
    publish_blockers: publishBlockers,
    identity_report: {
      status: identityReport.status,
      needs_review: identityReport.needs_review,
      reason_codes: identityReport.reason_codes || [],
      page_count: identityReport.pages.length
    },
    fields_below_pass_target: fieldsBelowPassTarget,
    critical_fields_below_pass_target: criticalFieldsBelowPassTarget,
    new_values_proposed: newValuesProposed,
    sources_attempted: sourceResults.length,
    sources_identity_matched: sourceResults.filter((s) => s.identity.match).length,
    discovery: {
      enabled: discoveryResult.enabled,
      fetch_candidate_sources: Boolean(config.fetchCandidateSources),
      discovery_key: discoveryResult.discoveryKey,
      candidates_key: discoveryResult.candidatesKey,
      candidate_count: discoveryResult.candidates.length,
      search_profile_key: discoveryResult.search_profile_key || null,
      search_profile_run_key: discoveryResult.search_profile_run_key || null,
      search_profile_latest_key: discoveryResult.search_profile_latest_key || null
    },
    searches_attempted: discoveryResult.search_attempts || [],
    urls_fetched: [...new Set(
      sourceResults
        .filter((source) => !isHelperSyntheticSource(source))
        .map((source) => source.finalUrl || source.url)
        .filter(Boolean)
    )],
    helper_files: {
      enabled: indexingHelperFlowEnabled,
      global_helper_files_enabled: Boolean(config.helperFilesEnabled),
      indexing_helper_files_enabled: Boolean(config.indexingHelperFilesEnabled),
      root: config.helperFilesRoot || 'helper_files',
      active_filtering_match: Boolean(helperContext.active_match),
      active_filtering_source: helperContext.active_match?.source || null,
      active_filtering_record_id: helperContext.active_match?.record_id ?? null,
      seed_urls_from_active_count: (helperContext.seed_urls || []).length,
      seed_urls_from_active: (helperContext.seed_urls || []).slice(0, 25),
      active_total_rows: helperContext.stats?.active_total || 0,
      supportive_total_rows: helperContext.stats?.supportive_total || 0,
      supportive_file_count: helperContext.stats?.supportive_file_count || 0,
      supportive_match_count: helperContext.stats?.supportive_matched_count || 0,
      supportive_synthetic_sources_used: helperSupportiveSyntheticSources.length,
      supportive_fill_missing_enabled: Boolean(indexingHelperFlowEnabled && config.helperSupportiveFillMissing),
      supportive_fields_filled_count: helperFilledFields.length,
      supportive_fields_filled: helperFilledFields,
      supportive_fields_filled_by_method: helperFilledByMethod,
      supportive_mismatch_count: helperMismatches.length,
      supportive_mismatches: helperMismatches.slice(0, 50)
    },
    components: {
      prior_fields_filled_count: componentPriorFilledFields.length,
      prior_fields_filled: componentPriorFilledFields,
      matched_components: componentPriorMatches
    },
    critic: {
      accept_count: (criticDecisions.accept || []).length,
      reject_count: (criticDecisions.reject || []).length,
      unknown_count: (criticDecisions.unknown || []).length,
      decisions: criticDecisions,
      llm_validator: {
        enabled: Boolean(llmValidatorDecisions.enabled),
        accept_count: (llmValidatorDecisions.accept || []).length,
        reject_count: (llmValidatorDecisions.reject || []).length,
        unknown_count: (llmValidatorDecisions.unknown || []).length,
        decisions: llmValidatorDecisions
      }
    },
    runtime_engine: {
      enabled: Boolean(runtimeFieldRulesEngine),
      enforce_evidence: Boolean(config.fieldRulesEngineEnforceEvidence),
      failure_count: (runtimeGateResult.failures || []).length,
      warning_count: (runtimeGateResult.warnings || []).length,
      change_count: (runtimeGateResult.changes || []).length,
      curation_suggestions_count: (runtimeGateResult.curation_suggestions || []).length,
      curation_suggestions_appended_count: curationSuggestionResult?.appended_count || 0,
      curation_suggestions_total_count: curationSuggestionResult?.total_count || 0,
      curation_suggestions_path: curationSuggestionResult?.path || null,
      failures: runtimeGateResult.failures || [],
      warnings: runtimeGateResult.warnings || []
    },
    llm: {
      enabled: Boolean(config.llmEnabled && config.llmApiKey),
      provider: config.llmProvider || 'openai',
      model_extract: config.llmEnabled ? config.llmModelExtract : null,
      model_plan: config.llmEnabled ? config.llmModelPlan : null,
      model_validate: config.llmEnabled ? config.llmModelValidate : null,
      target_field_count: llmTargetFields.length,
      target_fields: llmTargetFields.slice(0, 80),
      golden_examples_count: goldenExamples.length,
      candidates_added: llmCandidatesAccepted,
      sources_with_llm_candidates: llmSourcesUsed,
      fields_filled_by_llm_count: contribution.llmFields.length,
      fields_filled_by_llm: contribution.llmFields,
      fields_filled_by_component_db_count: contribution.componentFields.length,
      fields_filled_by_component_db: contribution.componentFields,
      retry_without_schema_count: llmRetryWithoutSchemaCount,
      estimated_usage_count: llmEstimatedUsageCount,
      verify_mode_enabled: Boolean(config.llmVerifyMode),
      verify_trigger: llmContext.verification?.trigger || 'disabled',
      verify_performed: Boolean(llmContext.verification?.done),
      verify_report_key: llmContext.verification?.report_key || null,
      call_count_run: llmCallCount,
      cost_usd_run: Number.parseFloat((llmCostUsd || 0).toFixed(8)),
      budget: {
        monthly_budget_usd: llmBudgetSnapshot.limits.monthlyBudgetUsd,
        monthly_spent_usd_after_run: llmBudgetSnapshot.state.monthlySpentUsd,
        per_product_budget_usd: llmBudgetSnapshot.limits.productBudgetUsd,
        per_product_spent_usd_after_run: llmBudgetSnapshot.state.productSpentUsd,
        max_calls_per_product_total: llmBudgetSnapshot.limits.maxCallsPerProductTotal,
        calls_per_product_total_after_run: llmBudgetSnapshot.state.productCallsTotal,
        max_calls_per_round: llmBudgetSnapshot.limits.maxCallsPerRound,
        calls_used_current_round: llmBudgetSnapshot.state.roundCalls,
        blocked_reason: llmBudgetBlockedReason || null
      }
    },
    cortex_sidecar: cortexSidecar,
    aggressive_extraction: aggressiveExtraction,
    source_registry: {
      override_key: categoryConfig.sources_override_key || null
    },
    crawl_profile: {
      fetcher_mode: fetcherMode,
      fetcher_fallback_reason: fetcherStartFallbackReason || null,
      max_run_seconds: config.maxRunSeconds,
      max_urls_per_product: config.maxUrlsPerProduct,
      max_manufacturer_urls_per_product: config.maxManufacturerUrlsPerProduct,
      max_pages_per_domain: config.maxPagesPerDomain,
      max_manufacturer_pages_per_domain: config.maxManufacturerPagesPerDomain,
      endpoint_signal_limit: config.endpointSignalLimit,
      endpoint_suggestion_limit: config.endpointSuggestionLimit,
      endpoint_network_scan_limit: config.endpointNetworkScanLimit
    },
    indexing_resume: {
      key: indexingResumeKey,
      mode: resumeMode,
      max_age_hours: resumeMaxAgeHours,
      state_age_hours: Number.isFinite(previousResumeStateAgeHours)
        ? Number(previousResumeStateAgeHours.toFixed(2))
        : null,
      reextract_enabled: resumeReextractEnabled,
      reextract_after_hours: resumeReextractAfterHours,
      seeded_pending_count: resumeSeededPendingCount,
      seeded_llm_retry_count: resumeSeededLlmRetryCount,
      seeded_reextract_count: resumeSeededReextractCount,
      persisted_pending_count: resumePersistedPendingCount,
      persisted_llm_retry_count: resumePersistedLlmRetryCount,
      persisted_success_count: resumePersistedSuccessCount
    },
    manufacturer_research: {
      attempted_sources: manufacturerSources.length,
      identity_matched_sources: manufacturerSources.filter((source) => source.identity?.match).length,
      major_anchor_conflict_sources: manufacturerMajorConflicts,
      planner: planner.getStats()
    },
    endpoint_mining: endpointMining,
    temporal_evidence: temporalEvidence,
    inference: inferenceResult,
    hypothesis_queue: hypothesisQueue,
    hypothesis_followup: {
      configured_rounds: Math.max(0, Number(config.hypothesisAutoFollowupRounds || 0)),
      urls_per_round: Math.max(1, Number(config.hypothesisFollowupUrlsPerRound || 12)),
      rounds_executed: hypothesisFollowupRoundsExecuted,
      seeded_urls: hypothesisFollowupSeededUrls
    },
    constraint_analysis: constraintAnalysis,
    field_reasoning: fieldReasoning,
    traffic_light: trafficLight,
    needset: {
      size: needSet.needset_size,
      total_fields: needSet.total_fields,
      reason_counts: needSet.reason_counts,
      required_level_counts: needSet.required_level_counts,
      identity_lock_state: needSet.identity_lock_state || null,
      identity_audit_rows_count: Array.isArray(needSet.identity_audit_rows)
        ? needSet.identity_audit_rows.length
        : 0,
      top_fields: (needSet.needs || []).slice(0, 12).map((row) => row.field_key),
      generated_at: needSet.generated_at
    },
    phase07: {
      fields_attempted: Number(phase07PrimeSources?.summary?.fields_attempted || 0),
      fields_with_hits: Number(phase07PrimeSources?.summary?.fields_with_hits || 0),
      fields_satisfied_min_refs: Number(phase07PrimeSources?.summary?.fields_satisfied_min_refs || 0),
      fields_unsatisfied_min_refs: Number(phase07PrimeSources?.summary?.fields_unsatisfied_min_refs || 0),
      refs_selected_total: Number(phase07PrimeSources?.summary?.refs_selected_total || 0),
      distinct_sources_selected: Number(phase07PrimeSources?.summary?.distinct_sources_selected || 0),
      avg_hits_per_field: Number(phase07PrimeSources?.summary?.avg_hits_per_field || 0),
      generated_at: String(phase07PrimeSources?.generated_at || '').trim() || null
    },
    phase08: {
      batch_count: Number(phase08Extraction?.summary?.batch_count || 0),
      batch_error_count: Number(phase08Extraction?.summary?.batch_error_count || 0),
      schema_fail_rate: Number(phase08Extraction?.summary?.schema_fail_rate || 0),
      raw_candidate_count: Number(phase08Extraction?.summary?.raw_candidate_count || 0),
      accepted_candidate_count: Number(phase08Extraction?.summary?.accepted_candidate_count || 0),
      dangling_snippet_ref_count: Number(phase08Extraction?.summary?.dangling_snippet_ref_count || 0),
      dangling_snippet_ref_rate: Number(phase08Extraction?.summary?.dangling_snippet_ref_rate || 0),
      evidence_policy_violation_count: Number(phase08Extraction?.summary?.evidence_policy_violation_count || 0),
      evidence_policy_violation_rate: Number(phase08Extraction?.summary?.evidence_policy_violation_rate || 0),
      min_refs_satisfied_count: Number(phase08Extraction?.summary?.min_refs_satisfied_count || 0),
      min_refs_total: Number(phase08Extraction?.summary?.min_refs_total || 0),
      min_refs_satisfied_rate: Number(phase08Extraction?.summary?.min_refs_satisfied_rate || 0),
      validator_context_field_count: Number(phase08Extraction?.validator?.context_field_count || 0),
      validator_prime_source_rows: Number(phase08Extraction?.validator?.prime_source_rows || 0),
      generated_at: String(phase08Extraction?.generated_at || '').trim() || null
    },
    top_evidence_references: buildTopEvidenceReferences(provenance, 100),
    parser_health: {
      source_count: parserHealthRows.length,
      average_health_score: Number.parseFloat(parserHealthAverage.toFixed(6)),
      fingerprints_seen: fingerprintCount
    },
    duration_ms: durationMs,
    round_context: roundContext || null,
    generated_at: new Date().toISOString()
  };

  if (uberAggressiveMode || frontierDb) {
    const researchBase = storage.resolveOutputKey(category, productId, 'runs', runId, 'research');
    const searchPlanPayload = discoveryResult?.uber_search_plan || null;
    const searchJournalRows = Array.isArray(discoveryResult?.search_journal) ? discoveryResult.search_journal : [];
    const frontierSnapshot = frontierDb?.frontierSnapshot?.({ limit: 200 }) || null;
    const previousFields = previousFinalSpec?.fields && typeof previousFinalSpec.fields === 'object'
      ? previousFinalSpec.fields
      : (previousFinalSpec || {});
    const coverageDelta = uberOrchestrator?.buildCoverageDelta?.({
      previousSpec: previousFields,
      currentSpec: normalized?.fields || {},
      fieldOrder
    }) || {
      previous_known_count: 0,
      current_known_count: 0,
      delta_known: 0,
      gained_fields: [],
      lost_fields: []
    };

    const searchPlanKey = `${researchBase}/search_plan.json`;
    const searchJournalKey = `${researchBase}/search_journal.jsonl`;
    const frontierSnapshotKey = `${researchBase}/frontier_snapshot.json`;
    const coverageDeltaKey = `${researchBase}/coverage_delta.json`;
    await storage.writeObject(
      searchPlanKey,
      Buffer.from(`${JSON.stringify(searchPlanPayload || {
        source: 'none',
        queries: discoveryResult?.queries || []
      }, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    await storage.writeObject(
      searchJournalKey,
      Buffer.from(
        `${searchJournalRows.map((row) => JSON.stringify(row)).join('\n')}${searchJournalRows.length ? '\n' : ''}`,
        'utf8'
      ),
      { contentType: 'application/x-ndjson' }
    );
    await storage.writeObject(
      frontierSnapshotKey,
      Buffer.from(`${JSON.stringify(frontierSnapshot || {}, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );
    await storage.writeObject(
      coverageDeltaKey,
      Buffer.from(`${JSON.stringify(coverageDelta, null, 2)}\n`, 'utf8'),
      { contentType: 'application/json' }
    );

    summary.research = {
      ...(summary.research || {}),
      mode: runtimeMode,
      search_plan_key: searchPlanKey,
      search_journal_key: searchJournalKey,
      frontier_snapshot_key: frontierSnapshotKey,
      coverage_delta_key: coverageDeltaKey
    };
  }

  const runBase = runArtifactsBase;
  const latestBase = storage.resolveOutputKey(category, productId, 'latest');
  const needSetRunKey = `${runBase}/analysis/needset.json`;
  const needSetLatestKey = `${latestBase}/needset.json`;
  const phase07RunKey = `${runBase}/analysis/phase07_retrieval.json`;
  const phase07LatestKey = `${latestBase}/phase07_retrieval.json`;
  const phase08RunKey = `${runBase}/analysis/phase08_extraction.json`;
  const phase08LatestKey = `${latestBase}/phase08_extraction.json`;
  const sourcePacketsRunKey = `${runBase}/analysis/source_indexing_extraction_packets.json`;
  const sourcePacketsLatestKey = `${latestBase}/source_indexing_extraction_packets.json`;
  const itemPacketRunKey = `${runBase}/analysis/item_indexing_extraction_packet.json`;
  const itemPacketLatestKey = `${latestBase}/item_indexing_extraction_packet.json`;
  const runMetaPacketRunKey = `${runBase}/analysis/run_meta_packet.json`;
  const runMetaPacketLatestKey = `${latestBase}/run_meta_packet.json`;
  summary.needset = {
    ...(summary.needset || {}),
    key: needSetRunKey,
    latest_key: needSetLatestKey
  };
  summary.phase07 = {
    ...(summary.phase07 || {}),
    key: phase07RunKey,
    latest_key: phase07LatestKey
  };
  summary.phase08 = {
    ...(summary.phase08 || {}),
    key: phase08RunKey,
    latest_key: phase08LatestKey
  };
  const indexingSchemaPackets = buildIndexingSchemaPackets({
    runId,
    category,
    productId,
    startMs,
    summary,
    categoryConfig,
    sourceResults,
    normalized,
    provenance,
    needSet,
    phase08Extraction
  });
  let indexingSchemaValidation = null;
  if (config.indexingSchemaPacketsValidationEnabled !== false) {
    indexingSchemaValidation = await validateIndexingSchemaPackets({
      sourceCollection: indexingSchemaPackets.sourceCollection,
      itemPacket: indexingSchemaPackets.itemPacket,
      runMetaPacket: indexingSchemaPackets.runMetaPacket,
      schemaRoot: config.indexingSchemaPacketsSchemaRoot || ''
    });
    if (!indexingSchemaValidation.valid) {
      const sampleErrors = (indexingSchemaValidation.errors || []).slice(0, 12);
      logger.error('indexing_schema_packets_validation_failed', {
        productId,
        runId,
        category,
        schema_root: indexingSchemaValidation.schema_root,
        error_count: Number(indexingSchemaValidation.error_count || 0),
        errors: sampleErrors
      });
      if (config.indexingSchemaPacketsValidationStrict !== false) {
        throw new Error(
          `indexing_schema_packets_schema_invalid (${Number(indexingSchemaValidation.error_count || 0)} errors)`
        );
      }
    }
  }
  summary.indexing_schema_packets = {
    source_packets_key: sourcePacketsRunKey,
    source_packets_latest_key: sourcePacketsLatestKey,
    item_packet_key: itemPacketRunKey,
    item_packet_latest_key: itemPacketLatestKey,
    run_meta_packet_key: runMetaPacketRunKey,
    run_meta_packet_latest_key: runMetaPacketLatestKey,
    source_packet_count: Number(indexingSchemaPackets?.sourceCollection?.source_packet_count || 0),
    item_packet_id: String(indexingSchemaPackets?.itemPacket?.item_packet_id || '').trim() || null,
    run_packet_id: String(indexingSchemaPackets?.runMetaPacket?.run_packet_id || '').trim() || null,
    validation: indexingSchemaValidation
      ? {
        enabled: true,
        valid: Boolean(indexingSchemaValidation.valid),
        schema_root: indexingSchemaValidation.schema_root,
        error_count: Number(indexingSchemaValidation.error_count || 0)
      }
      : {
        enabled: false,
        valid: null,
        schema_root: null,
        error_count: 0
      }
  };
  await storage.writeObject(
    needSetRunKey,
    Buffer.from(`${JSON.stringify(needSet, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    needSetLatestKey,
    Buffer.from(`${JSON.stringify(needSet, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    phase07RunKey,
    Buffer.from(`${JSON.stringify(phase07PrimeSources, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    phase07LatestKey,
    Buffer.from(`${JSON.stringify(phase07PrimeSources, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    phase08RunKey,
    Buffer.from(`${JSON.stringify(phase08Extraction, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    phase08LatestKey,
    Buffer.from(`${JSON.stringify(phase08Extraction, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    sourcePacketsRunKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.sourceCollection, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    sourcePacketsLatestKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.sourceCollection, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    itemPacketRunKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.itemPacket, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    itemPacketLatestKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.itemPacket, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    runMetaPacketRunKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.runMetaPacket, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    runMetaPacketLatestKey,
    Buffer.from(`${JSON.stringify(indexingSchemaPackets.runMetaPacket, null, 2)}\n`, 'utf8'),
    { contentType: 'application/json' }
  );
  logger.info('needset_computed', {
    productId,
    runId,
    category,
    needset_size: needSet.needset_size,
    total_fields: needSet.total_fields,
    identity_lock_state: needSet.identity_lock_state || null,
    identity_audit_rows: Array.isArray(needSet.identity_audit_rows)
      ? needSet.identity_audit_rows
      : [],
    reason_counts: needSet.reason_counts,
    required_level_counts: needSet.required_level_counts,
    snapshots: needSet.snapshots || [],
    needs: needSet.needs || [],
    needset_key: needSetRunKey
  });
  logger.info('phase07_prime_sources_built', {
    productId,
    runId,
    category,
    fields_attempted: Number(phase07PrimeSources?.summary?.fields_attempted || 0),
    fields_with_hits: Number(phase07PrimeSources?.summary?.fields_with_hits || 0),
    fields_satisfied_min_refs: Number(phase07PrimeSources?.summary?.fields_satisfied_min_refs || 0),
    refs_selected_total: Number(phase07PrimeSources?.summary?.refs_selected_total || 0),
    distinct_sources_selected: Number(phase07PrimeSources?.summary?.distinct_sources_selected || 0),
    phase07_key: phase07RunKey,
    fields: Array.isArray(phase07PrimeSources?.fields)
      ? phase07PrimeSources.fields.slice(0, 32).map((row) => ({
        field_key: row.field_key,
        min_refs_required: row.min_refs_required,
        refs_selected: row.refs_selected,
        min_refs_satisfied: row.min_refs_satisfied,
        distinct_sources_required: row.distinct_sources_required,
        distinct_sources_selected: row.distinct_sources_selected,
        top_hit_score: Number((row.hits || [])[0]?.score || 0)
      }))
      : []
  });
  logger.info('phase08_extraction_context_built', {
    productId,
    runId,
    category,
    batch_count: Number(phase08Extraction?.summary?.batch_count || 0),
    batch_error_count: Number(phase08Extraction?.summary?.batch_error_count || 0),
    schema_fail_rate: Number(phase08Extraction?.summary?.schema_fail_rate || 0),
    raw_candidate_count: Number(phase08Extraction?.summary?.raw_candidate_count || 0),
    accepted_candidate_count: Number(phase08Extraction?.summary?.accepted_candidate_count || 0),
    dangling_snippet_ref_count: Number(phase08Extraction?.summary?.dangling_snippet_ref_count || 0),
    evidence_policy_violation_count: Number(phase08Extraction?.summary?.evidence_policy_violation_count || 0),
    min_refs_satisfied_count: Number(phase08Extraction?.summary?.min_refs_satisfied_count || 0),
    min_refs_total: Number(phase08Extraction?.summary?.min_refs_total || 0),
    field_context_count: Object.keys(phase08Extraction?.field_contexts || {}).length,
    prime_source_rows: Number(phase08Extraction?.prime_sources?.rows?.length || 0),
    phase08_key: phase08RunKey
  });
  logger.info('indexing_schema_packets_written', {
    productId,
    runId,
    category,
    source_packet_count: Number(indexingSchemaPackets?.sourceCollection?.source_packet_count || 0),
    source_packets_key: sourcePacketsRunKey,
    item_packet_key: itemPacketRunKey,
    run_meta_packet_key: runMetaPacketRunKey
  });

  logger.info('run_completed', {
    productId,
    runId,
    run_profile: config.runProfile || 'standard',
    runtime_mode: runtimeMode,
    identity_fingerprint: identityFingerprint,
    identity_lock_status: identityLockStatus,
    dedupe_mode: RUN_DEDUPE_MODE,
    phase_cursor: 'completed',
    validated: summary.validated,
    validated_reason: summary.validated_reason,
    confidence,
    completeness_required: summary.completeness_required,
    coverage_overall: summary.coverage_overall,
    llm_candidates_added: llmCandidatesAccepted,
    llm_call_count_run: llmCallCount,
    llm_cost_usd_run: llmCostUsd,
    llm_fields_filled_count: contribution.llmFields.length,
    llm_estimated_usage_count: llmEstimatedUsageCount,
    llm_retry_without_schema_count: llmRetryWithoutSchemaCount,
    llm_budget_blocked_reason: llmBudgetBlockedReason || null,
    indexing_helper_flow_enabled: indexingHelperFlowEnabled,
    helper_active_match: Boolean(helperContext.active_match),
    helper_supportive_matches: helperContext.supportive_matches?.length || 0,
    helper_supportive_fields_filled: helperFilledFields.length,
    component_prior_fields_filled: componentPriorFilledFields.length,
    critic_reject_count: (criticDecisions.reject || []).length,
    llm_validator_accept_count: (llmValidatorDecisions.accept || []).length,
    llm_validator_reject_count: (llmValidatorDecisions.reject || []).length,
    phase08_batch_count: Number(phase08Extraction?.summary?.batch_count || 0),
    phase08_schema_fail_rate: Number(phase08Extraction?.summary?.schema_fail_rate || 0),
    phase08_dangling_ref_rate: Number(phase08Extraction?.summary?.dangling_snippet_ref_rate || 0),
    phase08_min_refs_satisfied_rate: Number(phase08Extraction?.summary?.min_refs_satisfied_rate || 0),
    traffic_green_count: trafficLight.counts.green,
    traffic_yellow_count: trafficLight.counts.yellow,
    traffic_red_count: trafficLight.counts.red,
    resume_mode: resumeMode,
    resume_max_age_hours: resumeMaxAgeHours,
    resume_reextract_enabled: resumeReextractEnabled,
    resume_reextract_after_hours: resumeReextractAfterHours,
    resume_seeded_pending_count: resumeSeededPendingCount,
    resume_seeded_llm_retry_count: resumeSeededLlmRetryCount,
    resume_seeded_reextract_count: resumeSeededReextractCount,
    resume_persisted_pending_count: resumePersistedPendingCount,
    resume_persisted_llm_retry_count: resumePersistedLlmRetryCount,
    resume_persisted_success_count: resumePersistedSuccessCount,
    hypothesis_queue_count: summary.hypothesis_queue.length,
    hypothesis_followup_rounds: hypothesisFollowupRoundsExecuted,
    hypothesis_followup_seeded_urls: hypothesisFollowupSeededUrls,
    aggressive_enabled: Boolean(aggressiveExtraction?.enabled),
    aggressive_stage: aggressiveExtraction?.stage || 'disabled',
    contradiction_count: summary.constraint_analysis.contradiction_count,
    duration_ms: durationMs
  });

  const rowTsv = tsvRowFromFields(fieldOrder, normalized.fields);
  let markdownSummary = '';
  if (config.writeMarkdownSummary) {
    if (config.llmEnabled && config.llmWriteSummary) {
      markdownSummary = await writeSummaryMarkdownLLM({
        normalized,
        provenance,
        summary,
        config,
        logger,
        llmContext
      }) || buildMarkdownSummary({ normalized, summary });
    } else {
      markdownSummary = buildMarkdownSummary({ normalized, summary });
    }
  }

  const identityReportKey = `${runBase}/identity_report.json`;
  summary.identity_report = {
    ...(summary.identity_report || {}),
    key: identityReportKey
  };
  await storage.writeObject(
    identityReportKey,
    Buffer.from(JSON.stringify(identityReport, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  const intelResult = await persistSourceIntel({
    storage,
    config,
    category,
    productId,
    brand: job.identityLock?.brand || identity.brand || '',
    sourceResults,
    provenance,
    categoryConfig,
    constraintAnalysis
  });

  summary.source_intel = {
    domain_stats_key: intelResult.domainStatsKey,
    promotion_suggestions_key: intelResult.promotionSuggestionsKey,
    expansion_plan_key: intelResult.expansionPlanKey,
    brand_expansion_plan_count: intelResult.brandExpansionPlanCount
  };
  const categoryBrain = await updateCategoryBrain({
    storage,
    config,
    category,
    job,
    normalized,
    summary,
    provenance,
    sourceResults,
    discoveryResult,
    runId
  });
  summary.category_brain = {
    keys: categoryBrain.keys,
    promotion_update: categoryBrain.promotion_update
  };
  const componentUpdate = await updateComponentLibrary({
    storage,
    normalized,
    summary,
    provenance
  });
  summary.component_library = componentUpdate;

  let learning = null;
  if (config.selfImproveEnabled) {
    learning = await persistLearningProfile({
      storage,
      config,
      category,
      job,
      sourceResults,
      summary,
      learningProfile,
      discoveryResult,
      runBase,
      runId
    });
  }

  if (learning) {
    summary.learning = {
      profile_key: learning.profileKey,
      run_log_key: learning.learningRunKey
    };
  }

  const exportInfo = await exportRunArtifacts({
    storage,
    category,
    productId,
    runId,
    artifactsByHost,
    adapterArtifacts,
    normalized,
    provenance,
    candidates,
    summary,
    events: logger.events,
    markdownSummary,
    rowTsv,
    writeMarkdownSummary: config.writeMarkdownSummary
  });
  const finalExport = await writeFinalOutputs({
    storage,
    category,
    productId,
    runId,
    normalized,
    summary,
    provenance,
    trafficLight,
    sourceResults,
    runtimeEngine: runtimeFieldRulesEngine,
    runtimeFieldOrder: fieldOrder,
    runtimeEnforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    runtimeEvidencePack: runtimeEvidencePack || null
  });
  summary.final_export = finalExport;

  try {
    const reviewProduct = await writeProductReviewArtifacts({
      storage,
      config,
      category,
      productId
    });
    const reviewCategory = await writeCategoryReviewArtifacts({
      storage,
      config,
      category,
      status: 'needs_review',
      limit: 500
    });
    summary.review_artifacts = {
      product_review_candidates_key: reviewProduct.keys.candidatesKey,
      product_review_queue_key: reviewProduct.keys.reviewQueueKey,
      category_review_queue_key: reviewCategory.key,
      candidate_count: reviewProduct.candidate_count,
      review_field_count: reviewProduct.review_field_count,
      queue_count: reviewCategory.count
    };
  } catch (error) {
    summary.review_artifacts = {
      error: error.message
    };
    logger.warn('review_artifacts_write_failed', {
      category,
      productId,
      runId,
      message: error.message
    });
  }
  emitFieldDecisionEvents({
    logger,
    fieldOrder,
    normalized,
    provenance,
    fieldReasoning,
    trafficLight
  });
  if (frontierDb) {
    await frontierDb.save();
  }

  await logger.flush();

  return {
    job,
    normalized,
    provenance,
    summary,
    runId,
    productId,
    exportInfo,
    finalExport,
    learning,
    categoryBrain
  };
}
