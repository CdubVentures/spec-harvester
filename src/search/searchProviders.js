function normalizeProvider(value) {
  const token = String(value || '').trim().toLowerCase();
  if (token === 'google_cse') {
    return 'google';
  }
  if (token === 'ddg') {
    return 'duckduckgo';
  }
  if (
    token === 'google' ||
    token === 'bing' ||
    token === 'dual' ||
    token === 'searxng' ||
    token === 'duckduckgo' ||
    token === 'none'
  ) {
    return token;
  }
  return 'none';
}

function activeProvidersForConfig(provider, {
  bingReady,
  googleReady,
  searxngReady,
  duckduckgoReady
}) {
  if (provider === 'none') {
    return [];
  }
  if (provider === 'bing') {
    return bingReady ? ['bing'] : [];
  }
  if (provider === 'google') {
    return googleReady ? ['google'] : [];
  }
  if (provider === 'searxng') {
    return searxngReady ? ['searxng'] : [];
  }
  if (provider === 'duckduckgo') {
    return duckduckgoReady ? ['duckduckgo'] : [];
  }

  const active = [];
  if (bingReady) active.push('bing');
  if (googleReady) active.push('google');
  if (searxngReady) active.push('searxng');
  if (duckduckgoReady) active.push('duckduckgo');
  return active;
}

function missingGoogleCredentials(provider, config) {
  if (provider !== 'google' && provider !== 'dual') {
    return [];
  }
  if (config.disableGoogleCse) {
    return [];
  }
  const missing = [];
  if (!config.googleCseKey) {
    missing.push('GOOGLE_CSE_KEY');
  }
  if (!config.googleCseCx) {
    missing.push('GOOGLE_CSE_CX');
  }
  return missing;
}

function missingBingCredentials(provider, config) {
  if (provider !== 'bing' && provider !== 'dual') {
    return [];
  }
  const missing = [];
  if (!config.bingSearchEndpoint) {
    missing.push('BING_SEARCH_ENDPOINT');
  }
  if (!config.bingSearchKey) {
    missing.push('BING_SEARCH_KEY');
  }
  return missing;
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

function searxngBaseUrl(config = {}) {
  const token = String(config.searxngBaseUrl || '').trim();
  if (!token) {
    return '';
  }
  try {
    const parsed = new URL(token);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function searchSearxng({
  baseUrl,
  query,
  limit = 10,
  timeoutMs = 8_000
}) {
  if (!baseUrl || !query) {
    return [];
  }
  const url = new URL('/search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'en');
  url.searchParams.set('safesearch', '0');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs || 8_000)));

  try {
    const response = await fetch(url, {
      signal: controller.signal
    });
    if (!response.ok) {
      return [];
    }
    const payload = await response.json();
    return (payload.results || []).slice(0, Math.max(1, Number(limit || 10))).map((item) => ({
      url: item.url,
      title: item.title || '',
      snippet: item.content || item.snippet || '',
      provider: 'searxng',
      query
    }));
  } finally {
    clearTimeout(timeout);
  }
}

function duckduckgoBaseUrl(config = {}) {
  const token = String(config.duckduckgoBaseUrl || '').trim();
  if (!token) {
    return 'https://html.duckduckgo.com/html/';
  }
  try {
    const parsed = new URL(token);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return 'https://html.duckduckgo.com/html/';
  }
}

function decodeHtmlEntities(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10) || 0));
}

function stripHtmlTags(value = '') {
  return decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDuckduckgoHref(href = '') {
  const token = String(href || '').trim();
  if (!token) {
    return '';
  }
  try {
    const parsed = new URL(token, 'https://duckduckgo.com');
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname.startsWith('/l/')) {
      const redirected = parsed.searchParams.get('uddg');
      if (redirected) {
        return decodeURIComponent(redirected);
      }
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function parseDuckduckgoHtml(html = '', query = '', limit = 10) {
  const rows = [];
  const cap = Math.max(1, Number(limit || 10));
  const snippetsByUrl = new Map();

  const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = snippetRegex.exec(html); match; match = snippetRegex.exec(html)) {
    const url = normalizeDuckduckgoHref(match[1]);
    if (!url) {
      continue;
    }
    const snippet = stripHtmlTags(match[2]);
    if (snippet) {
      snippetsByUrl.set(url, snippet);
    }
  }

  const resultRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = resultRegex.exec(html); match; match = resultRegex.exec(html)) {
    if (rows.length >= cap) {
      break;
    }
    const url = normalizeDuckduckgoHref(match[1]);
    if (!url || rows.some((row) => row.url === url)) {
      continue;
    }
    rows.push({
      url,
      title: stripHtmlTags(match[2]),
      snippet: snippetsByUrl.get(url) || '',
      provider: 'duckduckgo',
      query
    });
  }

  if (rows.length >= cap) {
    return rows;
  }

  const looseRegex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = looseRegex.exec(html); match; match = looseRegex.exec(html)) {
    if (rows.length >= cap) {
      break;
    }
    const url = normalizeDuckduckgoHref(match[1]);
    if (!url || !/^https?:\/\//i.test(url) || rows.some((row) => row.url === url)) {
      continue;
    }
    const title = stripHtmlTags(match[2]);
    if (!title || title.length < 3) {
      continue;
    }
    rows.push({
      url,
      title,
      snippet: snippetsByUrl.get(url) || '',
      provider: 'duckduckgo',
      query
    });
  }

  return rows;
}

export async function searchDuckduckgo({
  baseUrl,
  query,
  limit = 10,
  timeoutMs = 8_000
}) {
  if (!query) {
    return [];
  }
  const root = String(baseUrl || '').trim() || 'https://html.duckduckgo.com/html/';
  const url = new URL(root.endsWith('/') ? root : `${root}/`);
  url.searchParams.set('q', query);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(timeoutMs || 8_000)));

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; SpecFactory/1.0)',
        'accept-language': 'en-US,en;q=0.9'
      }
    });
    if (!response.ok) {
      return [];
    }
    const html = await response.text();
    return parseDuckduckgoHtml(html, query, limit);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runSearchProviders({
  config,
  query,
  limit = 10,
  logger
}) {
  const provider = normalizeProvider(config.searchProvider);
  const googleCseDisabled = Boolean(config.disableGoogleCse);
  if (provider === 'none') {
    return [];
  }

  if (provider === 'searxng') {
    try {
      const rows = await searchSearxng({
        baseUrl: searxngBaseUrl(config),
        query,
        limit,
        timeoutMs: config.searxngTimeoutMs
      });
      return dedupeResults(rows);
    } catch (error) {
      logger?.warn?.('search_provider_failed', {
        provider: 'searxng',
        query,
        message: error.message
      });
      return [];
    }
  }
  if (provider === 'duckduckgo') {
    try {
      const rows = await searchDuckduckgo({
        baseUrl: duckduckgoBaseUrl(config),
        query,
        limit,
        timeoutMs: config.duckduckgoTimeoutMs
      });
      return dedupeResults(rows);
    } catch (error) {
      logger?.warn?.('search_provider_failed', {
        provider: 'duckduckgo',
        query,
        message: error.message
      });
      return [];
    }
  }

  const tasks = [];
  if (provider === 'bing' || provider === 'dual') {
    if (config.bingSearchEndpoint && config.bingSearchKey) {
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
  }

  if (provider === 'google' || provider === 'dual') {
    if (!googleCseDisabled && config.googleCseKey && config.googleCseCx) {
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
  }

  if (!tasks.length && provider === 'dual') {
    const searxBase = searxngBaseUrl(config);
    const fallbackTasks = [];
    if (searxBase) {
      fallbackTasks.push(
        searchSearxng({
          baseUrl: searxBase,
          query,
          limit,
          timeoutMs: config.searxngTimeoutMs
        }).catch((error) => {
          logger?.warn?.('search_provider_failed', {
            provider: 'searxng',
            query,
            message: error.message
          });
          return [];
        })
      );
    }
    if (config.duckduckgoEnabled !== false) {
      fallbackTasks.push(
        searchDuckduckgo({
          baseUrl: duckduckgoBaseUrl(config),
          query,
          limit,
          timeoutMs: config.duckduckgoTimeoutMs
        }).catch((error) => {
          logger?.warn?.('search_provider_failed', {
            provider: 'duckduckgo',
            query,
            message: error.message
          });
          return [];
        })
      );
    }
    if (!fallbackTasks.length) {
      return [];
    }
    const rows = (await Promise.all(fallbackTasks)).flat();
    return dedupeResults(rows);
  }

  if (!tasks.length) {
    return [];
  }
  const all = (await Promise.all(tasks)).flat();
  return dedupeResults(all);
}

export function searchProviderAvailability(config) {
  const provider = normalizeProvider(config.searchProvider);
  const googleCseDisabled = Boolean(config.disableGoogleCse);
  const bingReady = Boolean(config.bingSearchEndpoint && config.bingSearchKey);
  const googleReady = !googleCseDisabled && Boolean(config.googleCseKey && config.googleCseCx);
  const searxngReady = Boolean(searxngBaseUrl(config));
  const duckduckgoReady = config.duckduckgoEnabled !== false;
  const activeProviders = activeProvidersForConfig(provider, {
    bingReady,
    googleReady,
    searxngReady,
    duckduckgoReady
  });
  let fallbackReason = null;
  if (provider === 'dual' && !bingReady && !googleReady) {
    if (searxngReady && duckduckgoReady) {
      fallbackReason = 'dual_fallback_public_engines';
    } else if (searxngReady) {
      fallbackReason = 'dual_fallback_searxng_only';
    } else if (duckduckgoReady) {
      fallbackReason = 'dual_fallback_duckduckgo_only';
    } else {
      fallbackReason = 'no_provider_ready';
    }
  }
  return {
    provider,
    bing_ready: bingReady,
    google_ready: googleReady,
    google_cse_disabled: googleCseDisabled,
    searxng_ready: searxngReady,
    duckduckgo_ready: duckduckgoReady,
    active_providers: activeProviders,
    google_missing_credentials: missingGoogleCredentials(provider, config),
    bing_missing_credentials: missingBingCredentials(provider, config),
    fallback_reason: fallbackReason,
    internet_ready:
      (provider === 'bing' && bingReady) ||
      (provider === 'google' && googleReady) ||
      (provider === 'searxng' && searxngReady) ||
      (provider === 'duckduckgo' && duckduckgoReady) ||
      (provider === 'dual' && (bingReady || googleReady || searxngReady || duckduckgoReady))
  };
}
