function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompactToken(value) {
  return normalizeToken(value).replace(/[^a-z0-9]+/g, '');
}

function hasValue(value) {
  const token = normalizeToken(value);
  return token !== '' && token !== 'unk' && token !== 'null' && token !== 'undefined';
}

function parseNumberWithUnit(value, { allowK = false } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    return { value: null, unit: '' };
  }

  const normalized = text.replace(/,/g, '.').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*([a-z%]+)?/i);
  if (!match) {
    return { value: null, unit: '' };
  }

  let numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric)) {
    return { value: null, unit: '' };
  }

  let unit = normalizeToken(match[2] || '');
  if (allowK && !unit && /k\b/i.test(normalized)) {
    unit = 'k';
  }
  if (unit === 'k') {
    numeric *= 1000;
    unit = '';
  }

  return {
    value: numeric,
    unit
  };
}

function parseNumber(value) {
  const parsed = parseNumberWithUnit(value);
  if (parsed.value === null) {
    return null;
  }
  return parsed.value;
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

function canonicalizeFromEnumSpec(field, value, constraints = {}) {
  const fieldConstraint = constraints?.fields?.[field] || {};
  const aliases = fieldConstraint.aliases && typeof fieldConstraint.aliases === 'object'
    ? fieldConstraint.aliases
    : {};
  const enumValues = Array.isArray(fieldConstraint.enum) ? fieldConstraint.enum : [];
  const token = normalizeToken(value);
  const compact = normalizeCompactToken(value);

  for (const [alias, canonical] of Object.entries(aliases)) {
    if (normalizeToken(alias) === token || normalizeCompactToken(alias) === compact) {
      return {
        matched: true,
        canonical: String(canonical)
      };
    }
  }

  for (const enumValue of enumValues) {
    if (normalizeToken(enumValue) === token || normalizeCompactToken(enumValue) === compact) {
      return {
        matched: true,
        canonical: String(enumValue)
      };
    }
  }

  return {
    matched: false,
    canonical: String(value || '')
  };
}

function canonicalizeConnectionFallback(value) {
  const token = normalizeToken(value);
  const compact = normalizeCompactToken(value);
  if (!token) {
    return '';
  }
  if (
    token.includes('dual') ||
    (token.includes('wireless') && token.includes('wired')) ||
    (compact.includes('24ghz') && token.includes('wired'))
  ) {
    return 'hybrid';
  }
  if (
    token.includes('wireless') ||
    token.includes('dongle') ||
    token.includes('receiver') ||
    token.includes('rf') ||
    compact.includes('24ghz')
  ) {
    return 'wireless';
  }
  if (token.includes('wired') || token.includes('usb')) {
    return 'wired';
  }
  return '';
}

function canonicalizeComponentAlias(field, value, categoryConfig = {}) {
  const aliasMap = categoryConfig?.helperContract?.components?.alias_map || {};
  const candidates = Array.isArray(aliasMap[field]) ? aliasMap[field] : [];
  const token = normalizeToken(value);
  const compact = normalizeCompactToken(value);
  if (!token || !candidates.length) {
    return '';
  }

  for (const canonical of candidates) {
    const canonicalToken = normalizeToken(canonical);
    const canonicalCompact = normalizeCompactToken(canonical);
    if (
      token === canonicalToken ||
      compact === canonicalCompact ||
      token.includes(canonicalToken) ||
      canonicalToken.includes(token)
    ) {
      return String(canonical);
    }
  }
  return '';
}

function convertNumericToCanonical(field, value) {
  const allowK = field === 'dpi';
  const parsed = parseNumberWithUnit(value, { allowK });
  if (parsed.value === null) {
    return '';
  }

  let numeric = parsed.value;
  const unit = parsed.unit;

  if (field === 'weight') {
    if (unit === 'kg') {
      numeric *= 1000;
    } else if (unit === 'oz') {
      numeric *= 28.3495;
    } else if (unit === 'lb' || unit === 'lbs') {
      numeric *= 453.592;
    }
  }

  if (field === 'lngth' || field === 'width' || field === 'height') {
    if (unit === 'in' || unit === 'inch' || unit === 'inches') {
      numeric *= 25.4;
    } else if (unit === 'cm') {
      numeric *= 10;
    }
  }

  const rounded = Math.round(numeric);
  return Number.isFinite(rounded) ? String(rounded) : '';
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

    const fieldConstraint = constraints?.fields?.[field] || {};
    const fieldType = normalizeToken(fieldConstraint.type || '');

    if (fieldType === 'list') {
      const enumCheck = canonicalizeFromEnumSpec(field, value, constraints);
      if (enumCheck.matched) {
        if (String(value) !== enumCheck.canonical) {
          applyAcceptedValue({
            normalized,
            provenance,
            field,
            value: enumCheck.canonical,
            reason: 'enum_alias_normalized'
          });
        }
        decisions.accept.push({
          field,
          value: enumCheck.canonical,
          reason: 'enum_alias_normalized',
          evidence_refs: ['critic://deterministic'],
          confidence: 0.9
        });
      }
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

    if (fieldType === 'string') {
      const enumCheck = canonicalizeFromEnumSpec(field, value, constraints);
      let nextValue = enumCheck.matched ? enumCheck.canonical : String(value);

      if (!enumCheck.matched && field === 'connection') {
        const fallback = canonicalizeConnectionFallback(value);
        if (fallback) {
          nextValue = fallback;
        }
      }

      const componentCanonical = canonicalizeComponentAlias(field, nextValue, categoryConfig);
      if (componentCanonical) {
        nextValue = componentCanonical;
      }

      if (String(value) !== String(nextValue)) {
        applyAcceptedValue({
          normalized,
          provenance,
          field,
          value: nextValue,
          reason: enumCheck.matched ? 'enum_alias_normalized' : 'component_alias_normalized'
        });
      }
      decisions.accept.push({
        field,
        value: nextValue,
        reason: enumCheck.matched ? 'enum_alias_normalized' : 'string_normalized',
        evidence_refs: ['critic://deterministic'],
        confidence: 0.9
      });
      continue;
    }

    if (['weight', 'lngth', 'width', 'height', 'dpi', 'ips', 'acceleration', 'polling_rate'].includes(field)) {
      const normalizedNumeric = convertNumericToCanonical(field, value) || normalizeNumericField(value, field === 'weight' ? 2 : 3);
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
