/**
 * Cross-provider SERP deduplication (Phase 13).
 *
 * When the same URL appears from multiple search providers (Bing, Google,
 * SearXNG, DuckDuckGo), keep the best-ranked entry and merge provider
 * metadata. "Best ranked" = lowest array index in the original results.
 */

function normalizeUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    // Normalize: lowercase host, strip trailing slash, strip tracking params
    parsed.hostname = parsed.hostname.toLowerCase();
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'fbclid', 'gclid', 'msclkid', 'ref', 'source', 'mc_cid', 'mc_eid'
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }
    let path = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.pathname = path;
    return parsed.toString();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

/**
 * Deduplicate SERP results across providers.
 *
 * @param {Array} results - Array of search result objects with { url, provider, query, ... }
 * @returns {{ deduped: Array, stats: { total_input, total_output, duplicates_removed, providers_seen } }}
 */
export function dedupeSerpResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      deduped: [],
      stats: { total_input: 0, total_output: 0, duplicates_removed: 0, providers_seen: [] }
    };
  }

  const byCanonical = new Map();
  const providersSeen = new Set();

  for (let i = 0; i < results.length; i++) {
    const row = results[i];
    if (!row?.url) continue;

    const canonical = normalizeUrl(row.url);
    const provider = String(row.provider || 'unknown').trim().toLowerCase();
    providersSeen.add(provider);

    if (!byCanonical.has(canonical)) {
      byCanonical.set(canonical, {
        ...row,
        _canonical: canonical,
        _rank: i,
        _providers: [provider],
        _queries: row.query ? [row.query] : []
      });
    } else {
      const existing = byCanonical.get(canonical);
      // Keep the one with the best (lowest) rank
      if (i < existing._rank) {
        const mergedProviders = existing._providers;
        const mergedQueries = existing._queries;
        byCanonical.set(canonical, {
          ...row,
          _canonical: canonical,
          _rank: i,
          _providers: [...new Set([...mergedProviders, provider])],
          _queries: [...new Set([...mergedQueries, ...(row.query ? [row.query] : [])])]
        });
      } else {
        if (!existing._providers.includes(provider)) {
          existing._providers.push(provider);
        }
        if (row.query && !existing._queries.includes(row.query)) {
          existing._queries.push(row.query);
        }
      }
    }
  }

  const deduped = [...byCanonical.values()]
    .sort((a, b) => a._rank - b._rank)
    .map((entry) => {
      const { _canonical, _rank, _providers, _queries, ...rest } = entry;
      return {
        ...rest,
        canonical_url: _canonical,
        seen_by_providers: _providers,
        seen_in_queries: _queries,
        cross_provider_count: _providers.length
      };
    });

  return {
    deduped,
    stats: {
      total_input: results.length,
      total_output: deduped.length,
      duplicates_removed: results.length - deduped.length,
      providers_seen: [...providersSeen]
    }
  };
}
