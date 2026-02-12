#!/usr/bin/env node

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '');
}

function buildSearchUrl(baseUrl, query, format = 'json') {
  const url = new URL('/search', `${baseUrl}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', format);
  return url.toString();
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function toRootDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = normalizeBaseUrl(args.url || process.env.SEARXNG_BASE_URL);
  const query = String(args.query || 'razer viper v3 pro specs').trim();
  const timeoutMs = Math.max(1000, Number.parseInt(String(args.timeout || 12000), 10) || 12000);
  const url = buildSearchUrl(baseUrl, query, 'json');

  let response;
  try {
    response = await fetchWithTimeout(url, timeoutMs);
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      base_url: baseUrl,
      error: `request_failed:${error.message}`
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    process.stderr.write(JSON.stringify({
      ok: false,
      base_url: baseUrl,
      status: response.status,
      error: 'bad_status'
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      base_url: baseUrl,
      error: `invalid_json:${error.message}`
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const engines = new Set();
  const domains = [];
  for (const row of results) {
    const engine = String(row?.engine || '').trim();
    if (engine) {
      engines.add(engine);
    }
    const domain = toRootDomain(row?.url || '');
    if (domain) {
      domains.push(domain);
    }
  }

  const topDomains = Object.entries(
    domains.reduce((acc, domain) => {
      acc[domain] = (acc[domain] || 0) + 1;
      return acc;
    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([domain, count]) => ({ domain, count }));

  const output = {
    ok: true,
    base_url: baseUrl,
    query,
    result_count: results.length,
    engines: [...engines].slice(0, 10),
    top_domains: topDomains
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (results.length === 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
