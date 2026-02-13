import { buildEvidencePackV2, fingerprintEvidenceCandidate } from '../evidence/evidencePackV2.js';

export function buildEvidencePack({
  source,
  pageData,
  adapterExtra,
  config,
  targetFields = [],
  deterministicCandidates = []
}) {
  return buildEvidencePackV2({
    source,
    pageData,
    adapterExtra,
    config,
    targetFields,
    deterministicCandidates
  });
}

export function buildEvidenceCandidateFingerprint(candidate) {
  return fingerprintEvidenceCandidate(candidate);
}
