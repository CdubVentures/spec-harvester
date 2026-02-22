function mapUpdate(update) {
  return {
    field: update.field,
    value: update.value,
    evidence_refs: Array.isArray(update.evidenceRefs) ? update.evidenceRefs : [],
    acceptance_stats: update.acceptanceStats || {},
    source_run_id: update.sourceRunId || null
  };
}

export function buildSearchHints(acceptedUpdates) {
  return (acceptedUpdates || []).map(mapUpdate);
}

export function buildAnchorsSuggestions(acceptedUpdates) {
  return (acceptedUpdates || []).map(mapUpdate);
}

export function buildKnownValuesSuggestions(acceptedUpdates) {
  return (acceptedUpdates || []).map(mapUpdate);
}
