import { isIdentityLockedField } from './identityHelpers.js';
import { normalizeFieldList } from '../../utils/fieldKeys.js';

export const PASS_TARGET_EXEMPT_FIELDS = new Set(['id', 'brand', 'model', 'base_model', 'category', 'sku']);

export function markSatisfiedLlmFields(fieldSet, fields = [], anchors = {}) {
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

export function refreshFieldsBelowPassTarget({
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

export function isAnchorLocked(field, anchors) {
  const value = anchors?.[field];
  return String(value || '').trim() !== '';
}

export function resolveTargets(job, categoryConfig) {
  return {
    targetCompleteness:
      job.requirements?.targetCompleteness ?? categoryConfig.schema.targets?.targetCompleteness ?? 0.9,
    targetConfidence:
      job.requirements?.targetConfidence ?? categoryConfig.schema.targets?.targetConfidence ?? 0.8
  };
}

export function resolveLlmTargetFields(job, categoryConfig) {
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
