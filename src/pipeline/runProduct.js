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

function bestIdentityFromSources(sourceResults) {
  const sorted = [...sourceResults].sort((a, b) => {
    if ((b.identity?.score || 0) !== (a.identity?.score || 0)) {
      return (b.identity?.score || 0) - (a.identity?.score || 0);
    }
    return a.tier - b.tier;
  });
  return sorted[0]?.identityCandidates || {};
}

function buildCandidateFieldMap(fieldCandidates) {
  const map = {};
  for (const row of fieldCandidates || []) {
    if (!map[row.field] && row.value !== 'unk') {
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

export async function runProduct({ storage, config, s3Key }) {
  const runId = buildRunId();
  const logger = new EventLogger();
  const startMs = Date.now();

  logger.info('run_started', { s3Key, runId });

  const job = await storage.readJson(s3Key);
  const productId = job.productId;
  const category = job.category || 'mouse';
  const categoryConfig = await loadCategoryConfig(category);

  const fieldOrder = categoryConfig.fieldOrder;
  const requiredFields = job.requirements?.requiredFields || categoryConfig.requiredFields;
  const targets = resolveTargets(job, categoryConfig);
  const anchors = job.anchors || {};

  const adapterManager = createAdapterManager(config, logger);
  const planner = new SourcePlanner(job, config, categoryConfig);
  const adapterSeedUrls = adapterManager.collectSeedUrls({ job });
  planner.seed(adapterSeedUrls);

  const fetcher = config.dryRun
    ? new DryRunFetcher(config, logger)
    : new PlaywrightFetcher(config, logger);

  const sourceResults = [];
  const artifactsByHost = {};
  const adapterArtifacts = [];

  const discoveryResult = await discoverCandidateSources({
    config,
    storage,
    categoryConfig,
    job,
    runId,
    logger
  });

  await fetcher.start();

  try {
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

      const extraction = extractCandidatesFromPage({
        html: pageData.html,
        title: pageData.title,
        ldjsonBlocks: pageData.ldjsonBlocks,
        embeddedState: pageData.embeddedState,
        networkResponses: pageData.networkResponses
      });

      const adapterExtra = await adapterManager.extractForPage({
        source,
        pageData,
        job,
        runId
      });

      for (const url of adapterExtra.additionalUrls || []) {
        planner.enqueue(url, `adapter:${source.url}`);
      }

      const mergedFieldCandidates = dedupeCandidates([
        ...(extraction.fieldCandidates || []),
        ...(adapterExtra.fieldCandidates || [])
      ]);

      const mergedIdentityCandidates = {
        ...(extraction.identityCandidates || {}),
        ...(adapterExtra.identityCandidates || {})
      };

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
        anchorStatus
      });

      artifactsByHost[source.host] = {
        html: pageData.html,
        ldjsonBlocks: pageData.ldjsonBlocks,
        embeddedState: pageData.embeddedState,
        networkResponses: pageData.networkResponses,
        pdfDocs: adapterExtra.pdfDocs || []
      };

      adapterArtifacts.push(...(adapterExtra.adapterArtifacts || []));

      logger.info('source_processed', {
        url: source.url,
        status: pageData.status,
        identity_match: identity.match,
        identity_score: identity.score,
        anchor_status: anchorStatus,
        candidate_count: mergedFieldCandidates.length
      });
    }
  } finally {
    await fetcher.stop();
  }

  const dedicated = await adapterManager.runDedicatedAdapters({
    job,
    runId
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
    category
  });

  let normalized;
  let provenance;
  let candidates;
  let fieldsBelowPassTarget;
  let criticalFieldsBelowPassTarget;
  let newValuesProposed;

  if (identityConfidence < 0.99) {
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

  const summary = {
    productId,
    runId,
    category,
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
    identity_gate: identityGate,
    fields_below_pass_target: fieldsBelowPassTarget,
    critical_fields_below_pass_target: criticalFieldsBelowPassTarget,
    new_values_proposed: newValuesProposed,
    sources_attempted: sourceResults.length,
    sources_identity_matched: sourceResults.filter((s) => s.identity.match).length,
    discovery: {
      enabled: discoveryResult.enabled,
      candidates_key: discoveryResult.candidatesKey,
      candidate_count: discoveryResult.candidates.length
    },
    duration_ms: durationMs,
    generated_at: new Date().toISOString()
  };

  logger.info('run_completed', {
    productId,
    runId,
    validated: summary.validated,
    validated_reason: summary.validated_reason,
    confidence,
    completeness_required: summary.completeness_required,
    coverage_overall: summary.coverage_overall,
    duration_ms: durationMs
  });

  const rowTsv = tsvRowFromFields(fieldOrder, normalized.fields);
  const markdownSummary = config.writeMarkdownSummary
    ? buildMarkdownSummary({ normalized, summary })
    : '';

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
    exportInfo
  };
}
