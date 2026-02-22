export function createEmptyProvenance(fieldOrder, fields) {
  const output = {};
  for (const key of fieldOrder) {
    output[key] = {
      value: fields[key],
      confirmations: 0,
      approved_confirmations: 0,
      pass_target: 0,
      meets_pass_target: false,
      confidence: 0,
      evidence: []
    };
  }
  return output;
}

export function ensureProvenanceField(provenance, field, fallbackValue = 'unk') {
  if (!provenance[field]) {
    provenance[field] = {
      value: fallbackValue,
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

export function mergePhase08Rows(existing = [], incoming = [], maxRows = 400) {
  const out = [...(existing || [])];
  const seen = new Set(
    out.map((row) => `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`)
  );
  for (const row of incoming || []) {
    const key = `${row?.field_key || ''}|${row?.snippet_id || ''}|${row?.url || ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(row);
    if (out.length >= Math.max(1, Number.parseInt(String(maxRows || 400), 10) || 400)) {
      break;
    }
  }
  return out;
}

export function buildPhase08SummaryFromBatches(batchRows = []) {
  const rows = Array.isArray(batchRows) ? batchRows : [];
  const batchCount = rows.length;
  const batchErrors = rows.filter((row) => String(row?.status || '').trim().toLowerCase() === 'failed').length;
  const rawCandidateCount = rows.reduce((sum, row) => sum + Number(row?.raw_candidate_count || 0), 0);
  const acceptedCandidateCount = rows.reduce((sum, row) => sum + Number(row?.accepted_candidate_count || 0), 0);
  const danglingRefCount = rows.reduce((sum, row) => sum + Number(row?.dropped_invalid_refs || 0), 0);
  const policyViolationCount = rows.reduce(
    (sum, row) => sum
      + Number(row?.dropped_missing_refs || 0)
      + Number(row?.dropped_invalid_refs || 0)
      + Number(row?.dropped_evidence_verifier || 0),
    0
  );
  const minRefsSatisfiedCount = rows.reduce((sum, row) => sum + Number(row?.min_refs_satisfied_count || 0), 0);
  const minRefsTotal = rows.reduce((sum, row) => sum + Number(row?.min_refs_total || 0), 0);
  return {
    batch_count: batchCount,
    batch_error_count: batchErrors,
    schema_fail_rate: batchCount > 0 ? Number((batchErrors / batchCount).toFixed(6)) : 0,
    raw_candidate_count: rawCandidateCount,
    accepted_candidate_count: acceptedCandidateCount,
    dangling_snippet_ref_count: danglingRefCount,
    dangling_snippet_ref_rate: rawCandidateCount > 0 ? Number((danglingRefCount / rawCandidateCount).toFixed(6)) : 0,
    evidence_policy_violation_count: policyViolationCount,
    evidence_policy_violation_rate: rawCandidateCount > 0 ? Number((policyViolationCount / rawCandidateCount).toFixed(6)) : 0,
    min_refs_satisfied_count: minRefsSatisfiedCount,
    min_refs_total: minRefsTotal,
    min_refs_satisfied_rate: minRefsTotal > 0 ? Number((minRefsSatisfiedCount / minRefsTotal).toFixed(6)) : 0
  };
}

export function tsvRowFromFields(fieldOrder, fields) {
  return fieldOrder.map((field) => fields[field] ?? 'unk').join('\t');
}
