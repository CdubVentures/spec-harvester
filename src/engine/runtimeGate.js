function hasKnownValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.value || '').trim().toLowerCase() !== 'unk';
  }
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function toEvidenceProvenance(row = {}) {
  if (!row || typeof row !== 'object') {
    return {};
  }
  const firstEvidence = Array.isArray(row.evidence) ? (row.evidence[0] || {}) : {};
  return {
    url: row.url || firstEvidence.url || '',
    snippet_id: row.snippet_id || row.snippetId || firstEvidence.snippet_id || firstEvidence.snippetId || '',
    quote: row.quote || firstEvidence.quote || '',
    source_id: row.source_id || firstEvidence.source_id || '',
    snippet_hash: row.snippet_hash || firstEvidence.snippet_hash || ''
  };
}

export function applyRuntimeFieldRules({
  engine,
  fields = {},
  provenance = {},
  fieldOrder = [],
  enforceEvidence = false,
  strictEvidence = false,
  evidencePack = null,
  curationQueue = null
}) {
  if (!engine) {
    return {
      applied: false,
      fields: { ...fields },
      failures: [],
      warnings: [],
      changes: [],
      curation_suggestions: []
    };
  }

  const orderedFields = Array.isArray(fieldOrder) && fieldOrder.length > 0
    ? fieldOrder
    : Object.keys(fields || {});
  const nextFields = { ...fields };
  const failures = [];
  const warnings = [];
  const changes = [];
  const runtimeCurationQueue = Array.isArray(curationQueue) ? curationQueue : [];

  // Pass 1: per-field normalization + enum/range/shape.
  for (const field of orderedFields) {
    const before = nextFields[field];
    if (!hasKnownValue(before)) {
      continue;
    }
    const normalized = engine.normalizeCandidate(field, before, {
      curationQueue: runtimeCurationQueue
    });
    if (!normalized.ok) {
      nextFields[field] = 'unk';
      failures.push({
        field,
        stage: 'normalize',
        reason_code: normalized.reason_code || 'normalize_failed'
      });
      changes.push({
        field,
        stage: 'normalize',
        before,
        after: 'unk'
      });
      continue;
    }
    nextFields[field] = normalized.normalized;
    if (JSON.stringify(before) !== JSON.stringify(normalized.normalized)) {
      changes.push({
        field,
        stage: 'normalize',
        before,
        after: normalized.normalized
      });
    }
  }

  // Pass 2: cross-field validation.
  for (const field of orderedFields) {
    const value = nextFields[field];
    if (!hasKnownValue(value)) {
      continue;
    }
    const cross = engine.crossValidate(field, value, nextFields);
    if (!cross.ok) {
      const hasError = (cross.violations || []).some((row) => row.severity === 'error');
      if (hasError) {
        const before = nextFields[field];
        nextFields[field] = 'unk';
        failures.push({
          field,
          stage: 'cross_validate',
          reason_code: 'cross_validation_failed',
          violations: cross.violations || []
        });
        changes.push({
          field,
          stage: 'cross_validate',
          before,
          after: 'unk'
        });
      } else {
        warnings.push({
          field,
          stage: 'cross_validate',
          reason_code: 'cross_validation_warning',
          violations: cross.violations || []
        });
      }
    }
  }

  // Pass 3: optional strict evidence gate.
  if (enforceEvidence) {
    for (const field of orderedFields) {
      const value = nextFields[field];
      if (!hasKnownValue(value)) {
        continue;
      }
      const audit = engine.auditEvidence(
        field,
        value,
        toEvidenceProvenance(provenance[field]),
        {
          evidencePack,
          strictEvidence: Boolean(strictEvidence || enforceEvidence)
        }
      );
      if (!audit.ok) {
        const before = nextFields[field];
        nextFields[field] = 'unk';
        failures.push({
          field,
          stage: 'evidence',
          reason_code: audit.reason_code || 'evidence_missing',
          missing: audit.missing || []
        });
        changes.push({
          field,
          stage: 'evidence',
          before,
          after: 'unk'
        });
      }
    }
  }

  return {
    applied: true,
    fields: nextFields,
    failures,
    warnings,
    changes,
    curation_suggestions: runtimeCurationQueue
  };
}
