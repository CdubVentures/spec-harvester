import { buildRunId, normalizeWhitespace } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { SourcePlanner, buildSourceSummary } from '../planner/sourcePlanner.js';
import { PlaywrightFetcher, DryRunFetcher, HttpFetcher } from '../fetcher/playwrightFetcher.js';
import { extractCandidatesFromPage } from '../extractors/fieldExtractor.js';
import { evaluateAnchorConflicts, mergeAnchorConflictLists } from '../validator/anchors.js';
import { evaluateSourceIdentity, evaluateIdentityGate } from '../validator/identityGate.js';
import {
  computeCompletenessRequired,
  computeCoverageOverall,
  computeConfidence
} from '../scoring/qualityScoring.js';
import { evaluateValidationGate } from '../validator/qualityGate.js';
import { runConsensusEngine } from '../scoring/consensusEngine.js';
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
import { appendEnumCurationSuggestions } from '../engine/curationSuggestions.js';
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
  embedded_state: 4,
  ldjson: 3,
  pdf: 3,
  dom: 2,
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
    context: {
      runId
    }
  });
  const startMs = Date.now();

  logger.info('run_started', { s3Key, runId, round: roundContext?.round ?? 0 });

  const job = jobOverride || (await storage.readJson(s3Key));
  const productId = job.productId;
  const category = job.category || 'mouse';
  logger.setContext({
    category,
    productId
  });
  const categoryConfig = await loadCategoryConfig(category, { storage, config });
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
  if (config.helperFilesEnabled) {
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
  planner.seed(helperContext.seed_urls || [], { forceBrandBypass: false });

  let fetcher = config.dryRun
    ? new DryRunFetcher(config, logger)
    : new PlaywrightFetcher(config, logger);
  let fetcherMode = config.dryRun ? 'dryrun' : 'playwright';
  let fetcherStartFallbackReason = '';

  const sourceResults = [];
  const helperSupportiveSyntheticSources = config.helperSupportiveEnabled
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
  const llmVerifySampleRate = Math.max(1, Number.parseInt(String(config.llmVerifySampleRate || 10), 10) || 10);
  const llmVerifySampled = (stableHash(`${productId}:${runId}`) % llmVerifySampleRate) === 0;
  const llmVerifyForced = Boolean(roundContext?.force_verify_llm);
  const llmVerifyEnabled = Boolean(config.llmVerifyMode && (llmVerifySampled || llmVerifyForced));
  const llmContext = {
    storage,
    category,
    productId,
    runId,
    round: Number.parseInt(String(roundContext?.round ?? 0), 10) || 0,
    verification: {
      enabled: llmVerifyEnabled,
      done: false,
      trigger: llmVerifyForced ? 'missing_required_fields' : (llmVerifySampled ? 'sampling' : 'disabled')
    },
    budgetGuard: llmBudgetGuard,
    costRates: llmCostRates,
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

  const discoveryResult = await discoverCandidateSources({
    config,
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
    llmContext
  });

  planner.seed(discoveryResult.approvedUrls || [], { forceBrandBypass: false });
  if (discoveryResult.enabled && config.maxCandidateUrls > 0 && config.fetchCandidateSources) {
    planner.seedCandidates(discoveryResult.candidateUrls || []);
  }

  try {
    await fetcher.start();
  } catch (error) {
    fetcherStartFallbackReason = error.message;
    if (config.dryRun) {
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

  const processPlannerQueue = async () => {
    while (planner.hasNext()) {
      const elapsedSeconds = (Date.now() - startMs) / 1000;
      if (elapsedSeconds >= config.maxRunSeconds) {
        logger.warn('max_run_seconds_reached', { maxRunSeconds: config.maxRunSeconds });
        break;
      }

      const source = planner.next();
      if (!source) {
        continue;
      }

      logger.info('source_fetch_started', {
        url: source.url,
        tier: source.tier,
        role: source.role,
        approved_domain: source.approvedDomain
      });

      let pageData;
      try {
        pageData = await fetcher.fetch(source);
      } catch (error) {
        logger.error('source_fetch_failed', {
          url: source.url,
          message: error.message
        });
        continue;
      }

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
          fieldCandidates: []
        }
        : extractCandidatesFromPage({
          host: source.host,
          html: pageData.html,
          title: pageData.title,
          ldjsonBlocks: pageData.ldjsonBlocks,
          embeddedState: pageData.embeddedState,
          networkResponses: pageData.networkResponses
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
      const deterministicFieldCandidates = dedupeCandidates([
        ...(extraction.fieldCandidates || []),
        ...(adapterExtra.fieldCandidates || [])
      ]);

      let llmExtraction = {
        identityCandidates: {},
        fieldCandidates: [],
        conflicts: [],
        notes: []
      };
      let evidencePack = null;
      const sourceStatusCode = Number.parseInt(String(pageData.status || 0), 10) || 0;
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
          pageData,
          adapterExtra,
          config,
          targetFields: llmTargetFields,
          deterministicCandidates: deterministicFieldCandidates
        });
      }

      const llmEligibleSource =
        config.llmEnabled &&
        Boolean(evidencePack) &&
        sourceStatusCode < 400;
      if (llmEligibleSource) {
        llmExtraction = await extractCandidatesLLM({
          job,
          categoryConfig,
          evidencePack,
          goldenExamples,
          targetFields: llmTargetFields,
          config,
          logger,
          llmContext
        });
      } else if (config.llmEnabled) {
        logger.info('llm_extract_skipped_source', {
          url: source.url,
          status: sourceStatusCode || null,
          reason: discoveryOnlySource
            ? 'discovery_only_source'
            : sourceStatusCode >= 500
              ? 'http_status_source_unavailable'
              : sourceStatusCode >= 400
              ? 'http_status_not_extractable'
              : 'source_not_extractable'
        });
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
        fingerprint,
        parserHealth
      });

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

      if (
        source.approvedDomain &&
        identity.match &&
        (anchorCheck.majorConflicts || []).length === 0
      ) {
        const newlyFilledFields = mergedFieldCandidatesWithEvidence
          .filter((candidate) => {
            const value = String(candidate.value || '').trim().toLowerCase();
            return value && value !== 'unk';
          })
          .map((candidate) => candidate.field);
        planner.markFieldsFilled(newlyFilledFields);
      }

      const artifactHostKey = `${source.host}__${String(artifactSequence).padStart(4, '0')}`;
      artifactSequence += 1;
      artifactsByHost[artifactHostKey] = {
        html: pageData.html,
        ldjsonBlocks: pageData.ldjsonBlocks,
        embeddedState: pageData.embeddedState,
        networkResponses: pageData.networkResponses,
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

      logger.info('source_processed', {
        url: source.url,
        status: pageData.status,
        identity_match: identity.match,
        identity_score: identity.score,
        anchor_status: anchorStatus,
        candidate_count: mergedFieldCandidatesWithEvidence.length,
        candidate_source: source.candidateSource,
        llm_candidate_count: llmFieldCandidates.length
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
    config
  });

  let normalized;
  let provenance;
  let candidates;
  let fieldsBelowPassTarget;
  let criticalFieldsBelowPassTarget;
  let newValuesProposed;
  const allowHelperProvisionalFill = helperSupportsProvisionalFill(helperContext, job.identityLock || {});

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
    fieldsBelowPassTarget = fieldOrder.filter((field) => !['id', 'brand', 'model', 'base_model', 'category', 'sku'].includes(field));
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

  if (config.helperSupportiveFillMissing && (identityGate.validated || allowHelperProvisionalFill)) {
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

  const runtimeGateResult = applyRuntimeFieldRules({
    engine: runtimeFieldRulesEngine,
    fields: normalized.fields,
    provenance,
    fieldOrder,
    enforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    strictEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    evidencePack: null
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
  if ((runtimeGateResult.curation_suggestions || []).length > 0) {
    try {
      curationSuggestionResult = await appendEnumCurationSuggestions({
        config,
        category,
        productId,
        runId,
        suggestions: runtimeGateResult.curation_suggestions || []
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

  const summary = {
    productId,
    runId,
    category,
    run_profile: config.runProfile || 'standard',
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
    identity_gate: identityGate,
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
      candidate_count: discoveryResult.candidates.length
    },
    searches_attempted: discoveryResult.search_attempts || [],
    urls_fetched: [...new Set(
      sourceResults
        .filter((source) => !isHelperSyntheticSource(source))
        .map((source) => source.finalUrl || source.url)
        .filter(Boolean)
    )],
    helper_files: {
      enabled: Boolean(config.helperFilesEnabled),
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
      supportive_fill_missing_enabled: Boolean(config.helperSupportiveFillMissing),
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

  logger.info('run_completed', {
    productId,
    runId,
    run_profile: config.runProfile || 'standard',
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
    helper_active_match: Boolean(helperContext.active_match),
    helper_supportive_matches: helperContext.supportive_matches?.length || 0,
    helper_supportive_fields_filled: helperFilledFields.length,
    component_prior_fields_filled: componentPriorFilledFields.length,
    critic_reject_count: (criticDecisions.reject || []).length,
    llm_validator_accept_count: (llmValidatorDecisions.accept || []).length,
    llm_validator_reject_count: (llmValidatorDecisions.reject || []).length,
    traffic_green_count: trafficLight.counts.green,
    traffic_yellow_count: trafficLight.counts.yellow,
    traffic_red_count: trafficLight.counts.red,
    hypothesis_queue_count: summary.hypothesis_queue.length,
    hypothesis_followup_rounds: hypothesisFollowupRoundsExecuted,
    hypothesis_followup_seeded_urls: hypothesisFollowupSeededUrls,
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

  const runBase = storage.resolveOutputKey(category, productId, 'runs', runId);
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
    runtimeEnforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence)
  });
  summary.final_export = finalExport;
  emitFieldDecisionEvents({
    logger,
    fieldOrder,
    normalized,
    provenance,
    fieldReasoning,
    trafficLight
  });

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
