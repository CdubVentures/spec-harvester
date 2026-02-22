export function isDiscoveryOnlySourceUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    const query = parsed.search.toLowerCase();
    if (path.endsWith('/robots.txt')) {
      return true;
    }
    if (path.includes('sitemap') || path.endsWith('.xml')) {
      return true;
    }
    if (path.includes('/search')) {
      return true;
    }
    if (path.includes('/catalogsearch') || path.includes('/find')) {
      return true;
    }
    if ((query.includes('q=') || query.includes('query=')) && path.length <= 16) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isRobotsTxtUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('/robots.txt');
  } catch {
    return false;
  }
}

export function isSitemapUrl(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return pathname.includes('sitemap') || pathname.endsWith('.xml');
  } catch {
    return false;
  }
}

export function hasSitemapXmlSignals(body) {
  const text = String(body || '').toLowerCase();
  return text.includes('<urlset') || text.includes('<sitemapindex') || text.includes('<loc>');
}

export function isLikelyIndexableEndpointUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.json') || path.endsWith('.js')) {
      return false;
    }
    if (path.includes('/api/') || path.includes('/graphql')) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function isSafeManufacturerFollowupUrl(source, url) {
  try {
    const parsed = new URL(url);
    const sourceRootDomain = String(source?.rootDomain || source?.host || '').toLowerCase();
    if (!sourceRootDomain) {
      return false;
    }
    const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    if (!host || (!host.endsWith(sourceRootDomain) && sourceRootDomain !== host)) {
      return false;
    }

    const path = parsed.pathname.toLowerCase();
    const signal = [
      '/support',
      '/manual',
      '/spec',
      '/product',
      '/products',
      '/download',
      '/sitemap'
    ];
    return signal.some((token) => path.includes(token));
  } catch {
    return false;
  }
}

export function isHelperSyntheticUrl(url) {
  const token = String(url || '').trim().toLowerCase();
  return token.startsWith('helper_files://');
}

export function isHelperSyntheticSource(source) {
  if (!source) {
    return false;
  }
  if (source.helperSource) {
    return true;
  }
  if (String(source.host || '').trim().toLowerCase() === 'helper-files.local') {
    return true;
  }
  return isHelperSyntheticUrl(source.url) || isHelperSyntheticUrl(source.finalUrl);
}
