function normalizeField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function hasKnownValue(value) {
  const token = normalizeText(value).toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

const PROPERTY_FIELD_MAP = {
  max_dpi: 'dpi',
  max_ips: 'ips',
  max_acceleration: 'acceleration',
  polling_rate: 'polling_rate',
  switch_force: 'click_force'
};

function dedupeCandidates(candidates = []) {
  const seen = new Set();
  const out = [];
  for (const row of candidates || []) {
    const key = [
      normalizeField(row?.field),
      normalizeText(row?.value),
      normalizeText(row?.method),
      normalizeText(row?.keyPath)
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
  }
  return out;
}

function scoreCandidate(candidate = {}) {
  const method = String(candidate.method || '').toLowerCase();
  if (method === 'spec_table_match') {
    return 4;
  }
  if (method === 'parse_template') {
    return 3;
  }
  if (method === 'json_ld') {
    return 2;
  }
  return 1;
}

function bestCandidate(candidates = []) {
  return [...(candidates || [])]
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .find((row) => hasKnownValue(row?.value)) || null;
}

export class ComponentResolver {
  constructor(engine) {
    this.engine = engine;
  }

  componentFieldFromProperty(propertyKey, allRuleKeys = new Set()) {
    const normalized = normalizeField(propertyKey);
    if (allRuleKeys.has(normalized)) {
      return normalized;
    }
    const mapped = PROPERTY_FIELD_MAP[normalized];
    if (mapped && allRuleKeys.has(mapped)) {
      return mapped;
    }
    return mapped || normalized;
  }

  resolveFromCandidates(fieldCandidates = []) {
    const allRules = typeof this.engine?.getAllRules === 'function'
      ? this.engine.getAllRules()
      : {};
    const allRuleKeys = new Set(Object.keys(allRules || {}).map((field) => normalizeField(field)).filter(Boolean));
    const byField = new Map();

    for (const candidate of fieldCandidates || []) {
      const field = normalizeField(candidate?.field);
      if (!field) {
        continue;
      }
      if (!byField.has(field)) {
        byField.set(field, []);
      }
      byField.get(field).push(candidate);
    }

    const inferred = [];
    for (const [field, rule] of Object.entries(allRules || {})) {
      const normalizedField = normalizeField(field);
      if (!normalizeText(rule?.component_db_ref)) {
        continue;
      }
      const candidates = byField.get(normalizedField) || [];
      if (!candidates.length) {
        continue;
      }
      const base = bestCandidate(candidates);
      if (!base) {
        continue;
      }

      const match = this.engine?.fuzzyMatchComponent?.(
        normalizeText(rule.component_db_ref),
        normalizeText(base.value),
        0.7
      );
      if (!match?.match || !match?.match?.properties || typeof match.match.properties !== 'object') {
        continue;
      }

      for (const [property, rawValue] of Object.entries(match.match.properties || {})) {
        const mappedField = this.componentFieldFromProperty(property, allRuleKeys);
        if (!mappedField || !hasKnownValue(rawValue)) {
          continue;
        }
        if (byField.has(mappedField) && (byField.get(mappedField) || []).some((row) => hasKnownValue(row?.value))) {
          continue;
        }

        inferred.push({
          field: mappedField,
          value: String(rawValue),
          method: 'component_db_inference',
          keyPath: `component_db.${normalizeField(rule.component_db_ref)}.${normalizeField(property)}`,
          evidenceRefs: Array.isArray(base.evidenceRefs) ? [...base.evidenceRefs] : [],
          inferredFrom: {
            field: normalizedField,
            value: base.value
          },
          confidence: 0.85
        });
      }
    }

    return dedupeCandidates([
      ...(fieldCandidates || []),
      ...inferred
    ]);
  }
}

