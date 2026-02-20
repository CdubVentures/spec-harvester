function hasKnownValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String(value.value || '').trim().toLowerCase() !== 'unk';
  }
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function countDistinctEvidenceRefs(fieldProvenance) {
  const evidenceArray = Array.isArray(fieldProvenance?.evidence)
    ? fieldProvenance.evidence
    : [];
  const seen = new Set();
  for (const entry of evidenceArray) {
    const url = String(entry?.url || '').trim();
    const snippetId = String(entry?.snippet_id || entry?.snippetId || '').trim();
    if (!snippetId) {
      continue;
    }
    seen.add(`${url}\0${snippetId}`);
  }
  return seen.size;
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
    snippet_hash: row.snippet_hash || firstEvidence.snippet_hash || '',
    retrieved_at: row.retrieved_at || firstEvidence.retrieved_at || '',
    extraction_method: row.extraction_method || firstEvidence.extraction_method || '',
    quote_span: row.quote_span || firstEvidence.quote_span || null
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
  curationQueue = null,
  componentReviewQueue = null,
  identityObservations = null,
  extractedValues = null,
  respectPerFieldEvidence = true
}) {
  if (!engine) {
    return {
      applied: false,
      fields: { ...fields },
      failures: [],
      warnings: [],
      changes: [],
      curation_suggestions: [],
      component_review_items: [],
      identity_observations: []
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
  const runtimeComponentReviewQueue = Array.isArray(componentReviewQueue) ? componentReviewQueue : [];
  const runtimeIdentityObservations = Array.isArray(identityObservations) ? identityObservations : [];

  // Pass 1: per-field normalization + enum/range/shape.
  for (const field of orderedFields) {
    const before = nextFields[field];
    if (!hasKnownValue(before)) {
      continue;
    }
    const normalized = engine.normalizeCandidate(field, before, {
      curationQueue: runtimeCurationQueue,
      componentReviewQueue: runtimeComponentReviewQueue,
      identityObservations: runtimeIdentityObservations,
      extractedValues: extractedValues || fields,
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

  // Pass 1.5: list_rules enforcement — sort + min/max (dedupe already applied in normalizeCandidate).
  for (const field of orderedFields) {
    const value = nextFields[field];
    if (!Array.isArray(value)) {
      continue;
    }
    const rule = engine.getFieldRule(field);
    const listRules = rule?.contract?.list_rules;
    if (!listRules) {
      continue;
    }

    let list = value;

    // Sort
    if (listRules.sort === 'asc') {
      const isNumeric = list.length > 0 && list.every((item) => typeof item === 'number');
      list = [...list].sort(isNumeric
        ? (a, b) => a - b
        : (a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));
    } else if (listRules.sort === 'desc') {
      const isNumeric = list.length > 0 && list.every((item) => typeof item === 'number');
      list = [...list].sort(isNumeric
        ? (a, b) => b - a
        : (a, b) => String(b).toLowerCase().localeCompare(String(a).toLowerCase()));
    }

    // max_items — truncate deterministically
    if (typeof listRules.max_items === 'number' && listRules.max_items > 0 && list.length > listRules.max_items) {
      const before = list;
      list = list.slice(0, listRules.max_items);
      changes.push({
        field,
        stage: 'list_rules',
        rule: 'max_items_truncated',
        before,
        after: list
      });
    }

    // min_items — fail if below minimum
    if (typeof listRules.min_items === 'number' && listRules.min_items > 0 && list.length < listRules.min_items) {
      const before = list;
      nextFields[field] = 'unk';
      failures.push({
        field,
        stage: 'list_rules',
        reason_code: 'min_items_not_met',
        required: listRules.min_items,
        actual: list.length
      });
      changes.push({
        field,
        stage: 'list_rules',
        before,
        after: 'unk'
      });
      continue;
    }

    nextFields[field] = list;
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

  // Pass 3: evidence gate (global + per-field quality + per-field count).
  for (const field of orderedFields) {
    const value = nextFields[field];
    if (!hasKnownValue(value)) {
      continue;
    }
    const rule = engine.getFieldRule(field);
    const ruleEvidence = rule && typeof rule.evidence === 'object' ? rule.evidence : {};
    const minRefs = typeof ruleEvidence.min_evidence_refs === 'number'
      ? ruleEvidence.min_evidence_refs
      : 0;

    // Quality audit: validate the first evidence ref.
    const shouldAuditQuality = enforceEvidence
      || (respectPerFieldEvidence && (rule?.evidence_required || minRefs > 0));
    // Count audit: verify N distinct (url, snippet_id) pairs.
    const shouldCheckCount = minRefs > 1
      && (enforceEvidence || respectPerFieldEvidence);

    if (!shouldAuditQuality && !shouldCheckCount) {
      continue;
    }

    // Quality check on the first evidence ref.
    if (shouldAuditQuality) {
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
        continue;
      }
    }

    // Count check: require N distinct evidence refs.
    if (shouldCheckCount) {
      const distinctCount = countDistinctEvidenceRefs(provenance[field]);
      if (distinctCount < minRefs) {
        const before = nextFields[field];
        nextFields[field] = 'unk';
        failures.push({
          field,
          stage: 'evidence',
          reason_code: 'evidence_insufficient_refs',
          required: minRefs,
          actual: distinctCount
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
    curation_suggestions: runtimeCurationQueue,
    component_review_items: runtimeComponentReviewQueue,
    identity_observations: runtimeIdentityObservations
  };
}
