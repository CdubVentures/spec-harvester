import { createHash } from 'node:crypto';
import { normalizeWhitespace } from '../utils/common.js';
import { filterReadableHtml } from '../extract/readabilityFilter.js';

function toText(value, maxChars = 5000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return String(text || '').slice(0, maxChars);
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(String(value || ''), 'utf8').digest('hex')}`;
}

function normalizeText(value) {
  return normalizeWhitespace(String(value || '')).trim();
}

function safeSourceId(source = {}, host = '') {
  const explicit = String(source.sourceId || source.source_id || source.id || '').trim();
  if (explicit) {
    return explicit;
  }
  return String(host || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'source';
}

function extractionMethodForType(type) {
  const token = String(type || '').toLowerCase();
  if (token === 'table' || token === 'kv' || token === 'definition') {
    return 'spec_table_match';
  }
  if (token === 'json_ld_product') {
    return 'json_ld';
  }
  if (token === 'json') {
    return 'api_fetch';
  }
  if (token === 'pdf') {
    return 'parse_template';
  }
  return 'parse_template';
}

function fieldHintsFromText(text, targetFields = []) {
  const haystack = String(text || '').toLowerCase();
  const hints = [];
  for (const field of targetFields || []) {
    const token = String(field || '').toLowerCase().replace(/_/g, ' ').trim();
    if (!token) {
      continue;
    }
    if (haystack.includes(token)) {
      hints.push(String(field));
    }
  }
  return hints.slice(0, 8);
}

function stripHtml(html) {
  const readable = filterReadableHtml(html);
  return String(readable || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSpecSections(html) {
  const content = String(html || '');
  const sections = [];
  const regex = /<(h[1-4])[^>]*>([\s\S]*?)<\/\1>/gi;
  const headings = [...content.matchAll(regex)].slice(0, 120);
  for (let i = 0; i < headings.length; i += 1) {
    const title = stripHtml(headings[i][2]).toLowerCase();
    if (!/(spec|technical|feature|performance|sensor|battery|dimension|weight)/.test(title)) {
      continue;
    }
    const start = headings[i].index || 0;
    const end = i + 1 < headings.length ? (headings[i + 1].index || content.length) : content.length;
    const chunk = stripHtml(content.slice(start, Math.min(content.length, end)));
    if (chunk) {
      sections.push(chunk.slice(0, 3000));
    }
  }
  return sections.slice(0, 8);
}

function extractHtmlTables(html) {
  const sections = [];
  for (const match of String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const table = stripHtml(match[0]);
    if (!table) {
      continue;
    }
    sections.push(table.slice(0, 2600));
    if (sections.length >= 8) {
      break;
    }
  }
  return sections;
}

function extractDefinitionPairs(html) {
  const sections = [];
  for (const dlMatch of String(html || '').matchAll(/<dl[\s\S]*?<\/dl>/gi)) {
    const dl = String(dlMatch[0] || '');
    const pairs = [];
    const pairRegex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
    for (const pair of dl.matchAll(pairRegex)) {
      const key = stripHtml(pair[1] || '');
      const value = stripHtml(pair[2] || '');
      if (!key || !value) {
        continue;
      }
      pairs.push(`${key}: ${value}`);
      if (pairs.length >= 24) {
        break;
      }
    }
    if (pairs.length > 0) {
      sections.push(pairs.join(' | ').slice(0, 3000));
    }
    if (sections.length >= 10) {
      break;
    }
  }
  return sections;
}

function extractInlineKvRows(html) {
  const text = stripHtml(html);
  if (!text) {
    return [];
  }
  const out = [];
  const regex = /([A-Za-z][A-Za-z0-9 \-_/]{2,40})\s*:\s*([A-Za-z0-9][^|.;:\n]{1,80})/g;
  for (const match of text.matchAll(regex)) {
    const key = normalizeWhitespace(match[1] || '');
    const value = normalizeWhitespace(match[2] || '');
    if (!key || !value) {
      continue;
    }
    out.push(`${key}: ${value}`);
    if (out.length >= 30) {
      break;
    }
  }
  return out;
}

function extractTargetWindows(html, targetFields = []) {
  const text = stripHtml(html);
  if (!text) {
    return [];
  }
  const windows = [];
  const lower = text.toLowerCase();
  const tokens = [...new Set((targetFields || [])
    .map((field) => String(field || '').toLowerCase().replace(/_/g, ' ').trim())
    .filter(Boolean))]
    .slice(0, 24);

  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index < 0) {
      continue;
    }
    const start = Math.max(0, index - 90);
    const end = Math.min(text.length, index + token.length + 120);
    const chunk = normalizeWhitespace(text.slice(start, end));
    if (!chunk) {
      continue;
    }
    windows.push(chunk.slice(0, 320));
    if (windows.length >= 24) {
      break;
    }
  }
  return windows;
}

function toStableId(prefix, index) {
  return `${prefix}${String(index + 1).padStart(2, '0')}`;
}

function rankNetworkJsonRows(rows, fieldTokens) {
  const scored = [];
  for (const row of rows || []) {
    const payload = toText(row.jsonFull ?? row.jsonPreview, 4000).toLowerCase();
    let score = 0;
    for (const token of fieldTokens) {
      if (payload.includes(token)) {
        score += 1;
      }
    }
    if (/spec|technical|sensor|dpi|polling|weight|battery/.test(payload)) {
      score += 4;
    }
    if (row.classification === 'specs' || row.classification === 'product_payload') {
      score += 3;
    }
    scored.push({
      row,
      score
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((item) => item.row);
}

function fieldTokens(targetFields = []) {
  return [...new Set(
    (targetFields || [])
      .flatMap((field) => String(field || '').toLowerCase().split(/[^a-z0-9]+/g))
      .filter((token) => token.length >= 3)
  )];
}

function normalizeCandidateToken(value) {
  return normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .trim();
}

export function fingerprintEvidenceCandidate(candidate = {}) {
  const field = normalizeCandidateToken(candidate.field);
  const value = normalizeCandidateToken(candidate.value);
  const method = normalizeCandidateToken(candidate.method);
  const keyPath = normalizeCandidateToken(candidate.keyPath);
  return `${field}|${value}|${method}|${keyPath}`;
}

function unpackJsonLdProducts(block) {
  if (!block) {
    return [];
  }
  if (Array.isArray(block)) {
    return block.flatMap((item) => unpackJsonLdProducts(item));
  }
  if (typeof block !== 'object') {
    return [];
  }

  const typeToken = String(block['@type'] || block.type || '').toLowerCase();
  const products = [];
  if (typeToken === 'product' || typeToken.split(',').includes('product')) {
    products.push(block);
  }

  if (Array.isArray(block['@graph'])) {
    products.push(...block['@graph'].flatMap((item) => unpackJsonLdProducts(item)));
  }

  return products;
}

function pushReference(state, item, targetFields = []) {
  const text = String(item.content || '');
  if (!text) {
    return;
  }
  const serializedLength = item.id.length + item.type.length + item.url.length + text.length;
  const remaining = state.maxChars - state.usedChars;
  if (remaining <= 0) {
    return;
  }

  const safeText = text.slice(0, Math.max(0, remaining - 80));
  if (!safeText) {
    return;
  }

  let id = String(item.id || '').trim();
  if (!id) {
    return;
  }
  if (state.usedIds.has(id)) {
    let suffix = 1;
    while (state.usedIds.has(`${id}_${suffix}`)) {
      suffix += 1;
    }
    id = `${id}_${suffix}`;
  }
  state.usedIds.add(id);

  const normalized = normalizeText(safeText);
  const snippetHash = sha256(normalized);
  const extractedMethod = String(item.extractionMethod || extractionMethodForType(item.type) || '').trim();

  const referenceRow = {
    id,
    source_id: state.sourceId,
    url: item.url,
    type: item.type,
    content: safeText,
    snippet_hash: snippetHash,
    extracted_at: state.fetchedAt,
    key_path: String(item.keyPath || '').trim(),
    candidate_fingerprint: String(item.candidateFingerprint || '').trim()
  };
  state.references.push(referenceRow);

  const snippetRow = {
    id,
    source: state.sourceId,
    source_id: state.sourceId,
    type: item.type,
    field_hints: item.fieldHints || fieldHintsFromText(safeText, targetFields),
    text: safeText,
    normalized_text: normalized,
    snippet_hash: snippetHash,
    url: item.url,
    retrieved_at: state.fetchedAt,
    extraction_method: extractedMethod,
    key_path: String(item.keyPath || '').trim(),
    candidate_fingerprint: String(item.candidateFingerprint || '').trim(),
    reference: {
      id,
      url: item.url,
      host: state.host,
      evidenceKey: id
    }
  };
  state.snippets.push(snippetRow);
  state.snippetsById[id] = snippetRow;

  state.sources[state.sourceId].snippets.push(id);
  state.usedChars += Math.min(serializedLength, safeText.length + 80);
}

export function buildEvidencePackV2({
  source,
  pageData,
  adapterExtra,
  config,
  targetFields = [],
  deterministicCandidates = []
}) {
  const maxChars = Math.max(1500, Number(config.llmMaxEvidenceChars || config.openaiMaxInputChars || 60_000));
  const host = String(source?.host || '').toLowerCase();
  const sourceId = safeSourceId(source, host);
  const nowIso = new Date().toISOString();
  const fetchedAt = String(source?.fetchedAt || pageData?.fetchedAt || nowIso);
  const normalizedUrl = String(pageData?.finalUrl || source?.finalUrl || source?.url || '');
  const html = String(pageData?.html || '');
  const cleanedText = normalizeText(stripHtml(html));

  const state = {
    host,
    sourceId,
    maxChars,
    usedChars: 0,
    references: [],
    snippets: [],
    snippetsById: {},
    usedIds: new Set(),
    fetchedAt,
    sources: {
      [sourceId]: {
        id: sourceId,
        tier: source?.tier ?? null,
        tier_name: String(source?.tierName || ''),
        role: String(source?.role || ''),
        url: normalizedUrl || String(source?.url || ''),
        fetched_at: fetchedAt,
        status: source?.status ?? pageData?.status ?? null,
        method: String(source?.crawlConfig?.method || source?.fetchMethod || source?.method || '').toLowerCase(),
        normalized_url: normalizedUrl || String(source?.url || ''),
        page_content_hash: sha256(html),
        text_hash: sha256(cleanedText),
        snippets: []
      }
    },
    candidateBindings: {}
  };
  const tokens = fieldTokens(targetFields);

  const definitionSections = extractDefinitionPairs(pageData?.html || '');
  definitionSections.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('d', index),
      url: normalizedUrl || source.url,
      type: 'definition',
      content: text
    }, targetFields);
  });

  const kvRows = extractInlineKvRows(pageData?.html || '');
  kvRows.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('k', index),
      url: normalizedUrl || source.url,
      type: 'kv',
      content: text
    }, targetFields);
  });

  const windows = extractTargetWindows(pageData?.html || '', targetFields);
  windows.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('w', index),
      url: normalizedUrl || source.url,
      type: 'window',
      content: text
    }, targetFields);
  });

  const tableSections = extractHtmlTables(pageData?.html || '');
  tableSections.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('t', index),
      url: normalizedUrl || source.url,
      type: 'table',
      content: text
    }, targetFields);
  });

  const specSections = extractSpecSections(pageData?.html || '');
  specSections.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('s', index),
      url: normalizedUrl || source.url,
      type: 'text',
      content: text
    }, targetFields);
  });

  rankNetworkJsonRows(pageData?.networkResponses || [], tokens).forEach((row, index) => {
    pushReference(state, {
      id: toStableId('j', index),
      url: row.url || normalizedUrl || source.url,
      type: 'json',
      content: toText(row.jsonFull ?? row.jsonPreview, 4000)
    }, targetFields);
  });

  const jsonLdBlocks = pageData?.ldjsonBlocks || [];
  const jsonLdProducts = jsonLdBlocks.flatMap((block) => unpackJsonLdProducts(block)).slice(0, 12);
  jsonLdProducts.forEach((product, index) => {
    pushReference(state, {
      id: toStableId('l', index),
      url: normalizedUrl || source.url,
      type: 'json_ld_product',
      content: toText(product, 2800)
    }, targetFields);
  });

  const embeddedPayloads = [
    pageData?.embeddedState?.nextData?.props?.pageProps,
    pageData?.embeddedState?.nextData,
    pageData?.embeddedState?.nuxtState,
    pageData?.embeddedState?.apolloState
  ].filter(Boolean);
  embeddedPayloads.slice(0, 6).forEach((payload, index) => {
    pushReference(state, {
      id: toStableId('e', index),
      url: normalizedUrl || source.url,
      type: 'json',
      content: toText(payload, 3200)
    }, targetFields);
  });

  (adapterExtra?.pdfDocs || []).slice(0, 10).forEach((pdf, index) => {
    pushReference(state, {
      id: toStableId('p', index),
      url: pdf.url || normalizedUrl || source.url,
      type: 'pdf',
      content: normalizeWhitespace(String(pdf.textPreview || '')).slice(0, 3000)
    }, targetFields);
  });

  const candidateSeen = new Set();
  let candidateIndex = 0;
  for (const candidate of deterministicCandidates || []) {
    const value = normalizeText(candidate?.value || '');
    if (!value || value.toLowerCase() === 'unk') {
      continue;
    }
    const fingerprint = fingerprintEvidenceCandidate(candidate);
    if (!fingerprint || candidateSeen.has(fingerprint)) {
      continue;
    }
    candidateSeen.add(fingerprint);

    candidateIndex += 1;
    const snippetId = toStableId('c', candidateIndex - 1);
    const field = String(candidate?.field || '').trim();
    const quote = field ? `${field}: ${value}` : value;
    const methodToken = String(candidate?.method || '').toLowerCase();
    const extractionMethod = methodToken === 'ldjson'
      ? 'json_ld'
      : (methodToken === 'network_json' || methodToken === 'embedded_state' || methodToken === 'adapter_api')
        ? 'api_fetch'
        : methodToken === 'pdf_table'
          ? 'parse_template'
          : 'spec_table_match';

    pushReference(state, {
      id: snippetId,
      url: normalizedUrl || source.url,
      type: 'deterministic_candidate',
      content: quote,
      fieldHints: field ? [field] : [],
      extractionMethod,
      keyPath: String(candidate?.keyPath || '').trim(),
      candidateFingerprint: fingerprint
    }, targetFields);

    state.candidateBindings[fingerprint] = snippetId;
  }

  if (state.references.length === 0) {
    pushReference(state, {
      id: 's00',
      url: normalizedUrl || source.url,
      type: 'text',
      content: stripHtml(pageData?.html || '').slice(0, 3000)
    }, targetFields);
  }

  return {
    product_id: String(source?.productId || ''),
    category: String(source?.category || ''),
    created_at: nowIso,
    updated_at: nowIso,
    evidence_pack_version: '1.1.0',
    schema_version: '2026-02-13',
    content_language: 'en',
    sources: state.sources,
    references: state.references,
    snippets: state.snippets,
    snippets_by_id: state.snippetsById,
    candidate_bindings: state.candidateBindings,
    meta: {
      source_id: sourceId,
      host,
      url: normalizedUrl || source.url,
      title: pageData?.title || '',
      reference_count: state.references.length,
      snippet_count: state.snippets.length,
      total_chars: state.usedChars,
      max_chars: maxChars,
      candidate_binding_count: Object.keys(state.candidateBindings || {}).length,
      fingerprint: source?.fingerprint?.id || '',
      page_content_hash: state.sources[sourceId].page_content_hash,
      text_hash: state.sources[sourceId].text_hash
    }
  };
}
