/**
 * testRunner.js — Slimmed-down product runner for test mode.
 *
 * Accepts pre-built sourceResults[] and runs them through the entire
 * downstream pipeline: consensus → normalization → component resolution →
 * enum matching → constraint solving → validation → traffic light → export.
 *
 * Reuses all existing pipeline functions — this is essentially runProduct()
 * without the planner/fetcher/discovery/LLM extraction loops.
 */

import { buildRunId } from '../utils/common.js';
import { loadCategoryConfig } from '../categories/loader.js';
import { runConsensusEngine, applySelectionPolicyReducers } from '../scoring/consensusEngine.js';
import { applyListUnionReducers } from '../scoring/listUnionReducer.js';
import { buildIdentityObject, buildValidatedNormalized } from '../normalizer/mouseNormalizer.js';
import { exportRunArtifacts } from '../exporter/exporter.js';
import { writeFinalOutputs } from '../exporter/finalExporter.js';
import {
  computeCompletenessRequired,
  computeCoverageOverall,
  computeConfidence
} from '../scoring/qualityScoring.js';
import { evaluateValidationGate } from '../validator/qualityGate.js';
import { buildTrafficLight } from '../validator/trafficLight.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
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
import { evaluateConstraintGraph } from '../scoring/constraintSolver.js';
import { buildHypothesisQueue } from '../learning/hypothesisQueue.js';
import { buildMarkdownSummary } from '../exporter/summaryWriter.js';
import { EventLogger } from '../logger.js';

function hasKnownFieldValue(val) {
  const s = String(val ?? '').trim().toLowerCase();
  return s !== '' && s !== 'unk' && s !== 'unknown' && s !== 'n/a';
}

function ensureProvenanceField(provenance, field, defaultValue = 'unk') {
  if (!provenance[field]) {
    provenance[field] = {
      value: defaultValue,
      confidence: 0,
      evidence: [],
      meets_pass_target: false
    };
  }
  return provenance[field];
}

function collectContributionFields({ fieldOrder, normalized, provenance }) {
  const llmFields = [];
  const componentFields = [];
  for (const field of fieldOrder || []) {
    if (!hasKnownFieldValue(normalized?.fields?.[field])) continue;
    const prov = provenance?.[field];
    if (!prov) continue;
    const topMethod = (prov.evidence || [])[0]?.method || '';
    if (topMethod.includes('llm') || topMethod === 'test_inject') llmFields.push(field);
    if (topMethod.includes('component')) componentFields.push(field);
  }
  return { llmFields, componentFields };
}

function buildFieldReasoning({ fieldOrder, provenance, fieldsBelowPassTarget, criticalFieldsBelowPassTarget, missingRequiredFields }) {
  const reasoning = {};
  const belowSet = new Set(fieldsBelowPassTarget || []);
  const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
  const missingSet = new Set(missingRequiredFields || []);
  for (const field of fieldOrder || []) {
    const reasons = [];
    if (belowSet.has(field)) reasons.push('below_pass_target');
    if (criticalSet.has(field)) reasons.push('critical_below_pass_target');
    if (missingSet.has(field)) reasons.push('missing_required_field');
    const prov = provenance?.[field];
    reasoning[field] = {
      reasons,
      confidence: prov?.confidence || 0,
      meets_pass_target: prov?.meets_pass_target ?? false,
      source_count: (prov?.evidence || []).length
    };
  }
  return reasoning;
}

function buildTopEvidenceReferences(provenance, limit = 100) {
  const refs = [];
  for (const [field, prov] of Object.entries(provenance || {})) {
    for (const ev of (prov?.evidence || []).slice(0, 3)) {
      refs.push({ field, url: ev.url || '', host: ev.host || '', tier: ev.tier, method: ev.method });
    }
  }
  return refs.slice(0, limit);
}

/**
 * Run a test product through the consensus + downstream pipeline.
 */
export async function runTestProduct({
  storage,
  config,
  job,
  sourceResults,
  category
}) {
  const runId = buildRunId();
  const productId = job.productId;
  const startMs = Date.now();

  const logger = new EventLogger({
    storage,
    runtimeEventsKey: config.runtimeEventsKey || '_runtime/events.jsonl',
    context: { runId, category, productId }
  });
  logger.info('test_run_started', { productId, runId, category, test_case: job._testCase });

  // Load category config (uses the test category's cloned rules)
  const categoryConfig = await loadCategoryConfig(category, { config });
  const fieldOrder = categoryConfig.fieldOrder || [];
  const requiredFields = categoryConfig.requiredFields || [];
  const anchors = job.anchors || {};
  const identityLock = job.identityLock || {};

  // Create field rules engine for runtime gate
  let runtimeFieldRulesEngine = null;
  try {
    runtimeFieldRulesEngine = await createFieldRulesEngine(category, { config });
  } catch {
    // Non-fatal: proceed without field rules engine
  }

  // ── Consensus ───────────────────────────────────────────────────
  const consensus = runConsensusEngine({
    sourceResults,
    categoryConfig,
    fieldOrder,
    anchors,
    identityLock,
    productId,
    category,
    config,
    fieldRulesEngine: runtimeFieldRulesEngine
  });

  let { fields: normalizedFields, provenance, candidates, newValuesProposed } = consensus;
  let fieldsBelowPassTarget = consensus.fieldsBelowPassTarget || [];
  let criticalFieldsBelowPassTarget = consensus.criticalFieldsBelowPassTarget || [];

  // ── Selection policy + list union ───────────────────────────────
  const selectionResult = applySelectionPolicyReducers({
    fields: normalizedFields,
    candidates,
    fieldRulesEngine: runtimeFieldRulesEngine
  });
  normalizedFields = selectionResult.fields;

  const listUnionResult = applyListUnionReducers({
    fields: normalizedFields,
    candidates,
    fieldRulesEngine: runtimeFieldRulesEngine
  });
  normalizedFields = listUnionResult.fields;

  // ── Build normalized object ─────────────────────────────────────
  const identity = buildIdentityObject(job);
  const normalized = buildValidatedNormalized({
    productId,
    runId,
    category,
    identity,
    fields: normalizedFields,
    quality: {},
    sourceSummary: {
      total: sourceResults.length,
      matched: sourceResults.length,
      urls: sourceResults.map(s => s.url),
      used: sourceResults.map(s => ({
        url: s.url,
        host: s.host,
        source_id: s.sourceId || '',
        tier: s.tier,
        tier_name: s.tierName || s.role,
        role: s.role,
        approved_domain: Boolean(s.approvedDomain),
        candidate_source: true,
        anchor_check_status: s.anchorStatus || 'pass',
        identity: s.identity
      }))
    }
  });

  // ── Build consolidated evidence pack from all sources ──────────
  // The runtime gate needs snippet data to verify evidence for each field.
  // Merge all source llmEvidencePacks into one consolidated pack.
  const mergedSnippets = [];
  const mergedReferences = [];
  const seenSnippetIds = new Set();
  for (const src of sourceResults) {
    const pack = src.llmEvidencePack;
    if (!pack) continue;
    for (const s of (pack.snippets || [])) {
      if (s?.id && !seenSnippetIds.has(s.id)) {
        seenSnippetIds.add(s.id);
        mergedSnippets.push(s);
      }
    }
    for (const r of (pack.references || [])) {
      if (r?.id && !seenSnippetIds.has('ref_' + r.id)) {
        seenSnippetIds.add('ref_' + r.id);
        mergedReferences.push(r);
      }
    }
  }
  const consolidatedEvidencePack = mergedSnippets.length > 0 ? {
    meta: { source_id: 'test_merged', snippet_count: mergedSnippets.length },
    snippets: mergedSnippets,
    references: mergedReferences
  } : null;

  // ── Runtime field rules (component/enum matching) ───────────────
  const componentReviewQueue = [];
  const identityObservations = [];
  const runtimeGateResult = applyRuntimeFieldRules({
    engine: runtimeFieldRulesEngine,
    fields: normalized.fields,
    provenance,
    fieldOrder,
    enforceEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    strictEvidence: Boolean(config.fieldRulesEngineEnforceEvidence),
    evidencePack: consolidatedEvidencePack,
    extractedValues: normalized.fields,
    componentReviewQueue,
    identityObservations
  });
  normalized.fields = runtimeGateResult.fields;

  // Update below-pass-target from runtime gate failures
  if ((runtimeGateResult.failures || []).length > 0) {
    const belowSet = new Set(fieldsBelowPassTarget || []);
    const criticalSet = new Set(criticalFieldsBelowPassTarget || []);
    for (const failure of runtimeGateResult.failures) {
      if (!failure?.field) continue;
      belowSet.add(failure.field);
      if (categoryConfig.criticalFieldSet?.has?.(failure.field)) {
        criticalSet.add(failure.field);
      }
      const bucket = ensureProvenanceField(provenance, failure.field, 'unk');
      bucket.value = 'unk';
      bucket.meets_pass_target = false;
      bucket.confidence = Math.min(Number(bucket.confidence || 0), 0.2);
    }
    fieldsBelowPassTarget = [...belowSet];
    criticalFieldsBelowPassTarget = [...criticalSet];
  }

  // ── Curation suggestions (enum + component discovery) ───────────
  const allSuggestions = runtimeGateResult.curation_suggestions || [];
  const enumSuggestions = allSuggestions.filter(s => s.suggestion_type !== 'new_component');
  const componentSuggestions = allSuggestions.filter(s => s.suggestion_type === 'new_component');

  if (enumSuggestions.length > 0) {
    try {
      await appendEnumCurationSuggestions({ config, category, productId, runId, suggestions: enumSuggestions });
    } catch { /* non-fatal */ }
  }
  if (componentSuggestions.length > 0) {
    try {
      await appendComponentCurationSuggestions({ config, category, productId, runId, suggestions: componentSuggestions });
    } catch { /* non-fatal */ }
  }
  if (componentReviewQueue.length > 0) {
    try {
      await appendComponentReviewItems({ config, category, productId, runId, items: componentReviewQueue });
    } catch { /* non-fatal */ }
  }
  if (identityObservations.length > 0) {
    try {
      await appendComponentIdentityObservations({ config, category, productId, runId, observations: identityObservations });
    } catch { /* non-fatal */ }
  }

  // ── Quality scoring ─────────────────────────────────────────────
  const completenessStats = computeCompletenessRequired(normalized, requiredFields);
  const coverageStats = computeCoverageOverall({
    fields: normalized.fields,
    fieldOrder,
    editorialFields: categoryConfig.schema?.editorial_fields
  });
  const confidence = computeConfidence({
    identityConfidence: 1.0,
    provenance,
    anchorConflictsCount: 0,
    agreementScore: consensus.agreementScore || 0
  });
  const gate = evaluateValidationGate({
    identityGateValidated: true,
    identityConfidence: 1.0,
    anchorMajorConflictsCount: 0,
    completenessRequired: completenessStats.completenessRequired,
    targetCompleteness: 0.6,
    confidence,
    targetConfidence: 0.5,
    criticalFieldsBelowPassTarget
  });
  gate.coverageOverallPercent = Number.parseFloat((coverageStats.coverageOverall * 100).toFixed(2));

  normalized.quality = normalized.quality || {};
  normalized.quality.completeness_required = completenessStats.completenessRequired;
  normalized.quality.coverage_overall = coverageStats.coverageOverall;
  normalized.quality.confidence = confidence;
  normalized.quality.validated = gate.validated;
  normalized.quality.notes = gate.reasons;

  // ── Constraint analysis ─────────────────────────────────────────
  const constraintAnalysis = evaluateConstraintGraph({
    fields: normalized.fields,
    provenance,
    criticalFieldSet: categoryConfig.criticalFieldSet
  });

  // ── Field reasoning + traffic light ─────────────────────────────
  const fieldReasoning = buildFieldReasoning({
    fieldOrder,
    provenance,
    fieldsBelowPassTarget,
    criticalFieldsBelowPassTarget,
    missingRequiredFields: completenessStats.missingRequiredFields
  });
  const trafficLight = buildTrafficLight({
    fieldOrder,
    provenance,
    fieldReasoning
  });

  // ── Build summary ───────────────────────────────────────────────
  const durationMs = Date.now() - startMs;
  const contribution = collectContributionFields({ fieldOrder, normalized, provenance });

  const summary = {
    productId,
    runId,
    category,
    run_profile: 'test',
    validated: gate.validated,
    reason: gate.validatedReason || '',
    validated_reason: gate.validatedReason || '',
    validation_reasons: gate.reasons,
    confidence,
    confidence_percent: gate.confidencePercent,
    completeness_required: completenessStats.completenessRequired,
    completeness_required_percent: gate.completenessRequiredPercent,
    coverage_overall: coverageStats.coverageOverall,
    coverage_overall_percent: gate.coverageOverallPercent,
    target_completeness: 0.6,
    target_confidence: 0.5,
    required_fields: completenessStats.requiredFields,
    missing_required_fields: completenessStats.missingRequiredFields,
    anchor_fields_present: false,
    anchor_conflicts: [],
    anchor_major_conflicts_count: 0,
    identity_confidence: 1.0,
    identity_gate_validated: true,
    identity_gate: { validated: true, reasonCodes: [] },
    publishable: false,
    publish_blockers: ['test_mode'],
    identity_report: { status: 'test', needs_review: false, reason_codes: [], page_count: 0 },
    fields_below_pass_target: fieldsBelowPassTarget,
    critical_fields_below_pass_target: criticalFieldsBelowPassTarget,
    new_values_proposed: newValuesProposed || [],
    sources_attempted: sourceResults.length,
    sources_identity_matched: sourceResults.length,
    discovery: { enabled: false, candidates_key: null, candidate_count: 0 },
    searches_attempted: [],
    urls_fetched: sourceResults.map(s => s.url).filter(Boolean),
    helper_files: { enabled: false },
    components: { prior_fields_filled_count: 0, prior_fields_filled: [], matched_components: [] },
    critic: { accept_count: 0, reject_count: 0, unknown_count: 0, decisions: {} },
    runtime_engine: {
      enabled: Boolean(runtimeFieldRulesEngine),
      failure_count: (runtimeGateResult.failures || []).length,
      warning_count: (runtimeGateResult.warnings || []).length,
      change_count: (runtimeGateResult.changes || []).length,
      curation_suggestions_count: allSuggestions.length,
      failures: runtimeGateResult.failures || [],
      warnings: runtimeGateResult.warnings || []
    },
    llm: { enabled: false, provider: 'test' },
    aggressive_extraction: { enabled: false },
    constraint_analysis: constraintAnalysis,
    field_reasoning: fieldReasoning,
    traffic_light: trafficLight,
    top_evidence_references: buildTopEvidenceReferences(provenance, 100),
    duration_ms: durationMs,
    test_case: job._testCase || null,
    generated_at: new Date().toISOString()
  };

  // ── Export artifacts ─────────────────────────────────────────────
  const artifactsByHost = {};
  for (const source of sourceResults) {
    artifactsByHost[source.host] = { fieldCandidates: source.fieldCandidates || [] };
  }

  const rowTsv = '';
  const markdownSummary = buildMarkdownSummary({ normalized, summary });

  try {
    await exportRunArtifacts({
      storage,
      category,
      productId,
      runId,
      artifactsByHost,
      adapterArtifacts: [],
      normalized,
      provenance,
      candidates,
      summary,
      events: logger.events,
      markdownSummary,
      rowTsv,
      writeMarkdownSummary: true
    });
  } catch (err) {
    logger.warn('test_export_run_artifacts_failed', { message: err.message });
  }

  try {
    await writeFinalOutputs({
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
      runtimeEnforceEvidence: false,
      runtimeEvidencePack: null
    });
  } catch (err) {
    logger.warn('test_write_final_outputs_failed', { message: err.message });
  }

  try {
    await writeProductReviewArtifacts({ storage, config, category, productId });
    await writeCategoryReviewArtifacts({ storage, config, category, status: 'needs_review', limit: 500 });
  } catch (err) {
    logger.warn('test_review_artifacts_failed', { message: err.message });
  }

  logger.info('test_run_completed', {
    productId,
    runId,
    test_case: job._testCase,
    confidence,
    coverage: coverageStats.coverageOverall,
    traffic_green: trafficLight.counts?.green || 0,
    traffic_yellow: trafficLight.counts?.yellow || 0,
    traffic_red: trafficLight.counts?.red || 0,
    duration_ms: durationMs
  });

  return {
    productId,
    runId,
    testCase: job._testCase,
    confidence,
    coverage: coverageStats.coverageOverall,
    completeness: completenessStats.completenessRequired,
    validated: gate.validated,
    trafficLight: trafficLight.counts || {},
    constraintConflicts: constraintAnalysis?.contradictionCount || 0,
    missingRequired: completenessStats.missingRequiredFields,
    curationSuggestions: allSuggestions.length,
    runtimeFailures: (runtimeGateResult.failures || []).length,
    durationMs
  };
}
