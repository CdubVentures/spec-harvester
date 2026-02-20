/**
 * Sitemap Inventory Mode (IP04-4D).
 *
 * Parses sitemap.xml files to inventory product URLs per domain.
 * Used for discovery prioritization — knowing which URLs exist
 * before searching, enabling targeted fetching.
 */

/**
 * Parse a sitemap XML string into URL entries.
 * Handles both <urlset> and <sitemapindex> formats.
 */
export function parseSitemapXml(xml) {
  const raw = String(xml || '').trim();
  if (!raw || !raw.includes('<')) return [];

  const isSitemapIndex = raw.includes('<sitemapindex');

  if (isSitemapIndex) {
    return parseSitemapIndex(raw);
  }

  return parseUrlset(raw);
}

function parseUrlset(xml) {
  const entries = [];
  const urlRegex = /<url>\s*([\s\S]*?)\s*<\/url>/gi;
  let match;

  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    const loc = extractTag(block, 'loc');
    if (!loc) continue;

    entries.push({
      loc,
      lastmod: extractTag(block, 'lastmod') || null,
      changefreq: extractTag(block, 'changefreq') || null,
      priority: extractTag(block, 'priority') || null,
      isSitemapIndex: false
    });
  }

  return entries;
}

function parseSitemapIndex(xml) {
  const entries = [];
  const smRegex = /<sitemap>\s*([\s\S]*?)\s*<\/sitemap>/gi;
  let match;

  while ((match = smRegex.exec(xml)) !== null) {
    const block = match[1];
    const loc = extractTag(block, 'loc');
    if (!loc) continue;

    entries.push({
      loc,
      lastmod: extractTag(block, 'lastmod') || null,
      isSitemapIndex: true
    });
  }

  return entries;
}

function extractTag(block, tag) {
  const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Build an inventory summary from parsed sitemap URLs.
 */
export function buildSitemapInventory({ domain, urls = [] } = {}) {
  const pathCounts = {};

  for (const entry of urls) {
    if (entry.isSitemapIndex) continue;
    try {
      const parsed = new URL(entry.loc);
      const segments = parsed.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        const prefix = `/${segments[0]}/`;
        pathCounts[prefix] = (pathCounts[prefix] || 0) + 1;
      }
    } catch {
      // skip malformed URLs
    }
  }

  const pathPatterns = Object.entries(pathCounts)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  return {
    domain: String(domain || ''),
    total_urls: urls.filter((u) => !u.isSitemapIndex).length,
    urls: urls.filter((u) => !u.isSitemapIndex),
    path_patterns: pathPatterns,
    inventoried_at: new Date().toISOString()
  };
}

/**
 * Filter URLs by path patterns and/or keywords.
 */
export function filterProductUrls({ urls = [], pathPatterns = [], keywords = [] } = {}) {
  let filtered = urls.filter((u) => !u.isSitemapIndex);

  if (pathPatterns.length > 0) {
    filtered = filtered.filter((entry) => {
      const loc = String(entry.loc || '').toLowerCase();
      return pathPatterns.some((p) => loc.includes(String(p).toLowerCase()));
    });
  }

  if (keywords.length > 0) {
    filtered = filtered.filter((entry) => {
      const loc = String(entry.loc || '').toLowerCase();
      return keywords.some((kw) => loc.includes(String(kw).toLowerCase()));
    });
  }

  return filtered;
}
