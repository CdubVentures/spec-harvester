const OUTCOME_KEY_MAP = {
  new: 'indexed_new',
  reused: 'dedupe_hit',
  updated: 'dedupe_updated'
};

export function dedupeOutcomeToEventKey(outcome) {
  return OUTCOME_KEY_MAP[String(outcome || '').trim()] || 'indexed_new';
}

export function buildDedupeOutcomeEvent({ indexResult, url, host }) {
  if (!indexResult) return null;
  return {
    dedupe_outcome: String(indexResult.dedupeOutcome || 'unknown'),
    doc_id: String(indexResult.docId || ''),
    chunks_indexed: Number(indexResult.chunksIndexed || 0),
    facts_indexed: Number(indexResult.factsIndexed || 0),
    snippet_count: Array.isArray(indexResult.snippetIds) ? indexResult.snippetIds.length : 0,
    url: String(url || ''),
    host: String(host || '')
  };
}
