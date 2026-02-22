import { normalizeFieldList, toRawFieldKey } from '../../utils/fieldKeys.js';
import {
  availabilityClassForField,
  undisclosedThresholdForField
} from '../../learning/fieldAvailability.js';
import { isDiscoveryOnlySourceUrl } from './urlHelpers.js';
import { executeConsensusPhase } from '../consensusPhase.js';
import { computeCompletenessRequired } from '../../scoring/qualityScoring.js';
import { buildHypothesisQueue } from '../../learning/hypothesisQueue.js';

export function buildFieldReasoning({
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

export function emitFieldDecisionEvents({
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

export function buildProvisionalHypothesisQueue({
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
  const consensus = executeConsensusPhase({
    sourceResults,
    categoryConfig,
    fieldOrder,
    anchors,
    identityLock,
    productId,
    category,
    config,
    fieldRulesEngine: null
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
