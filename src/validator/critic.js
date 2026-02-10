function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined';
}

function parseNumber(value) {
  const match = String(value || '').match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(value) {
  const token = normalizeToken(value);
  if (!token) {
    return '';
  }
  if (['true', 'yes', 'y', '1', 'enabled', 'wireless'].includes(token)) {
    return 'yes';
  }
  if (['false', 'no', 'n', '0', 'disabled', 'wired'].includes(token)) {
    return 'no';
  }
  return '';
}

function inRange(value, min, max) {
  return value !== null && value >= min && value <= max;
}

function ensureProvenanceBucket(provenance, field) {
  if (!provenance[field]) {
    provenance[field] = {
      value: 'unk',
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

function applyAcceptedValue({ normalized, provenance, field, value, reason }) {
  normalized.fields[field] = value;
  const bucket = ensureProvenanceBucket(provenance, field);
  bucket.value = value;
  bucket.meets_pass_target = true;
  bucket.confidence = Math.max(0.9, Number(bucket.confidence || 0));
  bucket.evidence = [
    ...(Array.isArray(bucket.evidence) ? bucket.evidence : []),
    {
      url: 'critic://deterministic',
      host: 'critic.local',
      rootDomain: 'critic.local',
      tier: 1,
      tierName: 'manufacturer',
      method: 'critic_normalize',
      keyPath: `critic.${field}`,
      approvedDomain: true,
      reason
    }
  ];
}

function applyReject({ normalized, provenance, field, reason }) {
  normalized.fields[field] = 'unk';
  const bucket = ensureProvenanceBucket(provenance, field);
  bucket.value = 'unk';
  bucket.meets_pass_target = false;
  bucket.confidence = Math.min(0.2, Number(bucket.confidence || 0));
  bucket.evidence = [
    ...(Array.isArray(bucket.evidence) ? bucket.evidence : []),
    {
      url: 'critic://deterministic',
      host: 'critic.local',
      rootDomain: 'critic.local',
      tier: 1,
      tierName: 'manufacturer',
      method: 'critic_reject',
      keyPath: `critic.${field}`,
      approvedDomain: true,
      reason
    }
  ];
}

function normalizeNumericField(value, digits = 3) {
  const num = parseNumber(value);
  if (num === null) {
    return '';
  }
  const fixed = Number.parseFloat(num.toFixed(digits));
  return String(Number.isInteger(fixed) ? fixed : fixed);
}

export function runDeterministicCritic({
  normalized,
  provenance,
  fieldReasoning = {},
  categoryConfig,
  constraints = {}
}) {
  const decisions = {
    accept: [],
    reject: [],
    unknown: []
  };
  const fields = normalized?.fields || {};

  const booleanFields = new Set([
    'rgb',
    'bluetooth',
    'wireless_charging',
    'adjustable_weight',
    'honeycomb_frame',
    'silent_clicks',
    'flawless_sensor',
    'hardware_acceleration',
    'motion_sync',
    'hot_swappable',
    'tilt_scroll_wheel',
    'adjustable_scroll_wheel',
    'onboard_memory',
    'profile_switching'
  ]);

  for (const field of categoryConfig?.fieldOrder || Object.keys(fields || {})) {
    const value = fields[field];
    if (!hasValue(value)) {
      const unknownReason = fieldReasoning?.[field]?.unknown_reason || 'not_found_after_search';
      decisions.unknown.push({
        field,
        unknown_reason: unknownReason,
        next_best_queries: []
      });
      continue;
    }

    if (booleanFields.has(field)) {
      const normalizedBool = boolValue(value);
      if (normalizedBool) {
        if (normalizeToken(value) !== normalizedBool) {
          applyAcceptedValue({
            normalized,
            provenance,
            field,
            value: normalizedBool,
            reason: 'boolean_normalized'
          });
        }
        decisions.accept.push({
          field,
          value: normalizedBool,
          reason: 'boolean_normalized',
          evidence_refs: ['critic://deterministic'],
          confidence: 0.9
        });
      }
      continue;
    }

    if (['weight', 'lngth', 'width', 'height', 'dpi', 'ips', 'acceleration', 'polling_rate'].includes(field)) {
      const normalizedNumeric = normalizeNumericField(value, field === 'weight' ? 2 : 3);
      if (!normalizedNumeric) {
        applyReject({
          normalized,
          provenance,
          field,
          reason: 'non_numeric_value'
        });
        decisions.reject.push({
          field,
          value: String(value),
          reason: 'non_numeric_value'
        });
        continue;
      }

      const num = Number.parseFloat(normalizedNumeric);
      let plausible = true;
      if (field === 'weight') plausible = inRange(num, 10, 300);
      if (field === 'lngth' || field === 'width' || field === 'height') plausible = inRange(num, 20, 200);
      if (field === 'dpi') plausible = inRange(num, 100, 100000);
      if (field === 'ips') plausible = inRange(num, 10, 1000);
      if (field === 'acceleration') plausible = inRange(num, 5, 200);
      if (field === 'polling_rate') plausible = inRange(num, 50, 10000);

      const rangeConstraint = constraints?.fields?.[field]?.range;
      if (plausible && rangeConstraint) {
        const min = Number.parseFloat(String(rangeConstraint.min ?? Number.NEGATIVE_INFINITY));
        const max = Number.parseFloat(String(rangeConstraint.max ?? Number.POSITIVE_INFINITY));
        if (Number.isFinite(min) || Number.isFinite(max)) {
          plausible = inRange(num, Number.isFinite(min) ? min : -Infinity, Number.isFinite(max) ? max : Infinity);
        }
      }

      if (!plausible) {
        applyReject({
          normalized,
          provenance,
          field,
          reason: 'out_of_range'
        });
        decisions.reject.push({
          field,
          value: normalizedNumeric,
          reason: 'out_of_range'
        });
        continue;
      }

      if (String(value) !== normalizedNumeric) {
        applyAcceptedValue({
          normalized,
          provenance,
          field,
          value: normalizedNumeric,
          reason: 'unit_normalized'
        });
      }
      decisions.accept.push({
        field,
        value: normalizedNumeric,
        reason: 'unit_normalized',
        evidence_refs: ['critic://deterministic'],
        confidence: 0.9
      });
    }
  }

  // Negative cross-field constraints.
  const connection = normalizeToken(fields.connection || fields.connectivity || '');
  if (connection.includes('wired') && hasValue(fields.battery_hours)) {
    applyReject({
      normalized,
      provenance,
      field: 'battery_hours',
      reason: 'wired_product_battery_not_applicable'
    });
    normalized.fields.battery_hours = 'n/a';
    decisions.reject.push({
      field: 'battery_hours',
      value: String(fields.battery_hours),
      reason: 'wired_product_battery_not_applicable'
    });
  }

  return decisions;
}
