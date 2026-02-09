import { clamp, getByPath } from '../utils/common.js';
import { DEFAULT_REQUIRED_FIELDS } from '../constants.js';

function normalizeRequiredPath(path) {
  if (path.startsWith('specs.')) {
    return `fields.${path.slice('specs.'.length)}`;
  }
  return path;
}

function valueFilled(value) {
  return value !== undefined && value !== null && value !== '' && value !== 'unk';
}

export function computeCompleteness(normalized, requiredFieldsInput) {
  const requiredFields = (requiredFieldsInput || DEFAULT_REQUIRED_FIELDS).map(normalizeRequiredPath);
  const total = requiredFields.length;
  let filled = 0;

  for (const fieldPath of requiredFields) {
    const value = getByPath(normalized, fieldPath);
    if (valueFilled(value)) {
      filled += 1;
    }
  }

  return {
    requiredFields,
    filled,
    total,
    completeness: total === 0 ? 1 : filled / total
  };
}

export function computeConfidence({
  identityGate,
  provenance,
  conflictsCount,
  validated
}) {
  const perFieldConfidence = Object.values(provenance || {})
    .map((row) => row.confidence)
    .filter((v) => typeof v === 'number');

  const fieldAvg =
    perFieldConfidence.length > 0
      ? perFieldConfidence.reduce((acc, value) => acc + value, 0) / perFieldConfidence.length
      : 0;

  let confidence = (identityGate.certainty * 0.55) + (fieldAvg * 0.45);
  confidence -= Math.min(0.3, conflictsCount * 0.05);

  if (!validated) {
    confidence = Math.min(confidence, 0.5);
  }

  return clamp(confidence, 0, 1);
}
