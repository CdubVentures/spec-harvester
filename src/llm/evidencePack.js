import { buildEvidencePackV2 } from '../evidence/evidencePackV2.js';

export function buildEvidencePack({
  source,
  pageData,
  adapterExtra,
  config,
  targetFields = []
}) {
  return buildEvidencePackV2({
    source,
    pageData,
    adapterExtra,
    config,
    targetFields
  });
}
