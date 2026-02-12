import { clamp, getByPath } from '../utils/common.js';
import { normalizeRequiredFieldPath } from '../utils/fieldKeys.js';

function valueFilled(value) {
  if (value === undefined || value === null) {
    return false;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return false;
  }
  return text !== 'unk';
}

export function computeCompletenessRequired(normalized, requiredFieldsInput = []) {
  const requiredFields = requiredFieldsInput
    .map((path) => normalizeRequiredFieldPath(path))
    .filter(Boolean);

  const total = requiredFields.length;
  const missingRequiredFields = [];
  let filled = 0;

  for (const fieldPath of requiredFields) {
    const value = getByPath(normalized, fieldPath);
    if (valueFilled(value)) {
      filled += 1;
    } else {
      missingRequiredFields.push(fieldPath);
    }
  }

  const completenessRequired = total === 0 ? 0 : filled / total;

  return {
    requiredFields,
    missingRequiredFields,
    filled,
    total,
    completenessRequired
  };
}

export function computeCoverageOverall({ fields, fieldOrder, editorialFields }) {
  const editorialSet = new Set(editorialFields || []);
  const consideredFields = (fieldOrder || []).filter((field) => !editorialSet.has(field));

  let filled = 0;
  for (const field of consideredFields) {
    if (valueFilled(fields[field])) {
      filled += 1;
    }
  }

  const total = consideredFields.length;
  const coverageOverall = total === 0 ? 0 : filled / total;

  return {
    total,
    filled,
    coverageOverall,
    consideredFields
  };
}

export function computeConfidence({
  identityConfidence,
  provenance,
  anchorConflictsCount,
  agreementScore = 0
}) {
  const confidences = Object.values(provenance || {})
    .map((row) => row.confidence)
    .filter((value) => typeof value === 'number' && Number.isFinite(value));

  const provenanceConfidence = confidences.length
    ? confidences.reduce((acc, value) => acc + value, 0) / confidences.length
    : 0;

  let confidence = (identityConfidence * 0.5) + (provenanceConfidence * 0.35) + (agreementScore * 0.15);
  confidence -= Math.min(0.4, anchorConflictsCount * 0.06);

  return clamp(confidence, 0, 1);
}
