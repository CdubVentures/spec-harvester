import { toPosixKey } from '../s3/storage.js';
import {
  inferRoleForHost,
  isApprovedHost,
  isDeniedHost,
  resolveTierForHost,
  resolveTierNameForHost
} from '../categories/loader.js';
import { extractRootDomain } from '../utils/common.js';
import { planDiscoveryQueriesLLM } from '../llm/discoveryPlanner.js';
import { runSearchProviders, searchProviderAvailability } from '../search/searchProviders.js';
import { rerankSearchResults } from '../search/resultReranker.js';
import { buildSearchProfile } from '../search/queryBuilder.js';
import { normalizeFieldList } from '../utils/fieldKeys.js';
import { searchSourceCorpus } from '../intel/sourceCorpus.js';
import { planUberQueries } from '../research/queryPlanner.js';
import { rerankSerpResults } from '../research/serpReranker.js';
import { dedupeSerpResults } from '../search/serpDedupe.js';
import { resolveBrandDomain } from './brandResolver.js';
import { classifyDomains } from './domainSafetyGate.js';
import { predictSourceUrls } from './urlPredictor.js';
import { callLlmWithRouting, hasLlmRouteApiKey } from '../llm/routing.js';
import {
  createBrandResolverCallLlm,
  createDomainSafetyCallLlm,
  createUrlPredictorCallLlm
} from '../llm/discoveryLlmAdapters.js';

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

const BRAND_HOST_HINTS = {
  logitech: ['logitech', 'logitechg', 'logi'],
  razer: ['razer'],
  steelseries: ['steelseries'],
  alienware: ['alienware', 'dell'],
  dell: ['dell', 'alienware'],
  asus: ['asus', 'rog'],
  zowie: ['zowie', 'benq'],
  benq: ['benq', 'zowie'],
  hp: ['hp', 'hyperx'],
  hyperx: ['hyperx', 'hp'],
  lenovo: ['lenovo', 'legion'],
  msi: ['msi'],
  acer: ['acer', 'predator'],
  finalmouse: ['finalmouse'],
  lamzu: ['lamzu'],
  pulsar: ['pulsar'],
  corsair: ['corsair'],
  glorious: ['glorious'],
  endgame: ['endgamegear', 'endgame-gear']
};

function manufacturerHostHintsForBrand(brand) {
  const hints = new Set(tokenize(brand));
  const brandSlug = slug(brand);
  for (const [key, aliases] of Object.entries(BRAND_HOST_HINTS)) {
    if (brandSlug.includes(key) || hints.has(key)) {
      for (const alias of aliases) {
        hints.add(alias);
      }
    }
  }
  return [...hints];
}

function manufacturerHostMatchesBrand(host, hints) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost || !hints.length) {
    return true;
  }
  return hints.some((hint) => hint && normalizedHost.includes(hint));
}

function productText(variables = {}) {
  return [variables.brand, variables.model, variables.variant]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildModelSlugCandidates(variables = {}) {
  const entries = [];
  const brandSlug = slug(variables.brand || '');
  const modelSlug = slug(variables.model || '');
  const variantSlug = slug(variables.variant || '');
  const combinedModel = slug([variables.model, variables.variant].filter(Boolean).join(' '));
  const brandModel = slug([variables.brand, variables.model, variables.variant].filter(Boolean).join(' '));

  for (const value of [combinedModel, modelSlug, brandModel]) {
    if (value) {
      entries.push(value);
    }
  }
  if (modelSlug && variantSlug) {
    entries.push(`${modelSlug}-${variantSlug}`);
  }
  if (brandSlug && modelSlug) {
    entries.push(`${brandSlug}-${modelSlug}`);
    if (variantSlug) {
      entries.push(`${brandSlug}-${modelSlug}-${variantSlug}`);
    }
  }

  const unique = [];
  const seen = new Set();
  for (const value of entries) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    unique.push(token);
  }
  return unique.slice(0, 6);
}

function categoryPathSegments(category) {
  const token = slug(category || '');
  if (!token) {
    return [];
  }
  if (token === 'mouse') {
    return ['mouse', 'mice', 'gaming-mice'];
  }
  if (token === 'keyboard') {
    return ['keyboard', 'keyboards', 'gaming-keyboards'];
  }
  if (token === 'headset') {
    return ['headset', 'headsets', 'gaming-headsets'];
  }
  return [token, `${token}s`];
}

function buildManufacturerPlanUrls({ host, variables, queries, maxQueries = 3 }) {
  const urls = [];
  const product = productText(variables);
  const queryText = product || queries[0] || '';
  const slugs = buildModelSlugCandidates(variables);
  const brandSlug = slug(variables.brand || '');
  const categorySegments = categoryPathSegments(variables.category);

  const add = (path, query = '') => {
    const value = `https://${host}${path}`;
    if (!urls.some((row) => row.url === value)) {
      urls.push({
        url: value,
        title: `${host} planned manufacturer path`,
        snippet: 'planned manufacturer candidate URL',
        provider: 'plan',
        query
      });
    }
  };

  for (const modelSlug of slugs) {
    add(`/product/${modelSlug}`, queryText);
    add(`/products/${modelSlug}`, queryText);
    add(`/p/${modelSlug}`, queryText);
    add(`/${modelSlug}`, queryText);
    add(`/support/${modelSlug}`, queryText);
    add(`/manual/${modelSlug}`, queryText);
    add(`/downloads/${modelSlug}`, queryText);
    add(`/specs/${modelSlug}`, queryText);
    for (const segment of categorySegments) {
      add(`/${segment}/${modelSlug}`, queryText);
    }
    add(`/en-us/product/${modelSlug}`, queryText);
    add(`/en-us/products/${modelSlug}`, queryText);
    for (const segment of categorySegments) {
      add(`/en-us/products/${segment}/${modelSlug}`, queryText);
    }
    if (brandSlug && !modelSlug.startsWith(`${brandSlug}-`)) {
      add(`/product/${brandSlug}-${modelSlug}`, queryText);
      add(`/products/${brandSlug}-${modelSlug}`, queryText);
      for (const segment of categorySegments) {
        add(`/${segment}/${brandSlug}-${modelSlug}`, queryText);
      }
      add(`/en-us/products/${brandSlug}-${modelSlug}`, queryText);
      for (const segment of categorySegments) {
        add(`/en-us/products/${segment}/${brandSlug}-${modelSlug}`, queryText);
      }
    }
  }

  for (const query of queries.slice(0, Math.max(1, maxQueries))) {
    add(`/search?q=${encodeURIComponent(query)}`, query);
    add(`/search?query=${encodeURIComponent(query)}`, query);
    add(`/support/search?query=${encodeURIComponent(query)}`, query);
  }

  return urls.slice(0, 40);
}

export function computeIdentityMatchLevel({ url = '', title = '', snippet = '', identityLock = {} } = {}) {
  const haystack = `${String(url || '')} ${String(title || '')} ${String(snippet || '')}`.toLowerCase();
  const brand = String(identityLock.brand || '').trim().toLowerCase();
  const model = String(identityLock.model || '').trim().toLowerCase();
  const variant = String(identityLock.variant || '').trim().toLowerCase();
  const hasBrand = brand ? haystack.includes(brand) : false;
  const hasModel = model ? haystack.includes(model) : false;
  const hasVariant = variant ? haystack.includes(variant) : false;
  if (hasBrand && hasModel && hasVariant && variant) return 'strong';
  if (hasBrand && hasModel) return 'partial';
  if (hasBrand) return 'weak';
  return 'none';
}

export function detectVariantGuardHit({ title = '', snippet = '', url = '', variantGuardTerms = [], targetVariant = '' } = {}) {
  const haystack = `${String(url || '')} ${String(title || '')} ${String(snippet || '')}`.toLowerCase();
  const target = String(targetVariant || '').trim().toLowerCase();
  for (const term of variantGuardTerms || []) {
    const normalized = String(term || '').trim().toLowerCase();
    if (!normalized) continue;
    if (target && normalized === target) continue;
    if (haystack.includes(normalized)) return true;
  }
  return false;
}

export function detectMultiModelHint({ title = '', snippet = '' } = {}) {
  const text = `${String(title || '')} ${String(snippet || '')}`.toLowerCase();
  return /\bvs\b/.test(text)
    || /\btop\s+\d+\b/.test(text)
    || /\bbest\s+\d*\s*\w*\s*(mice|mouse|keyboards?|headsets?|monitors?)/.test(text)
    || /\bcompar(ison|e|ing)\b/.test(text);
}

function classifyUrlCandidate(result, categoryConfig) {
  const parsed = new URL(result.url);
  const host = normalizeHost(parsed.hostname);
  const docKindGuess = guessDocKind({
    url: parsed.toString(),
    pathname: parsed.pathname,
    title: result.title || '',
    snippet: result.snippet || ''
  });
  const identityLock = result._identityLock || {};
  const variantGuardTerms = result._variantGuardTerms || [];
  const targetVariant = String(identityLock.variant || '').trim();
  return {
    url: parsed.toString(),
    host,
    rootDomain: extractRootDomain(host),
    path: String(parsed.pathname || '/').toLowerCase(),
    title: result.title || '',
    snippet: result.snippet || '',
    query: result.query || '',
    provider: result.provider || result.source || 'plan',
    approvedDomain: isApprovedHost(host, categoryConfig),
    tier: resolveTierForHost(host, categoryConfig),
    tierName: resolveTierNameForHost(host, categoryConfig),
    role: inferRoleForHost(host, categoryConfig),
    doc_kind_guess: docKindGuess,
    identity_match_level: computeIdentityMatchLevel({
      url: parsed.toString(),
      title: result.title || '',
      snippet: result.snippet || '',
      identityLock
    }),
    variant_guard_hit: detectVariantGuardHit({
      title: result.title || '',
      snippet: result.snippet || '',
      url: parsed.toString(),
      variantGuardTerms,
      targetVariant
    }),
    multi_model_hint: detectMultiModelHint({
      title: result.title || '',
      snippet: result.snippet || ''
    })
  };
}

function guessDocKind({
  url = '',
  pathname = '',
  title = '',
  snippet = ''
} = {}) {
  const pathToken = String(pathname || '').toLowerCase();
  const urlToken = String(url || '').toLowerCase();
  const text = `${String(title || '')} ${String(snippet || '')}`.toLowerCase();

  if (pathToken.endsWith('.pdf') || urlToken.includes('.pdf?')) {
    if (/manual|user guide|owner/.test(text) || /manual|guide|support/.test(pathToken)) {
      return 'manual_pdf';
    }
    return 'spec_pdf';
  }
  if (/teardown|disassembly|internal photos/.test(text) || /teardown|disassembly/.test(pathToken)) {
    return 'teardown_review';
  }
  if (/review|benchmark|latency|measurements|rtings|techpowerup/.test(text) || /review|benchmark/.test(pathToken)) {
    return 'lab_review';
  }
  if (/datasheet/.test(text) || /datasheet|spec|technical/.test(pathToken)) {
    return 'spec';
  }
  if (/support|download|driver|firmware|faq|kb/.test(pathToken) || /support|manual|driver|firmware/.test(text)) {
    return 'support';
  }
  if (/\/product|\/products|\/p\//.test(pathToken)) {
    return 'product_page';
  }
  return 'other';
}

function normalizeDocHint(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function docHintMatchesDocKind(docHint = '', docKind = '') {
  const hint = normalizeDocHint(docHint);
  const kind = normalizeDocHint(docKind);
  if (!hint || !kind) return false;
  if (hint === kind) return true;
  const matchMap = {
    manual: ['manual_pdf', 'support'],
    manual_pdf: ['manual_pdf'],
    support: ['support', 'manual_pdf'],
    spec: ['spec', 'spec_pdf', 'product_page'],
    spec_pdf: ['spec_pdf', 'manual_pdf'],
    datasheet: ['spec', 'spec_pdf'],
    pdf: ['manual_pdf', 'spec_pdf'],
    teardown: ['teardown_review'],
    teardown_review: ['teardown_review'],
    review: ['lab_review', 'teardown_review'],
    lab_review: ['lab_review', 'teardown_review'],
    benchmark: ['lab_review']
  };
  return (matchMap[hint] || []).includes(kind);
}

function uniqueTokens(values = [], limit = 32) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= Math.max(1, Number(limit || 32))) break;
  }
  return out;
}

function buildPlanOnlyResults({ categoryConfig, queries, variables, maxQueries = 3 }) {
  const planned = [];
  for (const sourceHost of categoryConfig.sourceHosts || []) {
    const host = sourceHost.host;
    const role = sourceHost.role || sourceHost.tierName || '';
    if (String(role).toLowerCase() === 'manufacturer') {
      planned.push(
        ...buildManufacturerPlanUrls({
          host,
          variables,
          queries,
          maxQueries
        })
      );
      continue;
    }

    for (const query of queries.slice(0, Math.max(1, maxQueries))) {
      planned.push({
        url: `https://${host}/search?q=${encodeURIComponent(query)}`,
        title: `${host} search`,
        snippet: 'planned source search URL',
        provider: 'plan',
        query
      });
      planned.push({
        url: `https://${host}/search/?q=${encodeURIComponent(query)}`,
        title: `${host} search`,
        snippet: 'planned source search URL',
        provider: 'plan',
        query
      });
    }
  }
  return planned;
}

function dedupeQueryRows(rows = [], limit = 24) {
  const cap = Math.max(1, Number(limit || 24));
  const out = [];
  const rejectLog = [];
  const seen = new Map();
  for (const row of rows || []) {
    const query = String(row?.query || row || '').trim();
    const source = String(row?.source || 'unknown').trim() || 'unknown';
    if (!query) {
      rejectLog.push({
        query: '',
        source,
        reason: 'empty_query',
        stage: 'pre_execution_merge',
        detail: ''
      });
      continue;
    }
    const normalized = query.toLowerCase();
    if (seen.has(normalized)) {
      const existing = out[seen.get(normalized)];
      existing.sources = uniqueTokens([...(existing.sources || []), source], 8);
      rejectLog.push({
        query,
        source,
        reason: 'duplicate_query',
        stage: 'pre_execution_merge',
        detail: ''
      });
      continue;
    }
    if (out.length >= cap) {
      rejectLog.push({
        query,
        source,
        reason: 'max_query_cap',
        stage: 'pre_execution_merge',
        detail: `cap:${cap}`
      });
      continue;
    }
    out.push({
      query,
      sources: uniqueTokens([source], 8)
    });
    seen.set(normalized, out.length - 1);
  }
  return {
    rows: out,
    rejectLog
  };
}

function prioritizeQueryRows(rows = [], variables = {}) {
  const brand = String(variables.brand || '').trim().toLowerCase();
  const model = String(variables.model || '').trim().toLowerCase();
  const brandToken = brand.replace(/\s+/g, '');
  const ranked = [...(rows || [])].map((row) => {
    const query = String(row?.query || '').trim();
    const text = String(query || '').toLowerCase();
    let score = 0;
    if (text.includes('site:')) score += 6;
    if (/manual|datasheet|support|spec|technical|pdf/.test(text)) score += 5;
    if (brandToken && text.includes(brandToken)) score += 3;
    if (brand && text.includes(brand)) score += 2;
    if (model && text.includes(model)) score += 2;
    if (/rtings|techpowerup/.test(text)) score += 1;
    return {
      ...row,
      query,
      score
    };
  });
  return ranked
    .sort((a, b) => b.score - a.score || a.query.localeCompare(b.query));
}

function compactToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function containsGuardToken(haystackLower = '', compactHaystack = '', token = '') {
  const normalized = String(token || '').toLowerCase().trim();
  if (!normalized) return false;
  if (haystackLower.includes(normalized)) return true;
  const compact = compactToken(normalized);
  return compact ? compactHaystack.includes(compact) : false;
}

function extractDigitGroups(value = '') {
  return [...new Set(String(value || '').toLowerCase().match(/\d{2,}/g) || [])];
}

function extractQueryModelLikeTokens(value = '') {
  return [...new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && /[a-z]/.test(token) && /\d/.test(token))
  )];
}

function isLikelyUnitToken(token = '') {
  const value = String(token || '').toLowerCase().trim();
  if (!value) return false;
  return /^(?:\d+k|\d+hz|\d+khz|\d+ghz|\d+mhz|\d+dpi|\d+cpi|\d+mm|\d+cm|\d+g|\d+kg|\d+ms|\d+s|\d+mah|\d+v|\d+mb|\d+gb)$/.test(value);
}

function buildIdentityQueryGuardContext(variables = {}, variantGuardTerms = []) {
  const brandTokens = [...new Set(tokenize(variables.brand).map((token) => compactToken(token)).filter(Boolean))];
  const modelTokens = [...new Set([
    ...tokenize(variables.model),
    ...tokenize(variables.variant)
  ].map((token) => compactToken(token)).filter(Boolean))]
    .filter((token) => !brandTokens.includes(token) && !GENERIC_MODEL_TOKENS.has(token));
  const requiredDigitGroups = extractDigitGroups(
    [variables.model, variables.variant].filter(Boolean).join(' ')
  );
  const allowedModelTokens = new Set();
  for (const token of [...modelTokens, ...toArray(variantGuardTerms).map((value) => compactToken(value))]) {
    const normalized = compactToken(token);
    if (!normalized || !/[a-z]/.test(normalized) || !/\d/.test(normalized)) {
      continue;
    }
    allowedModelTokens.add(normalized);
    const trimLeftAlpha = normalized.replace(/^[a-z]+/, '');
    const trimRightAlpha = normalized.replace(/[a-z]+$/, '');
    if (trimLeftAlpha && trimLeftAlpha.length >= 2) {
      allowedModelTokens.add(trimLeftAlpha);
    }
    if (trimRightAlpha && trimRightAlpha.length >= 2 && /[a-z]/.test(trimRightAlpha) && /\d/.test(trimRightAlpha)) {
      allowedModelTokens.add(trimRightAlpha);
    }
  }
  return {
    brandTokens,
    modelTokens,
    requiredDigitGroups,
    allowedModelTokens: [...allowedModelTokens]
  };
}

function validateQueryAgainstIdentity(query = '', context = {}) {
  const reasons = [];
  const queryText = String(query || '').toLowerCase();
  const compactQuery = compactToken(queryText);
  const brandTokens = toArray(context.brandTokens);
  const modelTokens = toArray(context.modelTokens);
  const requiredDigitGroups = toArray(context.requiredDigitGroups);
  const allowedModelTokens = new Set(toArray(context.allowedModelTokens).map((value) => compactToken(value)));

  if (
    brandTokens.length > 0
    && !brandTokens.some((token) => containsGuardToken(queryText, compactQuery, token))
  ) {
    reasons.push('missing_brand_token');
  }

  for (const digits of requiredDigitGroups) {
    if (!containsGuardToken(queryText, compactQuery, digits)) {
      reasons.push(`missing_required_digit_group:${digits}`);
    }
  }

  if (requiredDigitGroups.length === 0 && modelTokens.length > 0) {
    const requiredModelTokens = modelTokens.filter((token) => token.length >= 4);
    if (
      requiredModelTokens.length > 0
      && !requiredModelTokens.some((token) => containsGuardToken(queryText, compactQuery, token))
    ) {
      reasons.push('missing_model_token');
    }
  }

  for (const token of extractQueryModelLikeTokens(queryText)) {
    const normalized = compactToken(token);
    if (!normalized || allowedModelTokens.has(normalized) || isLikelyUnitToken(token)) {
      continue;
    }
    reasons.push(`foreign_model_token:${token}`);
    if (reasons.length >= 6) {
      break;
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons
  };
}

function enforceIdentityQueryGuard({ rows = [], variables = {}, variantGuardTerms = [] } = {}) {
  const context = buildIdentityQueryGuardContext(variables, variantGuardTerms);
  const accepted = [];
  const rejectLog = [];
  for (const row of rows || []) {
    const query = String(row?.query || '').trim();
    if (!query) {
      continue;
    }
    const result = validateQueryAgainstIdentity(query, context);
    if (result.accepted) {
      accepted.push(row);
      continue;
    }
    rejectLog.push({
      query,
      source: toArray(row?.sources),
      reason: result.reasons[0] || 'identity_guard_reject',
      stage: 'pre_execution_guard',
      detail: result.reasons.join('|')
    });
  }
  return {
    rows: accepted,
    rejectLog,
    guardContext: context
  };
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

const GENERIC_MODEL_TOKENS = new Set([
  'gaming',
  'mouse',
  'mice',
  'wireless',
  'wired',
  'edition',
  'black',
  'white',
  'mini',
  'ultra',
  'pro',
  'plus',
  'core',
  'version',
  'series'
]);

function normalizeIdentityTokens(variables = {}) {
  const brandTokens = [...new Set(tokenize(variables.brand))];
  const modelTokens = [...new Set([
    ...tokenize(variables.model),
    ...tokenize(variables.variant)
  ])].filter((token) => !brandTokens.includes(token) && !GENERIC_MODEL_TOKENS.has(token));
  return {
    brandTokens,
    modelTokens
  };
}

function countTokenHits(haystack = '', tokens = []) {
  const text = String(haystack || '').toLowerCase();
  let hits = 0;
  for (const token of tokens || []) {
    const norm = String(token || '').toLowerCase().trim();
    if (!norm) {
      continue;
    }
    if (text.includes(norm)) {
      hits += 1;
    }
  }
  return hits;
}

function isLowSignalDiscoveryPath(parsed) {
  const pathname = String(parsed?.pathname || '').toLowerCase();
  const pathAndQuery = `${pathname}${String(parsed?.search || '').toLowerCase()}`;
  if (!pathAndQuery || pathAndQuery === '/' || pathAndQuery === '/index.html') {
    return true;
  }
  if (
    pathname.endsWith('.xml') ||
    pathname.endsWith('.rss') ||
    pathname.endsWith('.atom') ||
    pathAndQuery.includes('opensearch') ||
    pathAndQuery.includes('latest-rss')
  ) {
    return true;
  }
  if (/\/search(\/|\?|$)/.test(pathAndQuery)) {
    return true;
  }
  return false;
}

function isRelevantSearchResult({
  parsed,
  raw = {},
  classified = {},
  variables = {}
}) {
  if (String(raw.provider || raw.source || '').toLowerCase() === 'plan') {
    return true;
  }
  if (String(classified.role || '').toLowerCase() === 'manufacturer') {
    return true;
  }
  if (isLowSignalDiscoveryPath(parsed)) {
    return false;
  }

  const { brandTokens, modelTokens } = normalizeIdentityTokens(variables);
  const haystack = [
    parsed?.hostname || '',
    parsed?.pathname || '',
    parsed?.search || '',
    raw.title || classified.title || '',
    raw.snippet || classified.snippet || '',
    raw.query || classified.query || ''
  ]
    .join(' ')
    .toLowerCase();
  const brandHits = countTokenHits(haystack, brandTokens);
  const modelHits = countTokenHits(haystack, modelTokens);
  const minModelHits = modelTokens.length >= 3 ? 2 : 1;

  if (modelTokens.length > 0) {
    if (modelHits < minModelHits) {
      return false;
    }
    if (brandTokens.length > 0 && brandHits < 1) {
      return false;
    }
    return true;
  }
  if (brandTokens.length > 0 && brandHits < 1) {
    return false;
  }
  return /review|spec|manual|support|product|technical|datasheet|benchmark|latency|sensor|dpi/.test(haystack);
}

async function runWithConcurrency(items = [], concurrency = 1, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return [];
  }
  const limit = Math.max(1, Number.parseInt(String(concurrency || 1), 10) || 1);
  const output = new Array(list.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) {
        return;
      }
      output[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => runWorker()));
  return output;
}

async function loadLearningArtifacts({
  storage,
  category
}) {
  const base = storage.resolveOutputKey('_learning', category);
  const [lexicon, queryTemplates, fieldYield] = await Promise.all([
    storage.readJsonOrNull(`${base}/field_lexicon.json`),
    storage.readJsonOrNull(`${base}/query_templates.json`),
    storage.readJsonOrNull(`${base}/field_yield.json`)
  ]);
  return {
    lexicon: lexicon || {},
    queryTemplates: queryTemplates || {},
    fieldYield: fieldYield || {}
  };
}

function buildSearchProfileKeys({
  storage,
  config,
  category,
  productId,
  runId
}) {
  const inputKey = toPosixKey(
    config.s3InputPrefix,
    '_discovery',
    category,
    `${runId}.search_profile.json`
  );
  const runKey = category && productId && runId
    ? storage.resolveOutputKey(category, productId, 'runs', runId, 'analysis', 'search_profile.json')
    : null;
  const latestKey = category && productId
    ? storage.resolveOutputKey(category, productId, 'latest', 'search_profile.json')
    : null;
  return {
    inputKey,
    runKey,
    latestKey
  };
}

async function writeSearchProfileArtifacts({
  storage,
  payload,
  keys = {}
}) {
  const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const uniqueKeys = [...new Set([keys.inputKey, keys.runKey, keys.latestKey].filter(Boolean))];
  await Promise.all(
    uniqueKeys.map((key) =>
      storage.writeObject(key, body, { contentType: 'application/json' })
    )
  );
}

function buildQueryAttemptStats(rows = []) {
  const byQuery = new Map();
  for (const row of rows || []) {
    const query = String(row?.query || '').trim();
    if (!query) {
      continue;
    }
    if (!byQuery.has(query)) {
      byQuery.set(query, {
        query,
        attempts: 0,
        result_count: 0,
        providers: []
      });
    }
    const bucket = byQuery.get(query);
    bucket.attempts += 1;
    bucket.result_count += Math.max(0, Number.parseInt(String(row?.result_count || 0), 10) || 0);
    const provider = String(row?.provider || '').trim();
    if (provider && !bucket.providers.includes(provider)) {
      bucket.providers.push(provider);
    }
  }
  return [...byQuery.values()].sort((a, b) => b.result_count - a.result_count || a.query.localeCompare(b.query));
}

export async function discoverCandidateSources({
  config,
  storage,
  categoryConfig,
  job,
  runId,
  logger,
  planningHints = {},
  llmContext = {},
  frontierDb = null,
  runtimeTraceWriter = null
}) {
  if (!config.discoveryEnabled) {
    return {
      enabled: false,
      discoveryKey: null,
      candidatesKey: null,
      candidates: [],
      approvedUrls: [],
      candidateUrls: [],
      queries: [],
      llm_queries: [],
      search_profile: null,
      search_profile_key: null,
      search_profile_run_key: null,
      search_profile_latest_key: null
    };
  }

  const variables = {
    brand: job.identityLock?.brand || '',
    model: job.identityLock?.model || '',
    variant: job.identityLock?.variant || '',
    category: job.category || categoryConfig.category
  };
  const missingFields = normalizeFieldList([
    ...toArray(planningHints.missingRequiredFields),
    ...toArray(planningHints.missingCriticalFields),
    ...toArray(job.requirements?.llmTargetFields)
  ], {
    fieldOrder: categoryConfig.fieldOrder || []
  });

  const learning = await loadLearningArtifacts({
    storage,
    category: categoryConfig.category
  });
  let brandResolution = null;
  if (variables.brand && config.llmEnabled && hasLlmRouteApiKey(config, { role: 'triage' })) {
    try {
      const brandCallLlm = createBrandResolverCallLlm({
        callRoutedLlmFn: callLlmWithRouting,
        config
      });
      brandResolution = await resolveBrandDomain({
        brand: variables.brand,
        category: variables.category,
        config,
        callLlmFn: brandCallLlm,
        storage
      });
      if (brandResolution?.officialDomain) {
        logger?.info?.('brand_resolved', {
          brand: variables.brand,
          official_domain: brandResolution.officialDomain,
          aliases: brandResolution.aliases?.slice(0, 5) || []
        });
      }
    } catch {
      // brand resolution is non-essential
    }
  }

  const profileMaxQueries = Math.max(6, Number(config.discoveryMaxQueries || 8) * 2);
  const searchProfileBase = buildSearchProfile({
    job,
    categoryConfig,
    missingFields,
    lexicon: learning.lexicon,
    learnedQueries: learning.queryTemplates,
    maxQueries: profileMaxQueries,
    brandResolution
  });
  const baseQueries = toArray(searchProfileBase?.base_templates);
  const targetedQueries = toArray(searchProfileBase?.queries);
  const llmQueries = await planDiscoveryQueriesLLM({
    job,
    categoryConfig,
    baseQueries: [...baseQueries, ...targetedQueries],
    missingCriticalFields: planningHints.missingCriticalFields || [],
    config,
    logger,
    llmContext
  });

  const uberMode = String(llmContext?.mode || '').toLowerCase() === 'uber_aggressive';
  const identityLock = {
    brand: job.identityLock?.brand || '',
    model: job.identityLock?.model || '',
    variant: job.identityLock?.variant || '',
    productId: job.productId || ''
  };
  const frontierSummary = frontierDb?.snapshotForProduct?.(job.productId || '') || {};
  const uberSearchPlan = uberMode
    ? await planUberQueries({
      config,
      logger,
      llmContext,
      identity: identityLock,
      missingFields,
      baseQueries: [...baseQueries, ...targetedQueries, ...llmQueries],
      frontierSummary,
      cap: Math.max(8, Number(config.discoveryMaxQueries || 8) * 2)
    })
    : null;

  const extraQueries = toArray(planningHints.extraQueries);
  const queryLimit = Math.max(
    1,
    Number(
      uberSearchPlan?.max_queries ||
      config.discoveryMaxQueries ||
      8
    )
  );
  const llmQueryRows = toArray(llmQueries).map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return { query: String(row.query || '').trim(), source: 'llm', target_fields: toArray(row.target_fields) };
    }
    return { query: String(row || '').trim(), source: 'llm', target_fields: [] };
  });
  const queryCandidates = [
    ...baseQueries.map((query) => ({ query, source: 'base_template', target_fields: [] })),
    ...targetedQueries.map((query) => ({ query, source: 'targeted', target_fields: [] })),
    ...llmQueryRows,
    ...toArray(uberSearchPlan?.queries).map((query) => ({ query, source: 'uber', target_fields: [] })),
    ...extraQueries.map((query) => ({ query, source: 'runtime_extra', target_fields: [] }))
  ];
  const mergedQueryCap = Math.max(queryLimit, 6);
  const mergedQueries = dedupeQueryRows(queryCandidates, mergedQueryCap);
  const rankedQueries = prioritizeQueryRows(mergedQueries.rows, variables);
  const guardedQueries = enforceIdentityQueryGuard({
    rows: rankedQueries,
    variables,
    variantGuardTerms: toArray(searchProfileBase?.variant_guard_terms)
  });
  let queries = guardedQueries.rows.map((row) => String(row?.query || '').trim()).filter(Boolean);
  if (!queries.length && rankedQueries.length > 0) {
    const fallback = String(rankedQueries[0]?.query || '').trim();
    if (fallback) {
      queries = [fallback];
      guardedQueries.rejectLog.push({
        query: fallback,
        source: toArray(rankedQueries[0]?.sources),
        reason: 'guard_fallback_retained',
        stage: 'pre_execution_guard',
        detail: 'all_queries_rejected'
      });
    }
  }
  const queryRejectLogCombined = [
    ...toArray(searchProfileBase?.query_reject_log),
    ...toArray(mergedQueries.rejectLog),
    ...toArray(guardedQueries.rejectLog)
  ].slice(0, 300);
  const searchProfileKeys = buildSearchProfileKeys({
    storage,
    config,
    category: categoryConfig.category,
    productId: job.productId,
    runId
  });
  const searchProfilePlanned = {
    ...searchProfileBase,
    category: categoryConfig.category,
    product_id: job.productId,
    run_id: runId,
    generated_at: new Date().toISOString(),
    status: 'planned',
    provider: config.searchProvider,
    llm_queries: llmQueries,
    query_reject_log: queryRejectLogCombined,
    query_guard: {
      brand_tokens: toArray(guardedQueries.guardContext?.brandTokens),
      model_tokens: toArray(guardedQueries.guardContext?.modelTokens),
      required_digit_groups: toArray(guardedQueries.guardContext?.requiredDigitGroups),
      accepted_query_count: queries.length,
      rejected_query_count: toArray(guardedQueries.rejectLog).length
    },
    selected_queries: queries.slice(0, queryLimit),
    selected_query_count: Math.min(queryLimit, queries.length),
    key: searchProfileKeys.inputKey,
    run_key: searchProfileKeys.runKey,
    latest_key: searchProfileKeys.latestKey
  };
  await writeSearchProfileArtifacts({
    storage,
    payload: searchProfilePlanned,
    keys: searchProfileKeys
  });
  logger?.info?.('search_profile_generated', {
    run_id: runId,
    category: categoryConfig.category,
    product_id: job.productId,
    alias_count: toArray(searchProfileBase?.identity_aliases).length,
    query_count: queries.length,
    key: searchProfileKeys.inputKey
  });
  const resultsPerQuery = Math.max(1, Number(config.discoveryResultsPerQuery || 10));
  const discoveryCap = Math.max(1, Number(config.discoveryMaxDiscovered || 120));
  const queryConcurrency = Math.max(1, Number(config.discoveryQueryConcurrency || 1));

  const providerState = searchProviderAvailability(config);
  const rawResults = [];
  const searchAttempts = [];
  const searchJournal = [];
  const requiredOnlySearch = Boolean(planningHints.requiredOnlySearch);
  const internalFirst = Boolean(config.discoveryInternalFirst);
  const internalMinResults = Math.max(1, Number(config.discoveryInternalMinResults || 1));
  const missingRequiredFields = normalizeFieldList(
    toArray(planningHints.missingRequiredFields),
    { fieldOrder: categoryConfig.fieldOrder || [] }
  );
  let internalSatisfied = false;
  let externalSearchReason = null;

  logger?.info?.('search_provider_diagnostics', {
    provider: providerState.provider,
    internet_ready: providerState.internet_ready,
    active_providers: providerState.active_providers || [],
    fallback_reason: providerState.fallback_reason || null,
    google_missing_credentials: providerState.google_missing_credentials || [],
    bing_missing_credentials: providerState.bing_missing_credentials || []
  });

  if (internalFirst) {
    for (const query of queries.slice(0, queryLimit)) {
      if (frontierDb?.shouldSkipQuery?.({ productId: job.productId, query })) {
        searchAttempts.push({
          query,
          provider: 'frontier',
          result_count: 0,
          reason_code: 'frontier_query_cooldown'
        });
        searchJournal.push({
          ts: new Date().toISOString(),
          query,
          provider: 'frontier',
          action: 'skip',
          reason: 'query_cooldown'
        });
        continue;
      }
      const internalRows = await searchSourceCorpus({
        storage,
        config,
        category: categoryConfig.category,
        query,
        limit: resultsPerQuery,
        missingFields,
        fieldOrder: categoryConfig.fieldOrder || [],
        logger
      });
      rawResults.push(...internalRows.map((row) => ({ ...row, query })));
      frontierDb?.recordQuery?.({
        productId: job.productId,
        query,
        provider: 'internal',
        fields: missingFields,
        results: internalRows
      });
      searchAttempts.push({
        query,
        provider: 'internal',
        result_count: internalRows.length,
        reason_code: 'internal_corpus_lookup'
      });
      searchJournal.push({
        ts: new Date().toISOString(),
        query,
        provider: 'internal',
        result_count: internalRows.length
      });
    }

    const internalUrlCount = new Set(
      rawResults
        .filter((row) => String(row.provider || '').toLowerCase() === 'internal')
        .map((row) => String(row.url || '').trim())
        .filter(Boolean)
    ).size;
    const requiresRequiredCoverage = requiredOnlySearch || missingRequiredFields.length > 0;
    internalSatisfied = requiresRequiredCoverage && internalUrlCount >= internalMinResults;

    if (requiresRequiredCoverage) {
      externalSearchReason = internalSatisfied
        ? 'internal_satisfied_skip_external'
        : 'required_fields_missing_internal_under_target';
    }
  }

  const canSearchInternet =
    providerState.provider !== 'none' && Boolean(providerState.internet_ready);

  if (canSearchInternet && !(internalFirst && internalSatisfied)) {
    const dualFallbackNoKeyProviders =
      providerState.provider === 'dual' &&
      !providerState.bing_ready &&
      !providerState.google_ready;
    const queryResults = await runWithConcurrency(
      queries.slice(0, queryLimit),
      queryConcurrency,
      async (query) => {
        if (frontierDb?.shouldSkipQuery?.({ productId: job.productId, query })) {
          return {
            providerResults: [],
            attempt: {
              query,
              provider: 'frontier',
              result_count: 0,
              reason_code: 'frontier_query_cooldown'
            },
            journal: {
              ts: new Date().toISOString(),
              query,
              provider: 'frontier',
              action: 'skip',
              reason: 'query_cooldown'
            }
          };
        }

        const startedAt = Date.now();
        logger?.info?.('discovery_query_started', {
          query,
          provider: config.searchProvider
        });
        const providerResults = await runSearchProviders({
          config,
          query,
          limit: resultsPerQuery,
          logger
        });
        const resultProviders = new Set(
          providerResults
            .map((row) => String(row?.provider || '').trim().toLowerCase())
            .filter(Boolean)
        );
        let reasonCode = 'internet_search';
        if (dualFallbackNoKeyProviders && resultProviders.size > 0) {
          if (resultProviders.size === 1 && resultProviders.has('searxng')) {
            reasonCode = 'dual_fallback_searxng_only';
          } else if (resultProviders.size === 1 && resultProviders.has('duckduckgo')) {
            reasonCode = 'dual_fallback_duckduckgo_only';
          } else {
            reasonCode = 'dual_fallback_mixed';
          }
        }
        const queryRecord = frontierDb?.recordQuery?.({
          productId: job.productId,
          query,
          provider: config.searchProvider,
          fields: missingFields,
          results: providerResults
        });
        if (runtimeTraceWriter && providerResults.length > 0) {
          const trace = await runtimeTraceWriter.writeJson({
            section: 'search',
            prefix: `query_${queryRecord?.query_hash || 'hash'}`,
            payload: {
              query,
              provider: config.searchProvider,
              result_count: providerResults.length,
              results: providerResults.slice(0, 20)
            },
            ringSize: 80
          });
          logger?.info?.('discovery_serp_written', {
            query,
            result_count: providerResults.length,
            trace_path: trace.trace_path
          });
        }
        const durationMs = Math.max(0, Date.now() - startedAt);
        logger?.info?.('discovery_query_completed', {
          query,
          provider: config.searchProvider,
          result_count: providerResults.length,
          duration_ms: durationMs
        });
        return {
          providerResults,
          attempt: {
            query,
            provider: config.searchProvider,
            result_count: providerResults.length,
            reason_code: reasonCode,
            duration_ms: durationMs
          },
          journal: {
            ts: new Date().toISOString(),
            query,
            provider: config.searchProvider,
            result_count: providerResults.length,
            reason_code: reasonCode,
            duration_ms: durationMs
          }
        };
      }
    );

    for (const row of queryResults) {
      if (!row) {
        continue;
      }
      rawResults.push(...(row.providerResults || []).map((result) => ({ ...result, query: row.attempt?.query || result.query })));
      if (row.attempt) {
        searchAttempts.push(row.attempt);
      }
      if (row.journal) {
        searchJournal.push(row.journal);
      }
    }
  } else if (rawResults.length === 0) {
    const planned = buildPlanOnlyResults({
      categoryConfig,
      queries,
      variables,
      maxQueries: Math.min(queryLimit, 12)
    });
    rawResults.push(...planned);
    searchAttempts.push({
      query: '',
      provider: 'plan',
      result_count: planned.length,
      reason_code: 'plan_only_no_provider'
    });
  }

  if (config.llmEnabled && hasLlmRouteApiKey(config, { role: 'triage' }) && variables.brand) {
    try {
      const enabledSources = typeof storage?.listEnabledSourceStrategies === 'function'
        ? storage.listEnabledSourceStrategies(variables.category)
        : [];
      const predictableSources = enabledSources
        .filter((s) => s.discovery_method === 'llm_predict' || s.discovery_method === 'search_first')
        .map((s) => ({ host: s.host, source_type: s.source_type, search_pattern: s.search_pattern || '' }));
      if (predictableSources.length > 0) {
        const urlPredictorCallLlm = createUrlPredictorCallLlm({
          callRoutedLlmFn: callLlmWithRouting,
          config
        });
        const predictedUrls = await predictSourceUrls({
          product: {
            brand: variables.brand,
            model: variables.model,
            variant: variables.variant,
            category: variables.category
          },
          knownSources: predictableSources,
          config,
          callLlmFn: urlPredictorCallLlm
        });
        for (const pred of predictedUrls) {
          rawResults.push({
            url: pred.url,
            title: `${pred.source_host} predicted`,
            snippet: 'LLM-predicted source URL',
            provider: 'url_prediction',
            host: pred.source_host,
            tier: pred.predicted_tier || 2,
            query: ''
          });
        }
        if (predictedUrls.length > 0) {
          logger?.info?.('url_prediction_seeded', {
            predicted_count: predictedUrls.length,
            sources: predictedUrls.map((p) => p.source_host).slice(0, 10)
          });
        }
      }
    } catch {
      // URL prediction is non-essential
    }
  }

  const { deduped: dedupedResults, stats: dedupeStats } = dedupeSerpResults(rawResults);
  logger?.info?.('discovery_serp_deduped', {
    total_input: dedupeStats.total_input,
    total_output: dedupeStats.total_output,
    duplicates_removed: dedupeStats.duplicates_removed,
    providers_seen: dedupeStats.providers_seen
  });

  const byUrl = new Map();
  const queryMetaByQuery = new Map(
    toArray(searchProfilePlanned?.query_rows).map((row) => [String(row?.query || '').trim(), row || {}])
  );
  const candidateTraceByUrl = new Map();
  const ensureTrace = (url, seed = {}) => {
    const key = String(url || '').trim();
    if (!key) return null;
    if (!candidateTraceByUrl.has(key)) {
      candidateTraceByUrl.set(key, {
        url: key,
        original_url: String(seed.original_url || key).trim(),
        host: String(seed.host || '').trim(),
        root_domain: String(seed.root_domain || '').trim(),
        title: String(seed.title || '').trim(),
        snippet: String(seed.snippet || '').trim(),
        tier_guess: Number.isFinite(Number(seed.tier_guess)) ? Number(seed.tier_guess) : null,
        tier_name_guess: String(seed.tier_name_guess || '').trim(),
        role: String(seed.role || '').trim(),
        doc_kind_guess: String(seed.doc_kind_guess || '').trim(),
        approved_domain: Boolean(seed.approved_domain),
        providers: uniqueTokens(seed.providers || [], 8),
        queries: uniqueTokens(seed.queries || [], 20),
        query_hints: uniqueTokens(seed.query_hints || [], 12),
        hint_sources: uniqueTokens(seed.hint_sources || [], 8),
        target_fields: uniqueTokens(seed.target_fields || [], 20),
        domain_hints: uniqueTokens(seed.domain_hints || [], 10),
        triage_score: null,
        triage_reason: '',
        decision: String(seed.decision || 'pending').trim() || 'pending',
        reason_codes: uniqueTokens(seed.reason_codes || [], 16)
      });
    }
    const row = candidateTraceByUrl.get(key);
    row.providers = uniqueTokens([...(row.providers || []), ...(seed.providers || [])], 8);
    row.queries = uniqueTokens([...(row.queries || []), ...(seed.queries || [])], 20);
    row.query_hints = uniqueTokens([...(row.query_hints || []), ...(seed.query_hints || [])], 12);
    row.hint_sources = uniqueTokens([...(row.hint_sources || []), ...(seed.hint_sources || [])], 8);
    row.target_fields = uniqueTokens([...(row.target_fields || []), ...(seed.target_fields || [])], 20);
    row.domain_hints = uniqueTokens([...(row.domain_hints || []), ...(seed.domain_hints || [])], 10);
    row.reason_codes = uniqueTokens([...(row.reason_codes || []), ...(seed.reason_codes || [])], 16);
    if (!row.title && seed.title) row.title = String(seed.title || '').trim();
    if (!row.snippet && seed.snippet) row.snippet = String(seed.snippet || '').trim();
    if (!row.host && seed.host) row.host = String(seed.host || '').trim();
    if (!row.root_domain && seed.root_domain) row.root_domain = String(seed.root_domain || '').trim();
    if (!row.doc_kind_guess && seed.doc_kind_guess) row.doc_kind_guess = String(seed.doc_kind_guess || '').trim();
    if (!row.role && seed.role) row.role = String(seed.role || '').trim();
    if (!row.tier_name_guess && seed.tier_name_guess) row.tier_name_guess = String(seed.tier_name_guess || '').trim();
    if (row.tier_guess === null && Number.isFinite(Number(seed.tier_guess))) {
      row.tier_guess = Number(seed.tier_guess);
    }
    if (seed.approved_domain) row.approved_domain = true;
    return row;
  };
  const manufacturerHostHints = manufacturerHostHintsForBrand(job.identityLock?.brand || '');
  for (const raw of dedupedResults) {
    try {
      const parsed = new URL(raw.url);
      const canonicalFromFrontier = frontierDb?.canonicalize?.(parsed.toString())?.canonical_url || parsed.toString();
      const queryList = uniqueTokens(
        [...toArray(raw.seen_in_queries), raw.query],
        20
      );
      const providerList = uniqueTokens(
        [...toArray(raw.seen_by_providers), raw.provider],
        8
      );
      const queryHintList = uniqueTokens(
        queryList.map((query) => String(queryMetaByQuery.get(query)?.doc_hint || '').trim()).filter(Boolean),
        12
      );
      const hintSourceList = uniqueTokens(
        queryList.map((query) => String(queryMetaByQuery.get(query)?.hint_source || '').trim()).filter(Boolean),
        8
      );
      const targetFieldList = uniqueTokens(
        queryList.flatMap((query) => toArray(queryMetaByQuery.get(query)?.target_fields)),
        20
      );
      const domainHintList = uniqueTokens(
        queryList.map((query) => String(queryMetaByQuery.get(query)?.domain_hint || '').trim()).filter(Boolean),
        10
      );
      const trace = ensureTrace(canonicalFromFrontier, {
        original_url: parsed.toString(),
        title: String(raw.title || '').trim(),
        snippet: String(raw.snippet || '').trim(),
        providers: providerList,
        queries: queryList,
        query_hints: queryHintList,
        hint_sources: hintSourceList,
        target_fields: targetFieldList,
        domain_hints: domainHintList
      });
      if (parsed.protocol !== 'https:') {
        if (trace) {
          trace.decision = 'rejected';
          trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'non_https'], 16);
        }
        continue;
      }
      const host = normalizeHost(parsed.hostname);
      if (!host || isDeniedHost(host, categoryConfig)) {
        if (trace) {
          trace.decision = 'rejected';
          trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'denied_host'], 16);
        }
        continue;
      }
      const skipByCooldown = frontierDb?.shouldSkipUrl?.(parsed.toString()) || { skip: false };
      if (skipByCooldown.skip) {
        if (trace) {
          trace.decision = 'rejected';
          trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'url_cooldown'], 16);
        }
        logger?.info?.('url_cooldown_applied', {
          url: parsed.toString(),
          status: null,
          cooldown_seconds: null,
          reason: skipByCooldown.reason || 'frontier_cooldown'
        });
        continue;
      }
      const classified = classifyUrlCandidate(raw, categoryConfig);
      if (
        classified.role === 'manufacturer' &&
        manufacturerHostHints.length > 0 &&
        !manufacturerHostMatchesBrand(classified.host, manufacturerHostHints)
      ) {
        if (trace) {
          trace.decision = 'rejected';
          trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'manufacturer_brand_mismatch'], 16);
        }
        continue;
      }
      if (!isRelevantSearchResult({
        parsed,
        raw,
        classified,
        variables
      })) {
        if (trace) {
          trace.decision = 'rejected';
          trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'low_relevance'], 16);
        }
        continue;
      }
      const canonical = canonicalFromFrontier;
      if (trace) {
        trace.host = classified.host;
        trace.root_domain = classified.rootDomain;
        trace.tier_guess = Number.isFinite(Number(classified.tier)) ? Number(classified.tier) : null;
        trace.tier_name_guess = String(classified.tierName || '').trim();
        trace.role = String(classified.role || '').trim();
        trace.doc_kind_guess = String(classified.doc_kind_guess || '').trim();
        trace.approved_domain = Boolean(classified.approvedDomain);
        trace.decision = 'eligible';
      }
      if (!byUrl.has(canonical)) {
        byUrl.set(canonical, {
          ...classified,
          url: canonical,
          original_url: parsed.toString(),
          seen_by_providers: providerList,
          seen_in_queries: queryList,
          cross_provider_count: providerList.length
        });
      } else {
        const existing = byUrl.get(canonical);
        existing.seen_by_providers = uniqueTokens([...(existing.seen_by_providers || []), ...providerList], 8);
        existing.seen_in_queries = uniqueTokens([...(existing.seen_in_queries || []), ...queryList], 20);
        existing.cross_provider_count = (existing.seen_by_providers || []).length;
      }
    } catch {
      // ignore malformed URL
    }
  }

  const deterministicReranked = rerankSearchResults({
    results: [...byUrl.values()],
    categoryConfig,
    missingFields,
    fieldYieldMap: learning.fieldYield
  });
  let reranked = deterministicReranked;
  let domainSafetyResults = null;
  if (config.llmEnabled && hasLlmRouteApiKey(config, { role: 'triage' })) {
    try {
      const uniqueDomains = [...new Set(
        [...byUrl.values()].map((r) => normalizeHost(r.host || '')).filter(Boolean)
      )];
      if (uniqueDomains.length > 0) {
        const domainSafetyCallLlm = createDomainSafetyCallLlm({
          callRoutedLlmFn: callLlmWithRouting,
          config
        });
        domainSafetyResults = await classifyDomains({
          domains: uniqueDomains,
          category: variables.category,
          config,
          callLlmFn: domainSafetyCallLlm,
          storage
        });
        const unsafeCount = [...(domainSafetyResults?.values?.() || [])].filter((v) => !v.safe).length;
        if (unsafeCount > 0) {
          logger?.info?.('domain_safety_gate', {
            total: uniqueDomains.length,
            unsafe: unsafeCount
          });
        }
      }
    } catch {
      // domain safety classification is non-essential
    }
  }

  const llmTriageEnabled = Boolean(uberMode || (config.llmEnabled && config.llmSerpRerankEnabled));
  let llmTriageApplied = false;
  if (llmTriageEnabled) {
    const llmReranked = await rerankSerpResults({
      config,
      logger,
      llmContext,
      identity: identityLock,
      missingFields,
      serpResults: [...byUrl.values()],
      frontier: frontierDb,
      topK: Math.max(discoveryCap, Number(config.discoveryResultsPerQuery || 10) * 2),
      domainSafetyResults
    });
    if (llmReranked.length > 0) {
      reranked = llmReranked;
      llmTriageApplied = true;
    }
  }
  const discovered = reranked.slice(0, discoveryCap);
  const discoveredUrlSet = new Set(discovered.map((item) => item.url));
  const ensureTierCoverage = (tierName) => {
    const hasTier = discovered.some(
      (item) => String(item.tier_name || item.tierName || '').toLowerCase() === tierName
    );
    if (hasTier) {
      return;
    }
    const candidate = reranked.find(
      (item) =>
        String(item.tier_name || item.tierName || '').toLowerCase() === tierName &&
        !discoveredUrlSet.has(item.url)
    );
    if (!candidate) {
      return;
    }
    if (discovered.length >= discoveryCap && discovered.length > 0) {
      const removed = discovered.pop();
      discoveredUrlSet.delete(removed.url);
    }
    discovered.push(candidate);
    discoveredUrlSet.add(candidate.url);
  };
  ensureTierCoverage('lab');
  ensureTierCoverage('database');
  if (runtimeTraceWriter) {
    const trace = await runtimeTraceWriter.writeJson({
      section: 'search',
      prefix: 'selected_urls',
      payload: {
        selected_count: discovered.length,
        selected_urls: discovered.slice(0, 80).map((row) => ({
          url: row.url,
          host: row.host,
          tier: row.tierName || row.tier_name || '',
          reason: row.rerank_reason || row.reason_code || ''
        }))
      },
      ringSize: 60
    });
    logger?.info?.('discovery_urls_selected', {
      selected_count: discovered.length,
      selected_hosts_top: [...new Set(discovered.slice(0, 20).map((row) => row.host).filter(Boolean))].slice(0, 10),
      trace_path: trace.trace_path
    });
  }
  logger?.info?.('discovery_results_reranked', {
    discovered_count: discovered.length,
    approved_count: discovered.filter((item) => item.approved_domain || item.approvedDomain).length
  });

  const approvedOnly = discovered.filter((item) => item.approved_domain || item.approvedDomain);
  const candidateOnly = discovered.filter((item) => !(item.approved_domain || item.approvedDomain));
  const queryAttemptStats = buildQueryAttemptStats(searchAttempts);
  const attemptMap = new Map(queryAttemptStats.map((row) => [row.query, row]));
  const queryRowsEnriched = toArray(searchProfilePlanned.query_rows).map((row) => {
    const attempt = attemptMap.get(String(row?.query || '').trim());
    return {
      ...row,
      result_count: attempt?.result_count || 0,
      attempts: attempt?.attempts || 0,
      providers: attempt?.providers || []
    };
  });

  const rerankedByUrl = new Map(
    reranked.map((row) => [String(row.url || '').trim(), row])
  );
  const selectedUrlSet = new Set(
    discovered.map((row) => String(row.url || '').trim()).filter(Boolean)
  );
  const { brandTokens, modelTokens } = normalizeIdentityTokens(variables);
  for (const trace of candidateTraceByUrl.values()) {
    const rerankedRow = rerankedByUrl.get(String(trace.url || '').trim());
    if (!rerankedRow) {
      if (trace.decision !== 'rejected') {
        trace.decision = 'rejected';
        trace.reason_codes = uniqueTokens([...(trace.reason_codes || []), 'triage_excluded'], 16);
      }
      continue;
    }

    const isSelected = selectedUrlSet.has(String(trace.url || '').trim());
    trace.decision = isSelected ? 'selected' : 'not_selected';
    trace.tier_guess = Number.isFinite(Number(rerankedRow.tier))
      ? Number(rerankedRow.tier)
      : (Number.isFinite(Number(trace.tier_guess)) ? Number(trace.tier_guess) : null);
    trace.tier_name_guess = String(rerankedRow.tier_name || rerankedRow.tierName || trace.tier_name_guess || '').trim();
    trace.approved_domain = Boolean(rerankedRow.approved_domain || rerankedRow.approvedDomain || trace.approved_domain);
    trace.doc_kind_guess = String(rerankedRow.doc_kind_guess || trace.doc_kind_guess || '').trim();
    trace.triage_score = Number.isFinite(Number(rerankedRow.rerank_score))
      ? Number(rerankedRow.rerank_score)
      : Number(rerankedRow.score || 0);
    trace.triage_reason = String(rerankedRow.rerank_reason || rerankedRow.reason_code || '').trim();

    const haystack = `${trace.title || ''} ${trace.snippet || ''} ${trace.url || ''}`.toLowerCase();
    const reasonCodes = [...(trace.reason_codes || [])];
    if (trace.approved_domain) reasonCodes.push('approved_domain');
    if (trace.tier_guess === 1) reasonCodes.push('tier_1');
    if (trace.tier_guess === 2) reasonCodes.push('tier_2');
    if (String(trace.doc_kind_guess || '').includes('pdf')) reasonCodes.push('doc_pdf');
    if ((rerankedRow.cross_provider_count || 0) > 1) reasonCodes.push('cross_provider_multi');
    if (countTokenHits(haystack, brandTokens) > 0) reasonCodes.push('brand_match');
    if (countTokenHits(haystack, modelTokens) > 0) reasonCodes.push('model_match');
    for (const query of trace.queries || []) {
      const meta = queryMetaByQuery.get(String(query || '').trim()) || {};
      if (meta?.domain_hint) {
        const hostToken = String(trace.host || '').toLowerCase();
        const hintToken = String(meta.domain_hint || '').toLowerCase().replace(/^www\./, '');
        if (hostToken && hintToken && hostToken.includes(hintToken)) {
          reasonCodes.push('domain_hint_match');
        }
      }
      if (docHintMatchesDocKind(meta?.doc_hint, trace.doc_kind_guess)) {
        reasonCodes.push('doc_hint_match');
      }
      if (String(meta?.hint_source || '').trim()) {
        reasonCodes.push(`hint:${String(meta.hint_source).trim()}`);
      }
    }
    reasonCodes.push(isSelected ? 'selected_top_k' : 'below_top_k_cutoff');
    trace.reason_codes = uniqueTokens(reasonCodes, 16);
  }

  const tracesByQuery = new Map();
  for (const trace of candidateTraceByUrl.values()) {
    for (const query of trace.queries || []) {
      const token = String(query || '').trim();
      if (!token) continue;
      if (!tracesByQuery.has(token)) {
        tracesByQuery.set(token, []);
      }
      tracesByQuery.get(token).push(trace);
    }
  }
  const decisionRank = {
    selected: 3,
    not_selected: 2,
    rejected: 1,
    eligible: 1,
    pending: 0
  };
  const serpQueryRows = queryRowsEnriched.map((row) => {
    const queryText = String(row?.query || '').trim();
    const traces = [...(tracesByQuery.get(queryText) || [])]
      .sort((a, b) => {
        const decisionCmp = (decisionRank[b.decision] || 0) - (decisionRank[a.decision] || 0);
        if (decisionCmp !== 0) return decisionCmp;
        const scoreCmp = Number(b.triage_score || 0) - Number(a.triage_score || 0);
        if (scoreCmp !== 0) return scoreCmp;
        return String(a.url || '').localeCompare(String(b.url || ''));
      })
      .slice(0, 40)
      .map((trace) => ({
        url: trace.url,
        title: String(trace.title || '').slice(0, 220),
        snippet: String(trace.snippet || '').slice(0, 260),
        host: trace.host,
        tier: trace.tier_guess,
        tier_name: trace.tier_name_guess,
        doc_kind: trace.doc_kind_guess || 'other',
        triage_score: Number.isFinite(Number(trace.triage_score))
          ? Number(Number(trace.triage_score).toFixed(3))
          : 0,
        triage_reason: trace.triage_reason || '',
        decision: trace.decision || 'pending',
        reason_codes: uniqueTokens(trace.reason_codes || [], 8),
        providers: uniqueTokens(trace.providers || [], 6)
      }));
    const selectedCount = traces.filter((item) => item.decision === 'selected').length;
    return {
      query: queryText,
      hint_source: String(row?.hint_source || '').trim(),
      target_fields: toArray(row?.target_fields),
      doc_hint: String(row?.doc_hint || '').trim(),
      domain_hint: String(row?.domain_hint || '').trim(),
      result_count: Number(row?.result_count || 0),
      attempts: Number(row?.attempts || 0),
      providers: toArray(row?.providers),
      candidate_count: traces.length,
      selected_count: selectedCount,
      candidates: traces
    };
  });
  const candidateTraceRows = [...candidateTraceByUrl.values()];
  const serpExplorer = {
    generated_at: new Date().toISOString(),
    provider: config.searchProvider,
    llm_triage_enabled: llmTriageEnabled,
    llm_triage_applied: llmTriageApplied,
    llm_triage_model: llmTriageEnabled
      ? String(
        config.llmModelTriage ||
        config.cortexModelRerankFast ||
        config.cortexModelSearchFast ||
        config.llmModelFast ||
        ''
      ).trim()
      : '',
    query_count: serpQueryRows.length,
    candidates_checked: candidateTraceRows.length,
    urls_triaged: reranked.length,
    urls_selected: selectedUrlSet.size,
    urls_rejected: candidateTraceRows.filter((row) => row.decision === 'rejected').length,
    dedupe_input: dedupeStats.total_input,
    dedupe_output: dedupeStats.total_output,
    duplicates_removed: dedupeStats.duplicates_removed,
    queries: serpQueryRows
  };

  const searchProfileFinal = {
    ...searchProfilePlanned,
    generated_at: new Date().toISOString(),
    status: 'executed',
    query_rows: queryRowsEnriched,
    query_stats: queryAttemptStats,
    discovered_count: discovered.length,
    approved_count: approvedOnly.length,
    candidate_count: candidateOnly.length,
    llm_query_planning: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
    llm_query_model: String(config.llmModelPlan || '').trim(),
    llm_serp_triage: llmTriageEnabled,
    llm_serp_triage_model: String(config.llmModelTriage || config.cortexModelRerankFast || config.cortexModelSearchFast || config.llmModelFast || '').trim(),
    serp_explorer: serpExplorer
  };
  await writeSearchProfileArtifacts({
    storage,
    payload: searchProfileFinal,
    keys: searchProfileKeys
  });

  const discoveryKey = toPosixKey(
    config.s3InputPrefix,
    '_discovery',
    categoryConfig.category,
    `${runId}.json`
  );
  const candidatesKey = toPosixKey(
    config.s3InputPrefix,
    '_sources',
    'candidates',
    categoryConfig.category,
    `${runId}.json`
  );

  const discoveryPayload = {
    category: categoryConfig.category,
    productId: job.productId,
    runId,
    generated_at: new Date().toISOString(),
    provider: config.searchProvider,
    provider_state: providerState,
    query_concurrency: queryConcurrency,
    llm_query_planning: Boolean(config.llmEnabled && config.llmPlanDiscoveryQueries),
    llm_query_model: String(config.llmModelPlan || '').trim(),
    llm_serp_triage: llmTriageEnabled,
    llm_serp_triage_model: String(config.llmModelTriage || config.cortexModelRerankFast || config.cortexModelSearchFast || config.llmModelFast || '').trim(),
    query_count: queries.length,
    query_reject_count: toArray(searchProfileFinal?.query_reject_log).length,
    discovered_count: discovered.length,
    approved_count: approvedOnly.length,
    candidate_count: candidateOnly.length,
    queries,
    query_guard: searchProfileFinal.query_guard || null,
    query_reject_log: toArray(searchProfileFinal.query_reject_log).slice(0, 200),
    llm_queries: llmQueries,
    search_profile_key: searchProfileKeys.inputKey,
    search_profile_run_key: searchProfileKeys.runKey,
    search_profile_latest_key: searchProfileKeys.latestKey,
    uber_search_plan: uberSearchPlan || null,
    targeted_missing_fields: missingFields,
    internal_satisfied: internalSatisfied,
    external_search_reason: externalSearchReason,
    search_attempts: searchAttempts,
    search_journal: searchJournal,
    serp_explorer: serpExplorer,
    discovered
  };
  const candidatePayload = {
    category: categoryConfig.category,
    productId: job.productId,
    runId,
    generated_at: new Date().toISOString(),
    candidate_count: candidateOnly.length,
    candidates: candidateOnly
  };

  await storage.writeObject(
    discoveryKey,
    Buffer.from(JSON.stringify(discoveryPayload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );
  await storage.writeObject(
    candidatesKey,
    Buffer.from(JSON.stringify(candidatePayload, null, 2), 'utf8'),
    { contentType: 'application/json' }
  );

  return {
    enabled: true,
    discoveryKey,
    candidatesKey,
    candidates: discovered,
    approvedUrls: approvedOnly.map((item) => item.url),
    candidateUrls: candidateOnly.map((item) => item.url),
    queries,
    llm_queries: llmQueries,
    search_profile: searchProfileFinal,
    search_profile_key: searchProfileKeys.inputKey,
    search_profile_run_key: searchProfileKeys.runKey,
    search_profile_latest_key: searchProfileKeys.latestKey,
    provider_state: providerState,
    query_concurrency: queryConcurrency,
    uber_search_plan: uberSearchPlan || null,
    internal_satisfied: internalSatisfied,
    external_search_reason: externalSearchReason,
    search_attempts: searchAttempts,
    search_journal: searchJournal,
    serp_explorer: serpExplorer
  };
}
