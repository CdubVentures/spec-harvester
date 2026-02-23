import { searchEvidenceByField, ftsResultsToEvidencePool } from '../index/evidenceIndexDb.js';

export function createFtsQueryFn({ db, category, productId }) {
  return ({ fieldKey, anchors, unitHint }) => {
    const queryTerms = Array.isArray(anchors) ? anchors : [];
    const ftsRawResults = searchEvidenceByField({
      db,
      category,
      productId,
      fieldKey,
      queryTerms,
      unitHint: unitHint || '',
      maxResults: 100
    });
    return ftsResultsToEvidencePool({ ftsResults: ftsRawResults });
  };
}
