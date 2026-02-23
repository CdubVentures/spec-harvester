// ── Unified Confidence Color ────────────────────────────────────────
//
// Single source of truth for mapping confidence + reason codes → cell color.
// Used by reviewGridData.js, componentReviewData.js, and the React UI.

/**
 * @param {number} confidence - 0..1
 * @param {string[]} [reasonCodes] - optional reason codes (e.g. 'constraint_conflict')
 * @returns {'green'|'yellow'|'red'|'gray'}
 */
export function confidenceColor(confidence, reasonCodes = []) {
  if (confidence <= 0) return 'gray';
  if (
    confidence < 0.6 ||
    reasonCodes.includes('constraint_conflict') ||
    reasonCodes.includes('compound_range_conflict')
  ) return 'red';
  if (confidence < 0.85) return 'yellow';
  return 'green';
}
