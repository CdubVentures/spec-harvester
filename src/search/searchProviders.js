function normalizeProvider(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'google_cse') {
    return 'google';
  }
  if (token === 'google' || token === 'bing' || token === 'dual' || token === 'none') {
    return token;
  }
  return 'none';
}

function normalizeBingEndpoint(value) {
  if (!value) {
    return '';
  }
  const url = new URL(value);
  if (!url.pathname || url.pathname === '/') {
    url.pathname = '/v7.0/search';
  }
  return url.toString();
}

export async function searchBing({
  endpoint,
  key,
  query,
  limit = 10
}) {
  if (!endpoint || !key || !query) {
    return [];
  }
  const url = new URL(normalizeBingEndpoint(endpoint));
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(50, Math.max(1, limit))));

  const response = await fetch(url, {
    headers: {
      'Ocp-Apim-Subscription-Key': key
    }
  });
  if (!response.ok) {
    return [];
  }
  const payload = await response.json();
  return (payload.webPages?.value || []).map((item) => ({
    url: item.url,
    title: item.name || '',
    snippet: item.snippet || '',
    provider: 'bing',
    query
  }));
}

export async function searchGoogleCse({
  key,
  cx,
  query,
  limit = 10
}) {
  if (!key || !cx || !query) {
    return [];
  }
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(Math.min(10, Math.max(1, limit))));
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  const payload = await response.json();
  return (payload.items || []).map((item) => ({
    url: item.link,
    title: item.title || '',
    snippet: item.snippet || '',
    provider: 'google',
    query
  }));
}

function dedupeResults(rows = []) {
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const url = String(row.url || '').trim();
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push(row);
  }
  return out;
}

export async function runSearchProviders({
  config,
  query,
  limit = 10,
  logger
}) {
  const provider = normalizeProvider(config.searchProvider);
  if (provider === 'none') {
    return [];
  }

  const tasks = [];
  if (provider === 'bing' || provider === 'dual') {
    tasks.push(
      searchBing({
        endpoint: config.bingSearchEndpoint,
        key: config.bingSearchKey,
        query,
        limit
      }).catch((error) => {
        logger?.warn?.('search_provider_failed', {
          provider: 'bing',
          query,
          message: error.message
        });
        return [];
      })
    );
  }

  if (provider === 'google' || provider === 'dual') {
    tasks.push(
      searchGoogleCse({
        key: config.googleCseKey,
        cx: config.googleCseCx,
        query,
        limit
      }).catch((error) => {
        logger?.warn?.('search_provider_failed', {
          provider: 'google',
          query,
          message: error.message
        });
        return [];
      })
    );
  }

  if (!tasks.length) {
    return [];
  }
  const all = (await Promise.all(tasks)).flat();
  return dedupeResults(all);
}

export function searchProviderAvailability(config) {
  return {
    provider: normalizeProvider(config.searchProvider),
    bing_ready: Boolean(config.bingSearchEndpoint && config.bingSearchKey),
    google_ready: Boolean(config.googleCseKey && config.googleCseCx)
  };
}
