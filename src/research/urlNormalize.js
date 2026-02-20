const TRACKING_KEYS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'yclid',
  'ref_src'
]);

const TRACKING_PREFIXES = ['utm_'];

function stripWww(hostname = '') {
  const token = String(hostname || '').trim().toLowerCase();
  if (token.startsWith('www.')) {
    return token.slice(4);
  }
  return token;
}

export function isTrackingParam(key) {
  const token = String(key || '').trim().toLowerCase();
  if (!token) {
    return false;
  }
  if (TRACKING_KEYS.has(token)) {
    return true;
  }
  return TRACKING_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function normalizePathname(pathname = '') {
  let next = String(pathname || '').replace(/\/+/g, '/');
  if (!next.startsWith('/')) {
    next = `/${next}`;
  }
  if (next.length > 1 && next.endsWith('/')) {
    next = next.slice(0, -1);
  }
  next = next
    .replace(/^\/amp\//, '/')
    .replace(/^\/share\//, '/')
    .replace(/\/amp$/, '');
  if (!next) {
    return '/';
  }
  return next;
}

export function pathSignature(pathname = '') {
  const normalized = normalizePathname(pathname);
  const parts = normalized.split('/').filter(Boolean).map((segment) => {
    if (/^\d+$/.test(segment)) {
      return ':num';
    }
    if (/^[0-9a-f]{8,}$/i.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)) {
      return ':id';
    }
    return segment.toLowerCase();
  });
  if (!parts.length) {
    return '/';
  }
  return `/${parts.slice(0, 6).join('/')}`;
}

function normalizeQueryParams(url, { stripTrackingParams = true } = {}) {
  const rows = [];
  for (const [key, value] of url.searchParams.entries()) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      continue;
    }
    if (stripTrackingParams && isTrackingParam(normalizedKey)) {
      continue;
    }
    rows.push([normalizedKey, String(value || '')]);
  }
  rows.sort((a, b) => {
    if (a[0] === b[0]) {
      return a[1].localeCompare(b[1]);
    }
    return a[0].localeCompare(b[0]);
  });
  url.search = '';
  for (const [key, value] of rows) {
    url.searchParams.append(key, value);
  }
}

export function canonicalizeUrl(rawUrl, options = {}) {
  const stripTrackingParams = options.stripTrackingParams !== false;
  const input = String(rawUrl || '').trim();
  if (!input) {
    return {
      original_url: '',
      canonical_url: '',
      domain: '',
      path_sig: ''
    };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    return {
      original_url: input,
      canonical_url: '',
      domain: '',
      path_sig: ''
    };
  }

  url.hash = '';
  url.protocol = String(url.protocol || '').toLowerCase() === 'http:' ? 'http:' : 'https:';
  url.hostname = stripWww(url.hostname);
  url.pathname = normalizePathname(url.pathname);
  normalizeQueryParams(url, { stripTrackingParams });
  const canonical = url.toString();
  return {
    original_url: input,
    canonical_url: canonical,
    domain: stripWww(url.hostname),
    path_sig: pathSignature(url.pathname),
    query: url.search ? url.search.slice(1) : ''
  };
}
