import { buildRunId } from '../utils/common.js';
import { SourcePlanner, buildSourceSummary } from '../planner/sourcePlanner.js';
import { PlaywrightFetcher, DryRunFetcher } from '../fetcher/playwrightFetcher.js';
import { extractCandidatesFromPage } from '../extractors/fieldExtractor.js';
import {
  evaluateAnchorConflicts,
  mergeAnchorConflictLists
} from '../validator/anchors.js';
import {
  evaluateSourceIdentity,
  evaluateIdentityGate
} from '../validator/identityGate.js';
import { aggregateFieldValues, tsvRowFromFields } from '../scoring/fieldAggregator.js';
import {
  computeCompleteness,
  computeConfidence
} from '../scoring/qualityScoring.js';
import {
  buildAbortedNormalized,
  buildIdentityObject,
  buildValidatedNormalized
} from '../normalizer/mouseNormalizer.js';
import { exportRunArtifacts } from '../exporter/exporter.js';
import { buildMarkdownSummary } from '../exporter/summaryWriter.js';
import { EventLogger } from '../logger.js';

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
    if (!map[row.field]) {
      map[row.field] = row.value;
    }
  }
  return map;
}

function createEmptyProvenance(fields) {
  const output = {};
  for (const key of Object.keys(fields)) {
    output[key] = {
      value: fields[key],
      confirmations: 0,
      pass_target: 0,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return output;
}

export async function runProduct({ storage, config, s3Key }) {
  const runId = buildRunId();
  const logger = new EventLogger();
  const startMs = Date.now();

  logger.info('run_started', { s3Key, runId });

  const job = await storage.readJson(s3Key);
  const productId = job.productId;
  const category = job.category || 'mouse';

  if (category !== 'mouse') {
    throw new Error(`Unsupported category: ${category}`);
  }

  const planner = new SourcePlanner(job, config);
  const fetcher = config.dryRun
    ? new DryRunFetcher(config, logger)
    : new PlaywrightFetcher(config, logger);

  const sourceResults = [];
  const artifactsByHost = {};

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
        role: source.role
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

      const candidateFieldMap = buildCandidateFieldMap(extraction.fieldCandidates);
      const anchorCheck = evaluateAnchorConflicts(job.anchors || {}, candidateFieldMap);
      const identity = evaluateSourceIdentity(
        {
          ...source,
          title: pageData.title,
          identityCandidates: extraction.identityCandidates,
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
        status: pageData.status,
        finalUrl: pageData.finalUrl,
        title: pageData.title,
        identity,
        identityCandidates: extraction.identityCandidates,
        fieldCandidates: extraction.fieldCandidates,
        anchorCheck,
        anchorStatus
      });

      artifactsByHost[source.host] = {
        html: pageData.html,
        ldjsonBlocks: pageData.ldjsonBlocks,
        embeddedState: pageData.embeddedState,
        networkResponses: pageData.networkResponses
      };

      logger.info('source_processed', {
        url: source.url,
        status: pageData.status,
        identity_match: identity.match,
        identity_score: identity.score,
        anchor_status: anchorStatus,
        candidate_count: extraction.fieldCandidates.length
      });
    }
  } finally {
    await fetcher.stop();
  }

  const identityGate = evaluateIdentityGate(sourceResults);
  const extractedIdentity = bestIdentityFromSources(sourceResults);
  const identity = buildIdentityObject(job, extractedIdentity);

  const fieldAggregate = aggregateFieldValues(sourceResults, job.identityLock || {}, productId);
  const sourceSummary = buildSourceSummary(sourceResults);
  const allAnchorConflicts = mergeAnchorConflictLists(sourceResults.map((s) => s.anchorCheck));

  let normalized;
  let provenance;
  let fieldsBelowPassTarget;
  let newValuesProposed;

  if (!identityGate.validated) {
    normalized = buildAbortedNormalized({
      productId,
      runId,
      category,
      identity,
      sourceSummary,
      notes: [
        'MODEL_AMBIGUITY_ALERT',
        'Identity certainty below 99% or conflicts unresolved. Spec fields intentionally withheld.'
      ],
      confidence: identityGate.certainty,
      completeness: 0
    });
    provenance = createEmptyProvenance(normalized.fields);
    fieldsBelowPassTarget = Object.keys(normalized.fields).filter((k) => !['id', 'brand', 'model', 'base_model', 'category', 'sku'].includes(k));
    newValuesProposed = [];
  } else {
    const fields = {
      ...fieldAggregate.fields,
      id: productId,
      brand: identity.brand,
      model: identity.model,
      base_model: identity.base_model,
      category,
      sku: identity.sku
    };

    provenance = fieldAggregate.provenance;
    fieldsBelowPassTarget = fieldAggregate.fieldsBelowPassTarget;
    newValuesProposed = fieldAggregate.newValuesProposed;

    normalized = buildValidatedNormalized({
      productId,
      runId,
      category,
      identity,
      fields,
      quality: {
        validated: true,
        confidence: 0,
        completeness: 0,
        notes: []
      },
      sourceSummary
    });
  }

  const completenessStats = computeCompleteness(
    normalized,
    job.requirements?.requiredFields
  );

  const confidence = computeConfidence({
    identityGate,
    provenance,
    conflictsCount: allAnchorConflicts.length,
    validated: identityGate.validated
  });

  normalized.quality.completeness = completenessStats.completeness;
  normalized.quality.confidence = confidence;
  normalized.quality.validated = identityGate.validated;

  if (!identityGate.validated) {
    normalized.quality.notes = [...new Set([...(normalized.quality.notes || []), identityGate.reason])];
  }

  const durationMs = Date.now() - startMs;
  const summary = {
    productId,
    runId,
    category,
    validated: identityGate.validated,
    reason: identityGate.reason,
    confidence,
    completeness: completenessStats.completeness,
    target_completeness: job.requirements?.targetCompleteness ?? null,
    target_confidence: job.requirements?.targetConfidence ?? null,
    required_fields: completenessStats.requiredFields,
    anchor_fields_present: Boolean(
      Object.values(job.anchors || {}).find((v) => String(v || '').trim() !== '')
    ),
    anchor_conflicts: allAnchorConflicts,
    identity_gate: identityGate,
    fields_below_pass_target: fieldsBelowPassTarget,
    new_values_proposed: newValuesProposed,
    sources_attempted: sourceResults.length,
    sources_identity_matched: sourceResults.filter((s) => s.identity.match).length,
    duration_ms: durationMs,
    generated_at: new Date().toISOString()
  };

  logger.info('run_completed', {
    productId,
    runId,
    validated: summary.validated,
    confidence,
    completeness: summary.completeness,
    duration_ms: durationMs
  });

  const rowTsv = tsvRowFromFields(normalized.fields);
  const markdownSummary = config.writeMarkdownSummary
    ? buildMarkdownSummary({ normalized, summary })
    : '';

  const exportInfo = await exportRunArtifacts({
    storage,
    productId,
    runId,
    artifactsByHost,
    normalized,
    provenance,
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
