import crypto from 'node:crypto';
import { ruleUnit } from '../engine/ruleAccessors.js';
import { generateStableSnippetId } from '../index/evidenceIndexDb.js';
import { toTierNumber, parseTierPreferenceFromRule, parseTierPreferenceFromNeedRow } from '../utils/tierHelpers.js';

const DEFAULT_TIER_WEIGHTS = new Map([
  [1, 3],
  [2, 2],
  [3, 1],
  [4, 0.65],
  [5, 0.4]
]);

const DOC_KIND_WEIGHTS = new Map([
  ['manual_pdf', 1.5],
  ['manual', 1.4],
  ['spec_pdf', 1.4],
  ['spec', 1.35],
  ['support', 1.1],
  ['lab_review', 0.95],
  ['teardown_review', 0.9],
  ['product_page', 0.75],
  ['other', 0.55]
]);

const METHOD_WEIGHTS = new Map([
  ['table', 1.25],
  ['kv', 1.15],
  ['json_ld', 1.1],
  ['window', 0.95],
  ['text', 0.9],
  ['extract', 0.9],
  ['llm_extract', 0.85],
  ['helper_supportive', 0.65]
]);

const FIELD_HINT_SYNONYMS = {
  polling_rate: ['polling rate', 'report rate', 'hz', '8k', '8000hz'],
  dpi: ['dpi', 'cpi', 'sensitivity'],
  sensor: ['sensor', 'paw3395', 'hero 2', 'focus pro'],
  weight: ['weight', 'grams', 'g'],
  width: ['width', 'grip width'],
  height: ['height'],
  length: ['length', 'depth'],
  lngth: ['length', 'depth'],
  connection: ['connection', 'connectivity', 'wireless', 'wired'],
  connectivity: ['connectivity', 'wireless', 'wired', 'bluetooth', '2.4ghz']
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}


function uniqueStrings(values = [], limit = 24) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const token = String(value || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= Math.max(1, Number(limit || 24))) break;
  }
  return out;
}

function extractHost(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}


function buildTierWeightLookup(tierPreference = []) {
  const lookup = new Map(DEFAULT_TIER_WEIGHTS);
  const unique = uniqueStrings(
    toArray(tierPreference).map((value) => String(toTierNumber(value) || '')).filter(Boolean),
    8
  ).map((value) => Number.parseInt(value, 10));
  if (unique.length === 0) return lookup;
  const maxDefaultWeight = Math.max(...DEFAULT_TIER_WEIGHTS.values());
  for (let idx = 0; idx < unique.length; idx += 1) {
    const tier = unique[idx];
    const boost = Math.max(0, 1.25 - (idx * 0.12));
    const positionBase = maxDefaultWeight - (idx * 0.4);
    const base = Math.max(positionBase, lookup.get(tier) || (1 / Math.max(1, tier)));
    lookup.set(tier, Number((base * boost).toFixed(6)));
  }
  return lookup;
}

function inferDocKind({ url = '', method = '', hint = '' } = {}) {
  const token = `${String(url || '').toLowerCase()} ${String(method || '').toLowerCase()} ${String(hint || '').toLowerCase()}`;
  if (token.includes('.pdf')) {
    if (token.includes('manual') || token.includes('user-guide')) return 'manual_pdf';
    return 'spec_pdf';
  }
  if (token.includes('manual') || token.includes('user guide')) return 'manual';
  if (token.includes('spec') || token.includes('datasheet') || token.includes('technical')) return 'spec';
  if (token.includes('support') || token.includes('driver') || token.includes('firmware')) return 'support';
  if (token.includes('teardown') || token.includes('disassembly')) return 'teardown_review';
  if (token.includes('review') || token.includes('benchmark') || token.includes('rtings') || token.includes('techpowerup')) return 'lab_review';
  if (token.includes('/product') || token.includes('/products/')) return 'product_page';
  return 'other';
}

function splitFieldTokenVariants(fieldKey = '') {
  const raw = String(fieldKey || '').trim().toLowerCase();
  if (!raw) return [];
  const underscore = raw.replace(/_/g, ' ');
  const compact = raw.replace(/[^a-z0-9]+/g, '');
  return uniqueStrings([raw, underscore, compact], 6);
}

function resolveParseTemplateHint(fieldRule = {}) {
  const direct = String(fieldRule.parse_template || '').trim();
  if (direct) return direct;
  const parse = isObject(fieldRule.parse) ? fieldRule.parse : {};
  const parseTemplate = String(parse.template || '').trim();
  if (parseTemplate) return parseTemplate;
  const extraction = isObject(fieldRule.extraction) ? fieldRule.extraction : {};
  return String(extraction.template || '').trim();
}

function componentHint(fieldRule = {}) {
  const component = isObject(fieldRule.component) ? fieldRule.component : {};
  const hints = [
    String(component.type || '').trim(),
    String(component.entity_set || '').trim(),
    String(component.db_key || '').trim()
  ].filter(Boolean);
  return hints.join(' | ');
}

function collectAnchorTerms({ fieldKey = '', fieldRule = {} } = {}) {
  const searchHints = isObject(fieldRule.search_hints) ? fieldRule.search_hints : {};
  const ui = isObject(fieldRule.ui) ? fieldRule.ui : {};
  const base = splitFieldTokenVariants(fieldKey);
  const synonyms = toArray(FIELD_HINT_SYNONYMS[fieldKey] || [])
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const searchTerms = toArray(searchHints.query_terms)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const labels = [
    String(fieldRule.label || '').trim(),
    String(ui.label || '').trim(),
    String(fieldRule.description || '').trim(),
    String(ui.tooltip || '').trim()
  ]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 2);
  return uniqueStrings([...searchTerms, ...synonyms, ...base, ...labels], 16);
}

function identityTokens(identity = {}) {
  const raw = [
    identity.brand,
    identity.model,
    identity.variant,
    identity.sku
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
  const words = raw
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  const compact = normalizeToken(raw);
  return uniqueStrings([...words, compact].filter(Boolean), 20);
}

function countMatches(text, terms = []) {
  const haystack = normalizeText(text);
  if (!haystack) return [];
  const out = [];
  for (const term of terms || []) {
    const needle = normalizeText(term);
    if (!needle || needle.length < 2) continue;
    if (haystack.includes(needle)) out.push(needle);
  }
  return uniqueStrings(out, 20);
}

function makeSnippetId({ fieldKey = '', url = '', quote = '', index = 0, contentHash = '' } = {}) {
  const hash = String(contentHash || '').trim();
  if (hash) {
    return generateStableSnippetId({ contentHash: hash, parserVersion: 'v1', chunkIndex: index });
  }
  const quoteText = String(quote || '').trim();
  if (quoteText) {
    const fallbackHash = `sha256:${crypto.createHash('sha256').update(quoteText, 'utf8').digest('hex')}`;
    return generateStableSnippetId({ contentHash: fallbackHash, parserVersion: 'v1', chunkIndex: index });
  }
  const seed = `${String(fieldKey || '').trim()}|${String(url || '').trim()}|${index}`;
  const seedHash = `sha256:${crypto.createHash('sha256').update(seed, 'utf8').digest('hex')}`;
  return generateStableSnippetId({ contentHash: seedHash, parserVersion: 'v1', chunkIndex: index });
}

function sanitizePreview(value, maxLen = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trim()}...`;
}

function scoreEvidenceHit({
  evidence = {},
  fieldKey = '',
  anchors = [],
  unitHint = '',
  identity = {},
  tierWeightLookup = new Map(DEFAULT_TIER_WEIGHTS)
} = {}) {
  const quote = String(evidence.quote || evidence.snippet_text || '').trim();
  const keyPath = String(evidence.key_path || evidence.keyPath || '').trim();
  const url = String(evidence.url || '').trim();
  const host = String(evidence.host || extractHost(url)).trim().toLowerCase();
  const method = String(evidence.method || evidence.extraction_method || '').trim().toLowerCase();
  const tier = toTierNumber(evidence.tier ?? evidence.tier_name ?? evidence.tierName);
  const docKind = inferDocKind({
    url,
    method,
    hint: `${evidence.doc_kind || ''} ${evidence.tier_name || ''}`
  });

  const searchSurface = `${quote} ${keyPath} ${url}`;
  const anchorMatches = countMatches(searchSurface, anchors);
  const identityMatches = countMatches(searchSurface, identityTokens(identity));
  const unitToken = normalizeText(unitHint);
  const unitMatch = unitToken ? normalizeText(searchSurface).includes(unitToken) : false;
  const directField = normalizeText(String(evidence.origin_field || '')) === normalizeText(fieldKey);

  const tierWeight = tier ? (tierWeightLookup.get(tier) || DEFAULT_TIER_WEIGHTS.get(tier) || 0.45) : 0.35;
  const docWeight = DOC_KIND_WEIGHTS.get(docKind) || DOC_KIND_WEIGHTS.get('other') || 0.55;
  const methodWeight = METHOD_WEIGHTS.get(method) || 0.85;

  const anchorScore = Math.min(1.8, anchorMatches.length * 0.42);
  const identityScore = Math.min(1.4, identityMatches.length * 0.28);
  const unitScore = unitMatch ? 0.35 : 0;
  const directScore = directField ? 0.65 : 0;

  const totalScore = Number((
    (tierWeight * 2.6)
    + (docWeight * 1.5)
    + (methodWeight * 0.85)
    + anchorScore
    + identityScore
    + unitScore
    + directScore
  ).toFixed(6));

  const reasonBadges = [];
  if (tier && tier <= 2) reasonBadges.push('tier_preferred');
  if (anchorMatches.length > 0) reasonBadges.push('anchor_match');
  if (unitMatch) reasonBadges.push('unit_match');
  if (identityMatches.length > 0) reasonBadges.push('identity_match');
  if (method.includes('table') || method.includes('kv')) reasonBadges.push('table_fact');
  if (docKind.includes('manual') || docKind.includes('spec')) reasonBadges.push('doc_authoritative');

  return {
    url,
    host,
    source_key: String(evidence.root_domain || host || '').trim().toLowerCase(),
    tier: tier ?? null,
    tier_name: String(evidence.tier_name || evidence.tierName || '').trim() || null,
    doc_kind: docKind,
    method,
    key_path: keyPath || null,
    snippet_id: String(evidence.snippet_id || evidence.snippetId || '').trim(),
    snippet_hash: String(evidence.snippet_hash || evidence.snippetHash || '').trim() || null,
    source_id: String(evidence.source_id || evidence.sourceId || '').trim() || null,
    file_uri: String(evidence.file_uri || evidence.storage_uri || '').trim() || null,
    mime_type: String(evidence.mime_type || '').trim() || null,
    content_hash: String(evidence.content_hash || '').trim() || null,
    surface: String(evidence.surface || '').trim() || null,
    quote_preview: sanitizePreview(quote, 320),
    retrieved_at: String(evidence.retrieved_at || '').trim() || null,
    evidence_refs: uniqueStrings(toArray(evidence.evidence_refs), 12),
    score: totalScore,
    reason_badges: uniqueStrings(reasonBadges, 8),
    ranking_features: {
      tier_weight: Number(tierWeight.toFixed(6)),
      doc_kind_weight: Number(docWeight.toFixed(6)),
      method_weight: Number(methodWeight.toFixed(6)),
      anchor_matches: anchorMatches,
      identity_matches: identityMatches,
      unit_match: unitMatch,
      direct_field_match: directField,
      total_score: totalScore
    }
  };
}

function normalizeEvidenceRow(fieldKey = '', row = {}, bucket = {}) {
  const candidate = isObject(row) ? row : {};
  const url = String(candidate.url || candidate.reference_url || '').trim();
  const quote = String(candidate.quote || candidate.snippet_text || '').trim();
  return {
    origin_field: fieldKey,
    value: String(bucket.value || '').trim() || null,
    url,
    host: String(candidate.host || extractHost(url)).trim().toLowerCase(),
    root_domain: String(candidate.rootDomain || candidate.root_domain || '').trim().toLowerCase(),
    tier: candidate.tier ?? candidate.tier_name ?? candidate.tierName ?? null,
    tier_name: String(candidate.tier_name || candidate.tierName || '').trim() || null,
    method: String(candidate.method || candidate.extraction_method || '').trim().toLowerCase(),
    key_path: String(candidate.keyPath || candidate.key_path || '').trim() || null,
    snippet_id: String(candidate.snippet_id || candidate.snippetId || '').trim() || null,
    snippet_hash: String(candidate.snippet_hash || candidate.snippetHash || '').trim() || null,
    source_id: String(candidate.source_id || candidate.sourceId || '').trim() || null,
    file_uri: String(candidate.file_uri || candidate.storage_uri || '').trim() || null,
    mime_type: String(candidate.mime_type || '').trim() || null,
    content_hash: String(candidate.content_hash || '').trim() || null,
    surface: String(candidate.surface || '').trim() || null,
    quote,
    snippet_text: String(candidate.snippet_text || '').trim() || quote,
    retrieved_at: String(candidate.retrieved_at || '').trim() || null,
    evidence_refs: toArray(candidate.evidence_refs || candidate.evidenceRefs)
  };
}

function normalizeEvidencePackSnippets(evidencePack = {}) {
  if (!evidencePack) return [];
  if (Array.isArray(evidencePack.snippets)) {
    return evidencePack.snippets
      .map((row) => (isObject(row) ? row : null))
      .filter(Boolean);
  }
  if (isObject(evidencePack.snippets)) {
    return Object.entries(evidencePack.snippets)
      .map(([id, row]) => ({
        ...(isObject(row) ? row : {}),
        id: String(row?.id || id || '').trim()
      }))
      .filter((row) => isObject(row));
  }
  return [];
}

function pushPoolRow(pool = [], dedupe = new Set(), row = {}) {
  const normalized = normalizeEvidenceRow(row.origin_field || '', row, { value: row.value || '' });
  if (row.source_identity_match !== undefined) normalized.source_identity_match = row.source_identity_match;
  if (row.source_identity_score !== undefined) normalized.source_identity_score = row.source_identity_score;
  const fingerprint = [
    normalized.url,
    normalized.snippet_id,
    normalizeText(normalized.quote),
    normalized.origin_field
  ].join('|');
  if (!normalized.url || !normalized.quote || dedupe.has(fingerprint)) {
    return false;
  }
  dedupe.add(fingerprint);
  pool.push(normalized);
  return true;
}

export function buildEvidencePoolFromProvenance(provenance = {}) {
  const pool = [];
  const byFingerprint = new Set();
  for (const [fieldKey, bucketRaw] of Object.entries(provenance || {})) {
    const bucket = isObject(bucketRaw) ? bucketRaw : {};
    for (const row of toArray(bucket.evidence)) {
      const normalized = normalizeEvidenceRow(fieldKey, row, bucket);
      const fingerprint = [
        normalized.url,
        normalized.snippet_id,
        normalizeText(normalized.quote),
        normalized.origin_field
      ].join('|');
      if (!normalized.url || !normalized.quote || byFingerprint.has(fingerprint)) continue;
      byFingerprint.add(fingerprint);
      pool.push(normalized);
    }
  }
  return pool;
}

export function buildEvidencePoolFromSourceResults(sourceResults = [], options = {}) {
  const pool = [];
  const dedupe = new Set();
  const maxRows = Math.max(100, Math.min(20_000, Number(options.maxRows || 4_000)));
  const maxSnippetsPerSource = Math.max(8, Math.min(300, Number(options.maxSnippetsPerSource || 120)));

  for (const source of toArray(sourceResults)) {
    if (pool.length >= maxRows) break;
    const fallbackUrl = String(source?.finalUrl || source?.url || '').trim();
    const fallbackHost = String(source?.host || extractHost(fallbackUrl)).trim().toLowerCase();
    const sourceIdentity = isObject(source?.identity) ? source.identity : {};
    const baseMeta = {
      host: fallbackHost,
      root_domain: String(source?.rootDomain || fallbackHost).trim().toLowerCase(),
      tier: source?.tier ?? null,
      tier_name: String(source?.tierName || '').trim() || null,
      source_id: String(source?.sourceId || source?.source_id || fallbackHost || 'source').trim(),
      retrieved_at: String(source?.ts || '').trim() || null,
      source_identity_match: sourceIdentity.match !== undefined ? Boolean(sourceIdentity.match) : null,
      source_identity_score: Number.isFinite(Number(sourceIdentity.score)) ? Number(sourceIdentity.score) : null
    };

    const evidencePack = source?.llmEvidencePack || {};
    const snippets = normalizeEvidencePackSnippets(evidencePack);
    const snippetById = new Map();
    for (const row of snippets) {
      const id = String(row?.id || '').trim();
      if (id) snippetById.set(id, row);
    }

    for (const candidate of toArray(source?.fieldCandidates)) {
      if (pool.length >= maxRows) break;
      const originField = String(candidate?.field || '').trim();
      const candidateValue = String(candidate?.value || '').trim();
      const candidateEvidenceRows = toArray(candidate?.evidence);
      const candidateEvidenceRefs = toArray(candidate?.evidenceRefs)
        .map((value) => String(value || '').trim())
        .filter(Boolean);

      for (const evidence of candidateEvidenceRows) {
        if (pool.length >= maxRows) break;
        pushPoolRow(pool, dedupe, {
          ...baseMeta,
          ...evidence,
          origin_field: originField,
          value: candidateValue,
          url: String(evidence?.url || fallbackUrl).trim(),
          host: String(evidence?.host || baseMeta.host).trim().toLowerCase(),
          root_domain: String(evidence?.rootDomain || evidence?.root_domain || baseMeta.root_domain).trim().toLowerCase(),
          tier: evidence?.tier ?? baseMeta.tier,
          tier_name: String(evidence?.tierName || evidence?.tier_name || baseMeta.tier_name || '').trim() || null,
          method: String(evidence?.method || evidence?.extraction_method || '').trim().toLowerCase(),
          key_path: String(evidence?.keyPath || evidence?.key_path || '').trim() || null,
          snippet_id: String(evidence?.snippet_id || evidence?.snippetId || '').trim() || null,
          snippet_hash: String(evidence?.snippet_hash || evidence?.snippetHash || '').trim() || null,
          quote: String(evidence?.quote || evidence?.snippet_text || '').trim(),
          snippet_text: String(evidence?.snippet_text || evidence?.quote || '').trim(),
          evidence_refs: toArray(evidence?.evidence_refs || evidence?.evidenceRefs || candidateEvidenceRefs)
        });
      }

      for (const refId of candidateEvidenceRefs) {
        if (pool.length >= maxRows) break;
        const snippet = snippetById.get(refId);
        if (!snippet) continue;
        pushPoolRow(pool, dedupe, {
          ...baseMeta,
          origin_field: originField,
          value: candidateValue,
          url: String(snippet?.url || fallbackUrl).trim(),
          method: String(snippet?.extraction_method || snippet?.type || '').trim().toLowerCase(),
          key_path: String(snippet?.key_path || '').trim() || null,
          snippet_id: String(snippet?.id || '').trim() || null,
          snippet_hash: String(snippet?.snippet_hash || '').trim() || null,
          file_uri: String(snippet?.file_uri || '').trim() || null,
          mime_type: String(snippet?.mime_type || '').trim() || null,
          content_hash: String(snippet?.content_hash || '').trim() || null,
          surface: String(snippet?.surface || '').trim() || null,
          quote: String(snippet?.text || snippet?.normalized_text || '').trim(),
          snippet_text: String(snippet?.normalized_text || snippet?.text || '').trim(),
          evidence_refs: [refId]
        });
      }
    }

    const snippetsToScan = snippets.slice(0, maxSnippetsPerSource);
    for (const snippet of snippetsToScan) {
      if (pool.length >= maxRows) break;
      const snippetHints = toArray(snippet?.field_hints)
        .map((value) => String(value || '').trim())
        .filter(Boolean);
      const originField = snippetHints[0] || '';
      pushPoolRow(pool, dedupe, {
        ...baseMeta,
        origin_field: originField,
        value: null,
        url: String(snippet?.url || fallbackUrl).trim(),
        method: String(snippet?.extraction_method || snippet?.type || '').trim().toLowerCase(),
        key_path: String(snippet?.key_path || '').trim() || null,
        snippet_id: String(snippet?.id || '').trim() || null,
        snippet_hash: String(snippet?.snippet_hash || '').trim() || null,
        file_uri: String(snippet?.file_uri || '').trim() || null,
        mime_type: String(snippet?.mime_type || '').trim() || null,
        content_hash: String(snippet?.content_hash || '').trim() || null,
        surface: String(snippet?.surface || '').trim() || null,
        quote: String(snippet?.text || snippet?.normalized_text || '').trim(),
        snippet_text: String(snippet?.normalized_text || snippet?.text || '').trim(),
        evidence_refs: String(snippet?.id || '').trim() ? [String(snippet.id).trim()] : []
      });
    }
  }

  return pool;
}

const IDENTITY_FILTERABLE_LEVELS = new Set(['identity', 'critical']);

export function filterByIdentityGate({ hits = [], requiredLevel = 'optional', identityFilterEnabled = false } = {}) {
  if (!identityFilterEnabled || !IDENTITY_FILTERABLE_LEVELS.has(String(requiredLevel || '').trim().toLowerCase())) {
    return { accepted: [...hits], rejected: [] };
  }
  const accepted = [];
  const rejected = [];
  for (const hit of hits) {
    if (hit.source_identity_match === false) {
      rejected.push({ ...hit, rejection_reason: 'identity_mismatch' });
    } else {
      accepted.push(hit);
    }
  }
  return { accepted, rejected };
}

export function buildTierAwareFieldRetrieval({
  fieldKey = '',
  needRow = {},
  fieldRule = {},
  evidencePool = [],
  identity = {},
  maxHits = 24,
  ftsQueryFn = null,
  identityFilterEnabled = false,
  traceEnabled = false
} = {}) {
  const key = String(fieldKey || '').trim();
  const cap = Math.max(1, Math.min(80, Number(maxHits || 24)));
  if (!key) {
    return {
      field_key: '',
      hits: []
    };
  }

  const anchors = collectAnchorTerms({ fieldKey: key, fieldRule });
  const unitHint = String(ruleUnit(fieldRule) || '').trim();
  const tierPreference = parseTierPreferenceFromNeedRow(needRow, fieldRule);
  const tierWeightLookup = buildTierWeightLookup(tierPreference);
  const docHints = uniqueStrings(
    toArray(fieldRule?.search_hints?.preferred_content_types).map((value) => String(value || '').trim()),
    8
  );
  const templateHint = resolveParseTemplateHint(fieldRule);
  const componentHintValue = componentHint(fieldRule);

  const hits = [];
  const seen = new Set();

  const ftsResults = typeof ftsQueryFn === 'function'
    ? (() => { try { return ftsQueryFn({ fieldKey: key, anchors, unitHint }); } catch { return null; } })()
    : null;
  const pool = (Array.isArray(ftsResults) && ftsResults.length > 0) ? ftsResults : (evidencePool || []);

  let poolRowsScanned = 0;
  let anchorMatchCount = 0;
  let noAnchorSkipCount = 0;
  const rejectedHits = [];

  for (const row of pool) {
    poolRowsScanned += 1;
    const scored = scoreEvidenceHit({
      evidence: row,
      fieldKey: key,
      anchors,
      unitHint,
      identity,
      tierWeightLookup
    });
    scored.source_identity_match = row.source_identity_match ?? null;
    scored.source_identity_score = row.source_identity_score ?? null;
    const directField = normalizeText(String(row.origin_field || '')) === normalizeText(key);
    if (!directField && scored.ranking_features.anchor_matches.length === 0 && !scored.ranking_features.unit_match) {
      noAnchorSkipCount += 1;
      if (traceEnabled && rejectedHits.length < 20) {
        rejectedHits.push({ url: scored.url, host: scored.host, score: scored.score, rejection_reason: 'no_anchor', ranking_features: scored.ranking_features });
      }
      continue;
    }
    anchorMatchCount += 1;
    const fingerprint = `${scored.url}|${scored.snippet_id || ''}|${normalizeText(scored.quote_preview)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    hits.push(scored);
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aTier = Number.isFinite(Number(a.tier)) ? Number(a.tier) : 99;
    const bTier = Number.isFinite(Number(b.tier)) ? Number(b.tier) : 99;
    if (aTier !== bTier) return aTier - bTier;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });

  const requiredLevel = String(needRow.required_level || '').trim().toLowerCase() || 'optional';
  const identityGate = filterByIdentityGate({
    hits,
    requiredLevel,
    identityFilterEnabled
  });
  const identityFilteredCount = identityGate.rejected.length;
  if (traceEnabled) {
    for (const rej of identityGate.rejected.slice(0, 20 - rejectedHits.length)) {
      rejectedHits.push({ url: rej.url, host: rej.host, score: rej.score, rejection_reason: rej.rejection_reason, ranking_features: rej.ranking_features });
    }
  }

  const topHits = identityGate.accepted.slice(0, cap).map((row, idx) => ({
    ...row,
    rank: idx + 1,
    snippet_id: row.snippet_id || makeSnippetId({
      fieldKey: key,
      url: row.url,
      quote: row.quote_preview,
      index: idx + 1,
      contentHash: row.content_hash || ''
    })
  }));

  const identityParts = [identity.brand, identity.model, identity.variant]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const retrievalQuery = [
    identityParts,
    ...anchors.slice(0, 6),
    unitHint,
    templateHint,
    componentHintValue
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' | ');

  const preferredTierHitCount = topHits.filter((h) => tierPreference.includes(h.tier)).length;
  const minRefsRequired = Math.max(1, Number(needRow.min_refs || 1));
  const minRefsGap = Math.max(0, minRefsRequired - topHits.length);
  const missReasons = [];
  if (poolRowsScanned === 0) missReasons.push('pool_empty');
  if (poolRowsScanned > 0 && anchorMatchCount === 0) missReasons.push('no_anchor');
  if (anchorMatchCount > 0 && preferredTierHitCount === 0) missReasons.push('tier_deficit');
  if (identityFilteredCount > 0 && topHits.length === 0) missReasons.push('identity_mismatch');
  const missStatus = topHits.length >= minRefsRequired
    ? 'satisfied'
    : (topHits.length > 0 ? 'partial' : 'miss');

  const missDiagnostics = {
    status: missStatus,
    reasons: missReasons,
    pool_rows_scanned: poolRowsScanned,
    anchor_match_count: anchorMatchCount,
    preferred_tier_hit_count: preferredTierHitCount,
    identity_filtered_count: identityFilteredCount,
    min_refs_gap: minRefsGap
  };

  const result = {
    field_key: key,
    required_level: requiredLevel,
    need_score: Number(needRow.need_score || 0),
    tier_preference: tierPreference,
    anchors,
    unit_hint: unitHint || null,
    parse_template_hint: templateHint || null,
    component_hint: componentHintValue || null,
    doc_hints: docHints,
    retrieval_query: retrievalQuery,
    hits: topHits,
    identity_rejected: identityGate.rejected,
    miss_diagnostics: missDiagnostics
  };

  if (traceEnabled) {
    result.trace = {
      query: retrievalQuery,
      pool_size: poolRowsScanned,
      scored_count: anchorMatchCount,
      accepted_count: topHits.length,
      rejected_count: noAnchorSkipCount + identityFilteredCount,
      identity_filtered_count: identityFilteredCount,
      rejected_hits: rejectedHits.slice(0, 20),
      filter_stats: {
        no_anchor: noAnchorSkipCount,
        identity_mismatch: identityFilteredCount,
        cap_exceeded: Math.max(0, identityGate.accepted.length - cap)
      }
    };
  }

  return result;
}
