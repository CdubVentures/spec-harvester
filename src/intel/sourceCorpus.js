import { toPosixKey } from '../s3/storage.js';
import { normalizeMissingFieldTargets } from '../utils/fieldKeys.js';

const CORPUS_CACHE = new Map();
const CORPUS_CACHE_TTL_MS = 15_000;

function normalizeHost(value) {
  return String(value || '').toLowerCase().replace(/^www\./, '');
}

function normalizePath(url) {
  try {
    const parsed = new URL(url);
    const raw = String(parsed.pathname || '/').toLowerCase().replace(/\/+/g, '/');
    if (!raw || raw === '/') {
      return '/';
    }
    return raw.endsWith('/') ? raw.slice(0, -1) : raw;
  } catch {
    return '/';
  }
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  return normalizeToken(value)
    .split(/\s+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function hasKnownValue(value) {
  const token = String(value || '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'null';
}

function buildSnippetFromCandidates(candidates = [], limit = 12) {
  const parts = [];
  for (const candidate of candidates || []) {
    if (!candidate?.field || !hasKnownValue(candidate.value)) {
      continue;
    }
    parts.push(`${candidate.field}: ${String(candidate.value).trim()}`);
    if (parts.length >= limit) {
      break;
    }
  }
  return parts.join(' | ').slice(0, 640);
}

function normalizeSourceRecord({
  source,
  category,
  identity = {}
}) {
  const url = String(source?.finalUrl || source?.url || '').trim();
  if (!url) {
    return null;
  }
  const host = normalizeHost(source?.host || '');
  const rootDomain = String(source?.rootDomain || host || '').trim().toLowerCase();
  const tier = Number.parseInt(String(source?.tier || 0), 10) || 0;
  const role = String(source?.role || '').trim().toLowerCase();
  const title = String(source?.title || '').trim();
  const path = normalizePath(url);
  const fieldCandidates = Array.isArray(source?.fieldCandidates) ? source.fieldCandidates : [];
  const fields = [...new Set(
    fieldCandidates
      .map((row) => String(row?.field || '').trim())
      .filter(Boolean)
  )].slice(0, 120);
  const methods = [...new Set(
    fieldCandidates
      .map((row) => String(row?.method || '').trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 80);
  const snippet = buildSnippetFromCandidates(fieldCandidates);
  const updatedAt = String(source?.ts || new Date().toISOString());

  return {
    url,
    host,
    rootDomain,
    path,
    title,
    snippet,
    tier,
    role,
    approved_domain: Boolean(source?.approvedDomain),
    identity_match: Boolean(source?.identity?.match),
    fields,
    methods,
    category: String(category || ''),
    brand: String(identity?.brand || ''),
    model: String(identity?.model || ''),
    variant: String(identity?.variant || ''),
    updated_at: updatedAt
  };
}

function shouldKeepSourceForCorpus(source = {}) {
  if (source?.helperSource) {
    return false;
  }
  if (source?.discoveryOnly) {
    return false;
  }
  if (!source?.identity?.match) {
    return false;
  }
  const status = Number.parseInt(String(source?.status || 0), 10) || 0;
  if (status < 200 || status >= 400) {
    return false;
  }
  return true;
}

function compareIsoDesc(left, right) {
  const a = Date.parse(String(left || ''));
  const b = Date.parse(String(right || ''));
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    return 0;
  }
  if (!Number.isFinite(a)) {
    return 1;
  }
  if (!Number.isFinite(b)) {
    return -1;
  }
  return b - a;
}

function dedupeDocs(docs = [], maxDocs = 20_000) {
  const byUrl = new Map();
  for (const doc of docs || []) {
    const url = String(doc?.url || '').trim();
    if (!url) {
      continue;
    }
    const prev = byUrl.get(url);
    if (!prev) {
      byUrl.set(url, doc);
      continue;
    }
    const prevTs = String(prev?.updated_at || '');
    const nextTs = String(doc?.updated_at || '');
    if (compareIsoDesc(nextTs, prevTs) > 0) {
      continue;
    }
    byUrl.set(url, doc);
  }
  return [...byUrl.values()]
    .sort((a, b) => compareIsoDesc(a.updated_at, b.updated_at))
    .slice(0, Math.max(100, Number(maxDocs || 20_000)));
}

function tokenizeQuery(query) {
  return [...new Set(tokenize(query))].slice(0, 24);
}

function textIncludes(text, token) {
  return String(text || '').toLowerCase().includes(String(token || '').toLowerCase());
}

function scoreDoc(doc, {
  queryTokens = [],
  missingFields = []
}) {
  let score = 0;
  const title = String(doc?.title || '');
  const url = String(doc?.url || '');
  const snippet = String(doc?.snippet || '');
  const fields = new Set((doc?.fields || []).map((field) => String(field || '').trim()).filter(Boolean));
  const path = String(doc?.path || '');

  for (const token of queryTokens) {
    if (textIncludes(title, token)) {
      score += 4;
    }
    if (textIncludes(url, token)) {
      score += 3;
    }
    if (textIncludes(snippet, token)) {
      score += 1;
    }
  }

  for (const field of missingFields || []) {
    const normalized = String(field || '').trim();
    if (!normalized) {
      continue;
    }
    if (fields.has(normalized)) {
      score += 7;
      continue;
    }
    if (textIncludes(snippet, normalized.replace(/_/g, ' '))) {
      score += 2;
    }
  }

  if (doc?.identity_match) {
    score += 6;
  }
  if (doc?.approved_domain) {
    score += 4;
  }
  if (Number(doc?.tier || 0) === 1) {
    score += 6;
  } else if (Number(doc?.tier || 0) === 2) {
    score += 3;
  }
  if (String(doc?.role || '') === 'manufacturer') {
    score += 8;
  }
  if (/manual|datasheet|support|spec|technical|download/.test(path)) {
    score += 8;
  }
  if (path.endsWith('.pdf')) {
    score += 5;
  }

  return score;
}

function sourceCorpusCacheKey(storage, key) {
  return `${storage?.constructor?.name || 'storage'}::${key}`;
}

export function sourceCorpusKey(config, category) {
  return toPosixKey(config.s3OutputPrefix, '_source_intel', category, 'corpus.json');
}

export async function loadSourceCorpus({
  storage,
  config,
  category
}) {
  const key = sourceCorpusKey(config, category);
  const cacheKey = sourceCorpusCacheKey(storage, key);
  const cached = CORPUS_CACHE.get(cacheKey);
  if (cached && (Date.now() - cached.ts) <= CORPUS_CACHE_TTL_MS) {
    return {
      key,
      data: cached.data
    };
  }

  const data = (await storage.readJsonOrNull(key)) || {
    category,
    updated_at: null,
    doc_count: 0,
    docs: []
  };
  CORPUS_CACHE.set(cacheKey, {
    ts: Date.now(),
    data
  });
  return {
    key,
    data
  };
}

function invalidateSourceCorpusCache(storage, key) {
  CORPUS_CACHE.delete(sourceCorpusCacheKey(storage, key));
}

export async function persistSourceCorpus({
  storage,
  config,
  category,
  sourceResults,
  identity = {}
}) {
  const maxDocs = Math.max(200, Number.parseInt(String(config.sourceCorpusMaxDocs || 20_000), 10) || 20_000);
  const loaded = await loadSourceCorpus({
    storage,
    config,
    category
  });
  const incomingDocs = [];
  for (const source of sourceResults || []) {
    if (!shouldKeepSourceForCorpus(source)) {
      continue;
    }
    const doc = normalizeSourceRecord({
      source,
      category,
      identity
    });
    if (doc) {
      incomingDocs.push(doc);
    }
  }

  const docs = dedupeDocs([
    ...(Array.isArray(loaded.data?.docs) ? loaded.data.docs : []),
    ...incomingDocs
  ], maxDocs);
  const payload = {
    category,
    updated_at: new Date().toISOString(),
    doc_count: docs.length,
    docs
  };

  await storage.writeObject(
    loaded.key,
    Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  invalidateSourceCorpusCache(storage, loaded.key);
  return {
    key: loaded.key,
    doc_count: docs.length,
    added_count: incomingDocs.length
  };
}

export async function searchSourceCorpus({
  storage,
  config,
  category,
  query,
  limit = 10,
  missingFields = [],
  fieldOrder = [],
  logger
}) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return [];
  }
  const loaded = await loadSourceCorpus({
    storage,
    config,
    category
  });
  const docs = Array.isArray(loaded.data?.docs) ? loaded.data.docs : [];
  if (!docs.length) {
    return [];
  }

  const queryTokens = tokenizeQuery(normalizedQuery);
  const normalizedMissingFields = normalizeMissingFieldTargets(missingFields, {
    fieldOrder
  }).fields;
  const scored = [];
  for (const doc of docs) {
    const score = scoreDoc(doc, {
      queryTokens,
      missingFields: normalizedMissingFields
    });
    if (score <= 0) {
      continue;
    }
    scored.push({
      ...doc,
      score
    });
  }
  scored.sort((a, b) => b.score - a.score || compareIsoDesc(a.updated_at, b.updated_at));
  const rows = scored.slice(0, Math.max(1, Number(limit || 10) || 10)).map((doc) => ({
    url: doc.url,
    title: doc.title || '',
    snippet: doc.snippet || '',
    provider: 'internal',
    internal_score: doc.score,
    query: normalizedQuery
  }));
  logger?.info?.('discovery_internal_query_completed', {
    query: normalizedQuery,
    result_count: rows.length,
    corpus_docs: docs.length
  });
  return rows;
}
