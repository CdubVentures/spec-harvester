function toInt(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function unwrapPayload(row) {
  if (!row) return {};
  const p = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return { ...p, ...row, payload: undefined };
}

export function buildEvidenceSearchPayload({
  inventory = null,
  dedupeEvents = [],
  query = '',
  ftsResults = null
} = {}) {
  const events = Array.isArray(dedupeEvents) ? dedupeEvents : [];
  let newCount = 0;
  let reusedCount = 0;
  let updatedCount = 0;
  let totalChunksIndexed = 0;

  for (const evt of events) {
    const d = unwrapPayload(evt);
    const outcome = String(d.dedupe_outcome || '').trim();
    if (outcome === 'new') newCount += 1;
    else if (outcome === 'reused') reusedCount += 1;
    else if (outcome === 'updated') updatedCount += 1;
    totalChunksIndexed += toInt(d.chunks_indexed, 0);
  }

  const inv = inventory && typeof inventory === 'object' ? inventory : {};
  const fts = Array.isArray(ftsResults) ? ftsResults : [];

  return {
    query: String(query || ''),
    inventory: {
      documents: toInt(inv.documentCount, 0),
      chunks: toInt(inv.chunkCount, 0),
      facts: toInt(inv.factCount, 0),
      unique_hashes: toInt(inv.uniqueHashes, 0),
      dedupe_hits: toInt(inv.dedupeHits, 0)
    },
    dedupe_stream: {
      total: events.length,
      new_count: newCount,
      reused_count: reusedCount,
      updated_count: updatedCount,
      total_chunks_indexed: totalChunksIndexed
    },
    fts_search: {
      count: fts.length,
      rows: fts.map((row) => ({
        snippet_id: String(row.snippet_id || ''),
        url: String(row.url || ''),
        tier: toInt(row.tier, 0),
        text: String(row.text || '').slice(0, 500),
        rank: Number(row.rank) || 0
      }))
    }
  };
}
