import { nowIso, parseNumber } from '../utils/common.js';

function round(value, digits = 6) {
  return Number.parseFloat(Number(value || 0).toFixed(digits));
}

function createFieldConstraint() {
  return {
    count: 0,
    numeric: {
      count: 0,
      min: null,
      max: null,
      avg: 0
    },
    allowed_values: {}
  };
}

function ensureField(artifact, field) {
  if (!artifact.fields[field]) {
    artifact.fields[field] = createFieldConstraint();
  }
  return artifact.fields[field];
}

function trimAllowedValues(map, maxEntries = 120) {
  const sorted = Object.entries(map || {})
    .sort((a, b) => (b[1] || 0) - (a[1] || 0) || a[0].localeCompare(b[0]))
    .slice(0, maxEntries);
  return Object.fromEntries(sorted);
}

function updateNumeric(row, num) {
  row.numeric.count += 1;
  row.numeric.min = row.numeric.min === null ? num : Math.min(row.numeric.min, num);
  row.numeric.max = row.numeric.max === null ? num : Math.max(row.numeric.max, num);
  const previousAvg = Number.parseFloat(String(row.numeric.avg || 0)) || 0;
  row.numeric.avg = round(
    ((previousAvg * (row.numeric.count - 1)) + num) / Math.max(1, row.numeric.count),
    6
  );
}

function updateValueSet(row, value) {
  row.allowed_values[value] = (row.allowed_values[value] || 0) + 1;
  row.allowed_values = trimAllowedValues(row.allowed_values);
}

function updateCrossRules(artifact, normalized) {
  artifact.cross_field_rules = artifact.cross_field_rules || {};
  const connection = String(normalized?.fields?.connection || '').toLowerCase();
  const battery = String(normalized?.fields?.battery_hours || '').toLowerCase();
  if (!connection || connection === 'unk') {
    return;
  }

  if (!artifact.cross_field_rules.connection_battery_hours) {
    artifact.cross_field_rules.connection_battery_hours = {
      when_connection: {},
      updated_at: nowIso()
    };
  }

  const rules = artifact.cross_field_rules.connection_battery_hours.when_connection;
  if (!rules[connection]) {
    rules[connection] = {};
  }
  const bucketKey = battery || 'unk';
  rules[connection][bucketKey] = (rules[connection][bucketKey] || 0) + 1;
  artifact.cross_field_rules.connection_battery_hours.updated_at = nowIso();
}

export function defaultFieldConstraints() {
  return {
    version: 1,
    updated_at: nowIso(),
    fields: {},
    cross_field_rules: {},
    stats: {
      updates_total: 0,
      validated_updates: 0
    }
  };
}

export function updateFieldConstraints({
  artifact,
  normalized,
  validated = false,
  seenAt = nowIso()
}) {
  const next = artifact && typeof artifact === 'object'
    ? artifact
    : defaultFieldConstraints();
  next.stats = next.stats || {
    updates_total: 0,
    validated_updates: 0
  };
  next.stats.updates_total += 1;

  if (!validated) {
    next.updated_at = seenAt;
    return next;
  }

  next.stats.validated_updates += 1;
  for (const [field, rawValue] of Object.entries(normalized?.fields || {})) {
    const value = String(rawValue || '').trim();
    if (!value || value.toLowerCase() === 'unk' || value.toLowerCase() === 'n/a') {
      continue;
    }
    const row = ensureField(next, field);
    row.count += 1;
    const num = parseNumber(value);
    if (num !== null) {
      updateNumeric(row, num);
      continue;
    }
    updateValueSet(row, value.toLowerCase());
  }

  updateCrossRules(next, normalized);
  next.updated_at = seenAt;
  return next;
}
