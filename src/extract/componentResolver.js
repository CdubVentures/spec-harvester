import { evaluateAllConstraints } from '../engine/constraintEvaluator.js';

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
  switch_force: 'click_force',
  sensor_year: 'sensor_date'
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
    // If property key directly matches a field key, use it as-is (new field_key-based properties)
    if (allRuleKeys.has(normalized)) {
      return normalized;
    }
    // Fall back to legacy PROPERTY_FIELD_MAP for old-format property keys
    const mapped = PROPERTY_FIELD_MAP[normalized];
    if (mapped && allRuleKeys.has(mapped)) {
      return mapped;
    }
    // Only return mapped/normalized if it exists in rules — don't create orphaned candidates
    if (mapped && allRuleKeys.size === 0) {
      return mapped; // No rules loaded yet, trust the map
    }
    return null;
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
      const dbRef = normalizeText(rule?.component_db_ref || rule?.component?.type || '');
      if (!dbRef) {
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

      // Uses enum.match.fuzzy_threshold as the per-field fuzzy match threshold
      // for component DB matches. Falls back to 0.7 (looser for inference context).
      const rawThreshold = Number(rule?.enum?.match?.fuzzy_threshold);
      const inferenceThreshold = Number.isFinite(rawThreshold)
        ? Math.max(0, Math.min(1, rawThreshold))
        : 0.7;
      const match = this.engine?.fuzzyMatchComponent?.(
        dbRef,
        normalizeText(base.value),
        inferenceThreshold
      );
      if (!match?.match || !match?.match?.properties || typeof match.match.properties !== 'object') {
        continue;
      }

      // Extract variance policy metadata if present in the compiled component DB
      const variancePolicies = match.match.__variance_policies || {};

      for (const [property, rawValue] of Object.entries(match.match.properties || {})) {
        const mappedField = this.componentFieldFromProperty(property, allRuleKeys);
        if (!mappedField || !hasKnownValue(rawValue)) {
          continue;
        }
        if (byField.has(mappedField) && (byField.get(mappedField) || []).some((row) => hasKnownValue(row?.value))) {
          continue;
        }

        // Determine confidence based on variance_policy, weighted by match quality
        const variancePolicy = variancePolicies[property] || 'authoritative';
        const VARIANCE_CONFIDENCE = {
          authoritative: 0.85,
          upper_bound: 0.80,
          lower_bound: 0.80,
          range: 0.75,
          override_allowed: 0.60,
        };
        const baseConf = VARIANCE_CONFIDENCE[variancePolicy] ?? 0.70;
        // Scale confidence by match quality: exact match (1.0) = full confidence,
        // threshold match (~0.7) = ~85% of base confidence
        const matchScore = typeof match.score === 'number' ? match.score : 1.0;
        const matchFactor = 0.85 + 0.15 * matchScore; // range: 0.85–1.0
        let confidence = Math.round(baseConf * matchFactor * 100) / 100;

        const inferenceEntry = {
          field: mappedField,
          value: String(rawValue),
          method: 'component_db_inference',
          keyPath: `component_db.${normalizeField(dbRef)}.${normalizeField(property)}`,
          evidenceRefs: Array.isArray(base.evidenceRefs) ? [...base.evidenceRefs] : [],
          inferredFrom: {
            field: normalizedField,
            value: base.value
          },
          confidence
        };

        // Attach variance metadata for downstream consumers
        if (variancePolicy !== 'authoritative') {
          inferenceEntry.variance = variancePolicy;
        }

        inferred.push(inferenceEntry);
      }
    }

    // ── Constraint evaluation ──────────────────────────────────────
    // Build product values from existing field candidates (best value per field)
    if (inferred.length > 0) {
      const productValues = {};
      for (const [field, candidates] of byField.entries()) {
        const best = bestCandidate(candidates);
        if (best && hasKnownValue(best.value)) {
          productValues[field] = best.value;
        }
      }
      // Also add inferred values to product values for cross-checking
      for (const entry of inferred) {
        if (entry.field && hasKnownValue(entry.value) && !productValues[entry.field]) {
          productValues[entry.field] = entry.value;
        }
      }

      // Evaluate constraints from matched component entities
      // Group inferred entries by their source component
      const inferredBySource = new Map();
      for (const entry of inferred) {
        if (!entry.inferredFrom) continue;
        const sourceKey = `${entry.keyPath?.split('.')[1] || ''}:${entry.inferredFrom.value}`;
        if (!inferredBySource.has(sourceKey)) {
          inferredBySource.set(sourceKey, { entries: [], dbRef: entry.keyPath?.split('.')[1], query: entry.inferredFrom.value });
        }
        inferredBySource.get(sourceKey).entries.push(entry);
      }

      for (const [, group] of inferredBySource) {
        const match = this.engine?.fuzzyMatchComponent?.(group.dbRef, normalizeText(group.query), 0.7);
        if (!match?.match) continue;

        const componentProps = match.match.properties || {};
        const constraintMap = match.match.__constraints;
        if (!constraintMap || typeof constraintMap !== 'object' || Array.isArray(constraintMap)) continue;

        // Build pseudo-mappings from the constraint map for evaluateAllConstraints
        const mappings = Object.entries(constraintMap).map(([propKey, exprs]) => ({
          key: propKey,
          field_key: propKey,
          constraints: Array.isArray(exprs) ? exprs : [],
        }));

        let results;
        try {
          results = evaluateAllConstraints(mappings, componentProps, productValues);
        } catch (_constraintErr) {
          // Constraint evaluation failed — skip constraints, don't kill resolution
          continue;
        }
        const violations = results.filter((r) => !r.pass && !r.skipped);

        if (violations.length > 0) {
          // Build set of property keys that actually violated
          const violatedKeys = new Set(violations.map((v) => normalizeField(v.propertyKey || '')).filter(Boolean));

          for (const entry of group.entries) {
            // Extract the property key from the keyPath (component_db.{type}.{property})
            const entryPropKey = normalizeField((entry.keyPath || '').split('.').pop() || '');
            const isDirectlyViolated = violatedKeys.has(entryPropKey) || violatedKeys.has(normalizeField(entry.field || ''));

            if (isDirectlyViolated) {
              // Directly violated — full penalty
              entry.constraintViolations = violations.filter((v) => normalizeField(v.propertyKey || '') === entryPropKey).map((v) => ({
                expr: v.expr,
                message: v.message,
                propertyKey: v.propertyKey,
              }));
              entry.confidence = Math.max(0.1, (entry.confidence || 0.85) * 0.5);
            } else {
              // Not directly violated — attach info but lighter penalty
              entry.constraintWarnings = violations.map((v) => ({
                expr: v.expr,
                message: v.message,
                propertyKey: v.propertyKey,
              }));
              entry.confidence = Math.max(0.3, (entry.confidence || 0.85) * 0.85);
            }
          }
        }
      }
    }

    return dedupeCandidates([
      ...(fieldCandidates || []),
      ...inferred
    ]);
  }
}

