import { verifyCandidateEvidence } from '../llm/evidenceVerifier.js';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFieldCandidates(candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((row) => ({
      ...row,
      field: String(row?.field || ''),
      value: String(row?.value ?? ''),
      confidence: Number.parseFloat(String(row?.confidence || 0)) || 0,
      evidenceRefs: Array.isArray(row?.evidenceRefs) ? row.evidenceRefs : [],
      snippetId: String(row?.snippetId || row?.snippet_id || ''),
      snippetHash: String(row?.snippetHash || row?.snippet_hash || ''),
      quote: String(row?.quote || ''),
      quoteSpan: Array.isArray(row?.quoteSpan) ? row.quoteSpan : (Array.isArray(row?.quote_span) ? row.quote_span : null)
    }))
    .filter((row) => row.field);
}

function sortByConfidence(candidates = []) {
  return [...candidates].sort((a, b) => (
    (Number(b.confidence || 0) - Number(a.confidence || 0))
    || String(a.value || '').localeCompare(String(b.value || ''))
  ));
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

export class EvidenceAuditor {
  constructor({
    config = {}
  } = {}) {
    this.batchSize = Math.max(1, toInt(config.aggressiveEvidenceAuditBatchSize, 60));
    this.requireQuote = true;
  }

  auditCandidates({
    productId = '',
    identity = {},
    candidatesByField = {},
    evidencePack = {}
  } = {}) {
    const audits = [];
    const acceptedByField = {};
    const rejectedByField = {};

    for (const [field, rawCandidates] of Object.entries(candidatesByField || {})) {
      const candidates = sortByConfidence(normalizeFieldCandidates(rawCandidates)).slice(0, 6);
      if (candidates.length === 0) {
        audits.push({
          field,
          best_candidate_index: -1,
          status: 'REJECT',
          reasons: ['no_candidates']
        });
        continue;
      }

      const candidateStatuses = [];
      for (let idx = 0; idx < candidates.length; idx += 1) {
        const candidate = candidates[idx];
        const verified = verifyCandidateEvidence({
          candidate,
          evidencePack
        });

        if (!verified.ok) {
          candidateStatuses.push({
            index: idx,
            status: 'REJECT',
            candidate,
            reasons: [String(verified.reason || 'evidence_rejected')]
          });
          continue;
        }

        const nextCandidate = verified.candidate || candidate;
        if (this.requireQuote && !String(nextCandidate.quote || '').trim()) {
          candidateStatuses.push({
            index: idx,
            status: 'REJECT',
            candidate: nextCandidate,
            reasons: ['missing_quote']
          });
          continue;
        }

        candidateStatuses.push({
          index: idx,
          status: 'ACCEPT',
          candidate: nextCandidate,
          reasons: []
        });
      }

      const accepted = candidateStatuses.filter((row) => row.status === 'ACCEPT');
      const distinctAcceptedValues = [...new Set(accepted.map((row) => String(row.candidate.value || '').trim().toLowerCase()).filter(Boolean))];

      if (accepted.length > 1 && distinctAcceptedValues.length > 1) {
        const best = accepted[0];
        audits.push({
          field,
          best_candidate_index: best.index,
          status: 'CONFLICT',
          reasons: ['multiple_supported_values'],
          confidence_override: Math.min(0.75, Number(best.candidate.confidence || 0.75))
        });
        rejectedByField[field] = candidateStatuses;
        continue;
      }

      if (accepted.length > 0) {
        const best = accepted[0];
        const normalizedBest = {
          ...best.candidate,
          field
        };
        acceptedByField[field] = [normalizedBest];
        audits.push({
          field,
          best_candidate_index: best.index,
          status: 'ACCEPT',
          reasons: [],
          confidence_override: Math.max(0, Math.min(1, Number(normalizedBest.confidence || 0.8)))
        });
      } else {
        const reasonSet = [...new Set(candidateStatuses.flatMap((row) => row.reasons || []))];
        audits.push({
          field,
          best_candidate_index: -1,
          status: 'REJECT',
          reasons: reasonSet.length > 0 ? reasonSet : ['unsupported_by_evidence']
        });
        rejectedByField[field] = candidateStatuses;
      }
    }

    const statusCounts = {
      accepted_fields: audits.filter((row) => normalizeStatus(row.status) === 'ACCEPT').length,
      rejected_fields: audits.filter((row) => normalizeStatus(row.status) === 'REJECT').length,
      conflicted_fields: audits.filter((row) => normalizeStatus(row.status) === 'CONFLICT').length
    };

    return {
      product_id: String(productId || ''),
      identity,
      audits,
      accepted_by_field: acceptedByField,
      rejected_by_field: rejectedByField,
      ...statusCounts
    };
  }
}
