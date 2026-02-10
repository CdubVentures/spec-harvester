import { buildRunId } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { SourcePlanner, buildSourceSummary } from '../planner/sourcePlanner.js';
import { PlaywrightFetcher, DryRunFetcher } from '../fetcher/playwrightFetcher.js';
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
  buildEvidencePack
} from '../llm/evidencePack.js';
import {
  extractCandidatesLLM
} from '../llm/extractCandidatesLLM.js';
import {
  writeSummaryMarkdownLLM
} from '../llm/writeSummaryLLM.js';
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

function bestIdentityFromSources(sourceResults) {
  const sorted = [...sourceResults].sort((a, b) => {
    if ((b.identity?.score || 0) !== (a.identity?.score || 0)) {
      return (b.identity?.score || 0) - (a.identity?.score || 0);
    }
    return a.tier - b.tier;
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

function buildFieldReasoning({
  fieldOrder,
  provenance,
  fieldsBelowPassTarget,
  criticalFieldsBelowPassTarget,
  missingRequiredFields,
  constraintAnalysis
}) {
  const fieldsBelowSet = new Set(fieldsBelowPassTarget || []);
  const criticalBelowSet = new Set(criticalFieldsBelowPassTarget || []);
  const missingRequiredSet = new Set(missingRequiredFields || []);
  const contradictionsByField = {};

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
  }

  return output;
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

export async function runProduct({ storage, config, s3Key }) {
  const runId = buildRunId();
  const logger = new EventLogger();
  const startMs = Date.now();

  logger.info('run_started', { s3Key, runId });

  const job = await storage.readJson(s3Key);
  const productId = job.productId;
  const category = job.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category, { storage, config });

  const fieldOrder = categoryConfig.fieldOrder;
  const requiredFields = job.requirements?.requiredFields || categoryConfig.requiredFields;
  const targets = resolveTargets(job, categoryConfig);
  const anchors = job.anchors || {};

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
  planner.seed(adapterSeedUrls);

  const fetcher = config.dryRun
    ? new DryRunFetcher(config, logger)
    : new PlaywrightFetcher(config, logger);

  const sourceResults = [];
  const artifactsByHost = {};
  let artifactSequence = 0;
  const adapterArtifacts = [];
  let llmCandidatesAccepted = 0;
  let llmSourcesUsed = 0;
  let hypothesisFollowupRoundsExecuted = 0;
  let hypothesisFollowupSeededUrls = 0;

  const discoveryResult = await discoverCandidateSources({
    config,
    storage,
    categoryConfig,
    job,
    runId,
    logger,
    planningHints: {
      missingCriticalFields: categoryConfig.schema?.critical_fields || []
    }
  });

  planner.seed(discoveryResult.approvedUrls || []);
  if (discoveryResult.enabled && config.maxCandidateUrls > 0 && config.fetchCandidateSources) {
    planner.seedCandidates(discoveryResult.candidateUrls || []);
  }

  await fetcher.start();

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

      let llmExtraction = {
        identityCandidates: {},
        fieldCandidates: [],
        conflicts: [],
        notes: []
      };
      let evidencePack = null;
      if (config.llmEnabled) {
        evidencePack = buildEvidencePack({
          source,
          pageData,
          adapterExtra,
          config
        });
        llmExtraction = await extractCandidatesLLM({
          job,
          categoryConfig,
          evidencePack,
          config,
          logger
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
        ...(extraction.fieldCandidates || []),
        ...(adapterExtra.fieldCandidates || []),
        ...llmFieldCandidates
      ]);
      const temporalSignals = extractTemporalSignals({
        source,
        pageData,
        fieldCandidates: mergedFieldCandidates
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

      const candidateFieldMap = buildCandidateFieldMap(mergedFieldCandidates);
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
        mergedFieldCandidates,
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
        title: pageData.title,
        identity,
        identityCandidates: mergedIdentityCandidates,
        fieldCandidates: mergedFieldCandidates,
        anchorCheck,
        anchorStatus,
        endpointSignals: endpointIntel.endpointSignals,
        endpointSuggestions: endpointIntel.nextBestUrls,
        temporalSignals,
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
        const newlyFilledFields = mergedFieldCandidates
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
        extractedCandidates: mergedFieldCandidates
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
        candidate_count: mergedFieldCandidates.length,
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
        sourceResults,
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

  for (const syntheticSource of dedicated.syntheticSources || []) {
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
  const extractedIdentity = bestIdentityFromSources(sourceResults);
  const identity = buildIdentityObject(job, extractedIdentity);

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

  if (!identityGate.validated || identityConfidence < 0.99) {
    normalized = buildAbortedNormalized({
      productId,
      runId,
      category,
      identity,
      sourceSummary,
      notes: [
        'MODEL_AMBIGUITY_ALERT',
        'Identity certainty below 99%: spec fields withheld.'
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
  const temporalEvidence = aggregateTemporalSignals(sourceResults, 40);
  const constraintAnalysis = evaluateConstraintGraph({
    fields: normalized.fields,
    provenance,
    criticalFieldSet: categoryConfig.criticalFieldSet
  });
  const hypothesisQueue = buildHypothesisQueue({
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields,
    provenance,
    sourceResults,
    sourceIntelDomains: sourceIntel.data?.domains || {},
    brand: job.identityLock?.brand || identity.brand || '',
    criticalFieldSet: categoryConfig.criticalFieldSet,
    maxItems: Math.max(1, Number(config.maxHypothesisItems || 50))
  });
  const fieldReasoning = buildFieldReasoning({
    fieldOrder,
    provenance,
    fieldsBelowPassTarget,
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields,
    constraintAnalysis
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
    llm: {
      enabled: Boolean(config.llmEnabled && config.openaiApiKey),
      model_extract: config.llmEnabled ? config.openaiModelExtract : null,
      candidates_added: llmCandidatesAccepted,
      sources_with_llm_candidates: llmSourcesUsed
    },
    source_registry: {
      override_key: categoryConfig.sources_override_key || null
    },
    crawl_profile: {
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
    hypothesis_queue: hypothesisQueue,
    hypothesis_followup: {
      configured_rounds: Math.max(0, Number(config.hypothesisAutoFollowupRounds || 0)),
      urls_per_round: Math.max(1, Number(config.hypothesisFollowupUrlsPerRound || 12)),
      rounds_executed: hypothesisFollowupRoundsExecuted,
      seeded_urls: hypothesisFollowupSeededUrls
    },
    constraint_analysis: constraintAnalysis,
    field_reasoning: fieldReasoning,
    parser_health: {
      source_count: parserHealthRows.length,
      average_health_score: Number.parseFloat(parserHealthAverage.toFixed(6)),
      fingerprints_seen: fingerprintCount
    },
    duration_ms: durationMs,
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
        logger
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

  return {
    job,
    normalized,
    provenance,
    summary,
    runId,
    productId,
    exportInfo,
    learning
  };
}
