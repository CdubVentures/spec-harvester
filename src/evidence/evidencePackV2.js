import { createHash } from 'node:crypto';
import { normalizeWhitespace } from '../utils/common.js';
import { filterReadableHtml } from '../extract/readabilityFilter.js';
import { extractMainArticle } from '../extract/articleExtractor.js';
import { resolveArticleExtractionPolicy } from '../extract/articleExtractorPolicy.js';

function toText(value, maxChars = 5000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return String(text || '').slice(0, maxChars);
}

function sha256(value) {
  if (Buffer.isBuffer(value)) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
  }
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
  if (token === 'readability_text') {
    return 'readability';
  }
  if (token === 'dom_snippet') {
    return 'dom_snippet';
  }
  if (token === 'screenshot_meta' || token === 'screenshot_capture') {
    return 'visual_artifact';
  }
  if (token === 'table' || token === 'kv' || token === 'definition') {
    return 'spec_table_match';
  }
  if (token === 'json_ld_product') {
    return 'json_ld';
  }
  if (token === 'microdata_product') {
    return 'microdata';
  }
  if (token === 'opengraph_product') {
    return 'opengraph';
  }
  if (token === 'microformat_product') {
    return 'microformat';
  }
  if (token === 'rdfa_product') {
    return 'rdfa';
  }
  if (token === 'twitter_card_product') {
    return 'twitter_card';
  }
  if (token === 'json') {
    return 'api_fetch';
  }
  if (token === 'pdf_doc_meta' || token === 'pdf') {
    return 'pdf';
  }
  if (token === 'pdf_kv_row') {
    return 'pdf_kv';
  }
  if (token === 'pdf_table_row') {
    return 'pdf_table';
  }
  if (token === 'scanned_pdf_ocr_text' || token === 'scanned_pdf_ocr_meta') {
    return 'scanned_pdf_ocr_text';
  }
  if (token === 'scanned_pdf_ocr_kv_row') {
    return 'scanned_pdf_ocr_kv';
  }
  if (token === 'scanned_pdf_ocr_table_row') {
    return 'scanned_pdf_ocr_table';
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

function screenshotMimeType(format = '') {
  const token = String(format || '').trim().toLowerCase();
  return token === 'png' ? 'image/png' : 'image/jpeg';
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

function asStructuredNodes(surfaceValue, { objectToSingleNode = false } = {}) {
  if (Array.isArray(surfaceValue)) {
    return surfaceValue.filter((row) => row !== null && row !== undefined);
  }
  if (objectToSingleNode && surfaceValue && typeof surfaceValue === 'object') {
    return [surfaceValue];
  }
  return [];
}

function normalizePdfPreviewRows(rows = []) {
  const out = [];
  for (const row of rows || []) {
    const key = normalizeWhitespace(String(row?.key || '')).trim();
    const value = normalizeWhitespace(String(row?.value || '')).trim();
    if (!key || !value) {
      continue;
    }
    out.push({
      key,
      value,
      path: String(row?.path || '').trim(),
      surface: String(row?.surface || '').trim(),
      page: Number.parseInt(String(row?.page || 0), 10) || 0
    });
  }
  return out;
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
  const fileUri = String(item.fileUri || item.file_uri || item.storage_uri || '').trim();
  const mimeType = String(item.mimeType || item.mime_type || '').trim();
  const width = Number.isFinite(Number(item.width)) ? Number(item.width) : null;
  const height = Number.isFinite(Number(item.height)) ? Number(item.height) : null;
  const sizeBytes = Number.isFinite(Number(item.sizeBytes ?? item.size_bytes))
    ? Number(item.sizeBytes ?? item.size_bytes)
    : null;
  const contentHash = String(item.contentHash || item.content_hash || '').trim();
  const surface = String(item.surface || '').trim();

  const referenceRow = {
    id,
    source_id: state.sourceId,
    url: item.url,
    type: item.type,
    content: safeText,
    snippet_hash: snippetHash,
    extracted_at: state.fetchedAt,
    key_path: String(item.keyPath || '').trim(),
    candidate_fingerprint: String(item.candidateFingerprint || '').trim(),
    file_uri: fileUri || null,
    mime_type: mimeType || null,
    width,
    height,
    size_bytes: sizeBytes,
    content_hash: contentHash || null,
    surface: surface || null
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
    file_uri: fileUri || null,
    mime_type: mimeType || null,
    width,
    height,
    size_bytes: sizeBytes,
    content_hash: contentHash || null,
    surface: surface || null,
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
  const domSnippetHtml = String(pageData?.domSnippet?.html || '');
  const domSnippetText = normalizeText(stripHtml(domSnippetHtml));
  const domSnippetKind = String(pageData?.domSnippet?.kind || '').trim().toLowerCase();
  const screenshotMeta = pageData?.screenshot && typeof pageData.screenshot === 'object'
    ? pageData.screenshot
    : null;
  const screenshotByteCount = Buffer.isBuffer(screenshotMeta?.bytes)
    ? screenshotMeta.bytes.length
    : Number.isFinite(Number(screenshotMeta?.bytes))
      ? Number(screenshotMeta.bytes)
      : 0;
  const screenshotFormat = screenshotMeta
    ? (String(screenshotMeta.format || 'jpeg').trim().toLowerCase() === 'png' ? 'png' : 'jpeg')
    : 'jpeg';
  const screenshotMime = screenshotMeta
    ? String(screenshotMeta.mime_type || screenshotMimeType(screenshotFormat)).trim()
    : '';
  const screenshotUri = screenshotMeta
    ? String(screenshotMeta.file_uri || screenshotMeta.uri || screenshotMeta.storage_uri || '').trim()
    : '';
  const screenshotHash = screenshotMeta
    ? String(screenshotMeta.content_hash || '').trim()
      || (Buffer.isBuffer(screenshotMeta?.bytes) ? sha256(screenshotMeta.bytes) : '')
    : '';
  const domSnippetUri = String(pageData?.domSnippet?.uri || '').trim();
  const domSnippetHash = String(pageData?.domSnippet?.content_hash || '').trim()
    || (domSnippetText ? sha256(domSnippetText) : '');
  const tokens = fieldTokens(targetFields);
  const visualAssets = [];
  const articlePolicy = resolveArticleExtractionPolicy(config, {
    host: source?.host || host,
    url: normalizedUrl || source?.url || ''
  });
  const articleExtraction = extractMainArticle(html, {
    url: normalizedUrl || source?.url || '',
    title: pageData?.title || '',
    enabled: articlePolicy.enabled,
    mode: articlePolicy.mode,
    minChars: Number(articlePolicy.minChars || 700),
    minScore: Number(articlePolicy.minScore || 45),
    maxChars: Math.min(maxChars, Number(articlePolicy.maxChars || 24_000))
  });

  if (articleExtraction?.text) {
    pushReference(state, {
      id: toStableId('a', 0),
      url: normalizedUrl || source.url,
      type: 'readability_text',
      content: String(articleExtraction.text || '').slice(0, 12_000),
      extractionMethod: String(articleExtraction.method || '').toLowerCase() === 'readability'
        ? 'readability'
        : 'parse_template'
    }, targetFields);
  }

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
  if (domSnippetText) {
    pushReference(state, {
      id: toStableId('h', 0),
      url: normalizedUrl || source.url,
      type: 'dom_snippet',
      content: domSnippetText.slice(0, 3600),
      extractionMethod: 'dom_snippet',
      fileUri: domSnippetUri || null,
      mimeType: 'text/html',
      sizeBytes: Number(pageData?.domSnippet?.char_count || domSnippetText.length || 0),
      contentHash: domSnippetHash || null,
      surface: 'static_dom'
    }, targetFields);
  }
  if (screenshotMeta) {
    const screenshotDescriptor = [
      `Screenshot artifact kind=${String(screenshotMeta.kind || 'page')}`,
      `format=${String(screenshotFormat || 'jpeg')}`,
      `selector=${String(screenshotMeta.selector || 'none')}`,
      `size=${String(screenshotMeta.width || 'unk')}x${String(screenshotMeta.height || 'unk')}`,
      `width=${String(screenshotMeta.width || 'unk')}`,
      `height=${String(screenshotMeta.height || 'unk')}`,
      `bytes=${screenshotByteCount > 0 ? screenshotByteCount : 'unk'}`,
      screenshotUri ? `uri=${screenshotUri}` : ''
    ].filter(Boolean).join(' | ');
    const screenshotId = toStableId('i', 0);
    pushReference(state, {
      id: screenshotId,
      url: normalizedUrl || source.url,
      type: 'screenshot_capture',
      content: screenshotDescriptor,
      extractionMethod: 'visual_artifact',
      fileUri: screenshotUri || null,
      mimeType: screenshotMime || screenshotMimeType(screenshotFormat),
      width: Number(screenshotMeta.width || 0) || null,
      height: Number(screenshotMeta.height || 0) || null,
      sizeBytes: screenshotByteCount > 0 ? screenshotByteCount : null,
      contentHash: screenshotHash || null,
      surface: 'screenshot_capture'
    }, targetFields);
    visualAssets.push({
      id: `img_${sha256(`${state.sourceId}|${screenshotId}|${screenshotUri || 'inline'}`).slice(7, 19)}`,
      source_id: state.sourceId,
      source_url: normalizedUrl || source.url,
      kind: 'screenshot_capture',
      file_uri: screenshotUri || null,
      mime_type: screenshotMime || screenshotMimeType(screenshotFormat),
      width: Number(screenshotMeta.width || 0) || null,
      height: Number(screenshotMeta.height || 0) || null,
      size_bytes: screenshotByteCount > 0 ? screenshotByteCount : null,
      content_hash: screenshotHash || null,
      selector: String(screenshotMeta.selector || '').trim() || null,
      captured_at: String(screenshotMeta.captured_at || fetchedAt).trim() || fetchedAt
    });
  }

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

  const structuredMetadata = pageData?.structuredMetadata && typeof pageData.structuredMetadata === 'object'
    ? pageData.structuredMetadata
    : null;
  const structuredSurfaces = structuredMetadata?.surfaces && typeof structuredMetadata.surfaces === 'object'
    ? structuredMetadata.surfaces
    : {};

  const microdataNodes = asStructuredNodes(structuredSurfaces.microdata).slice(0, 12);
  microdataNodes.forEach((node, index) => {
    pushReference(state, {
      id: toStableId('m', index),
      url: normalizedUrl || source.url,
      type: 'microdata_product',
      content: toText(node, 2800),
      extractionMethod: 'microdata',
      keyPath: `structured.microdata[${index}]`,
      surface: 'microdata'
    }, targetFields);
  });

  const rdfaNodes = asStructuredNodes(structuredSurfaces.rdfa).slice(0, 10);
  rdfaNodes.forEach((node, index) => {
    pushReference(state, {
      id: toStableId('r', index),
      url: normalizedUrl || source.url,
      type: 'rdfa_product',
      content: toText(node, 2600),
      extractionMethod: 'rdfa',
      keyPath: `structured.rdfa[${index}]`,
      surface: 'rdfa'
    }, targetFields);
  });

  const microformatNodes = asStructuredNodes(structuredSurfaces.microformats).slice(0, 10);
  microformatNodes.forEach((node, index) => {
    pushReference(state, {
      id: toStableId('f', index),
      url: normalizedUrl || source.url,
      type: 'microformat_product',
      content: toText(node, 2600),
      extractionMethod: 'microformat',
      keyPath: `structured.microformats[${index}]`,
      surface: 'microformat'
    }, targetFields);
  });

  const opengraphNodes = asStructuredNodes(structuredSurfaces.opengraph, { objectToSingleNode: true }).slice(0, 1);
  opengraphNodes.forEach((node, index) => {
    pushReference(state, {
      id: toStableId('o', index),
      url: normalizedUrl || source.url,
      type: 'opengraph_product',
      content: toText(node, 2200),
      extractionMethod: 'opengraph',
      keyPath: `structured.opengraph[${index}]`,
      surface: 'opengraph'
    }, targetFields);
  });

  const twitterNodes = asStructuredNodes(structuredSurfaces.twitter, { objectToSingleNode: true }).slice(0, 1);
  twitterNodes.forEach((node, index) => {
    pushReference(state, {
      id: toStableId('u', index),
      url: normalizedUrl || source.url,
      type: 'twitter_card_product',
      content: toText(node, 2200),
      extractionMethod: 'twitter_card',
      keyPath: `structured.twitter[${index}]`,
      surface: 'twitter_card'
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

  const pdfDocs = Array.isArray(adapterExtra?.pdfDocs) ? adapterExtra.pdfDocs.slice(0, 10) : [];
  let pdfTextIndex = 0;
  let pdfKvRowIndex = 0;
  let pdfTableRowIndex = 0;
  let scannedPdfTextIndex = 0;
  let scannedPdfKvRowIndex = 0;
  let scannedPdfTableRowIndex = 0;
  pdfDocs.forEach((pdf, index) => {
    const pdfUrl = String(pdf?.url || normalizedUrl || source.url).trim();
    const backendSelected = String(pdf?.backend_selected || '').trim() || 'unknown';
    const pairCount = Number(pdf?.pair_count || 0);
    const kvPairCount = Number(pdf?.kv_pair_count || 0);
    const tablePairCount = Number(pdf?.table_pair_count || 0);
    const pagesScanned = Number(pdf?.pages_scanned || 0);
    const tablesFound = Number(pdf?.tables_found || 0);
    const scannedDetected = Boolean(pdf?.scanned_pdf_detected);
    const scannedOcrAttempted = Boolean(pdf?.scanned_pdf_ocr_attempted);
    const scannedOcrPairCount = Number(pdf?.scanned_pdf_ocr_pair_count || 0);
    const scannedOcrKvPairCount = Number(pdf?.scanned_pdf_ocr_kv_pair_count || 0);
    const scannedOcrTablePairCount = Number(pdf?.scanned_pdf_ocr_table_pair_count || 0);
    const scannedOcrConfidenceAvg = Number(pdf?.scanned_pdf_ocr_confidence_avg || 0);
    const scannedOcrLowConfidencePairs = Number(pdf?.scanned_pdf_ocr_low_confidence_pairs || 0);
    const scannedOcrBackendSelected = String(pdf?.scanned_pdf_ocr_backend_selected || '').trim() || 'none';
    const summaryText = [
      `PDF doc backend=${backendSelected}`,
      `pairs=${pairCount}`,
      `kv=${kvPairCount}`,
      `table=${tablePairCount}`,
      `pages=${pagesScanned}`,
      `tables=${tablesFound}`,
      `scanned_detected=${scannedDetected ? 'yes' : 'no'}`,
      `scanned_ocr_attempted=${scannedOcrAttempted ? 'yes' : 'no'}`,
      `scanned_ocr_backend=${scannedOcrBackendSelected}`,
      `scanned_ocr_pairs=${scannedOcrPairCount}`,
      `name=${String(pdf?.filename || '').trim() || 'doc.pdf'}`
    ].join(' | ');
    pushReference(state, {
      id: toStableId('p', index),
      url: pdfUrl,
      type: 'pdf_doc_meta',
      content: summaryText,
      extractionMethod: 'pdf',
      surface: 'pdf_text'
    }, targetFields);

    const textPreview = normalizeWhitespace(String(pdf?.textPreview || '')).slice(0, 3000);
    if (textPreview) {
      pushReference(state, {
        id: toStableId('x', pdfTextIndex),
        url: pdfUrl,
        type: 'pdf',
        content: textPreview,
        extractionMethod: 'pdf',
        surface: 'pdf_text'
      }, targetFields);
      pdfTextIndex += 1;
    }

    const kvRows = normalizePdfPreviewRows(pdf?.kv_preview_rows || []).slice(0, 12);
    kvRows.forEach((row) => {
      pushReference(state, {
        id: toStableId('q', pdfKvRowIndex),
        url: pdfUrl,
        type: 'pdf_kv_row',
        content: `${row.key}: ${row.value}`,
        extractionMethod: 'pdf_kv',
        keyPath: row.path || '',
        surface: row.surface || 'pdf_kv'
      }, targetFields);
      pdfKvRowIndex += 1;
    });

    const tableRows = normalizePdfPreviewRows(pdf?.table_preview_rows || []).slice(0, 12);
    tableRows.forEach((row) => {
      pushReference(state, {
        id: toStableId('z', pdfTableRowIndex),
        url: pdfUrl,
        type: 'pdf_table_row',
        content: `${row.key}: ${row.value}`,
        extractionMethod: 'pdf_table',
        keyPath: row.path || '',
        surface: row.surface || 'pdf_table'
      }, targetFields);
      pdfTableRowIndex += 1;
    });

    const ocrTextPreview = normalizeWhitespace(String(pdf?.ocr_text_preview || '')).slice(0, 3000);
    if (ocrTextPreview) {
      pushReference(state, {
        id: toStableId('y', scannedPdfTextIndex),
        url: pdfUrl,
        type: 'scanned_pdf_ocr_text',
        content: ocrTextPreview,
        extractionMethod: 'scanned_pdf_ocr_text',
        surface: 'scanned_pdf_ocr_text'
      }, targetFields);
      scannedPdfTextIndex += 1;
    }

    const ocrSummaryText = [
      `OCR backend=${scannedOcrBackendSelected}`,
      `pairs=${scannedOcrPairCount}`,
      `kv=${scannedOcrKvPairCount}`,
      `table=${scannedOcrTablePairCount}`,
      `confidence=${Number.isFinite(scannedOcrConfidenceAvg) ? scannedOcrConfidenceAvg.toFixed(3) : '0.000'}`,
      `low_conf_pairs=${scannedOcrLowConfidencePairs}`
    ].join(' | ');
    if (scannedDetected || scannedOcrAttempted || scannedOcrPairCount > 0) {
      pushReference(state, {
        id: toStableId('w', index),
        url: pdfUrl,
        type: 'scanned_pdf_ocr_meta',
        content: ocrSummaryText,
        extractionMethod: 'scanned_pdf_ocr_text',
        surface: 'scanned_pdf_ocr_text'
      }, targetFields);
    }

    const ocrKvRows = normalizePdfPreviewRows(pdf?.ocr_kv_preview_rows || []).slice(0, 12);
    ocrKvRows.forEach((row) => {
      pushReference(state, {
        id: toStableId('v', scannedPdfKvRowIndex),
        url: pdfUrl,
        type: 'scanned_pdf_ocr_kv_row',
        content: `${row.key}: ${row.value}`,
        extractionMethod: 'scanned_pdf_ocr_kv',
        keyPath: row.path || '',
        surface: row.surface || 'scanned_pdf_ocr_kv'
      }, targetFields);
      scannedPdfKvRowIndex += 1;
    });

    const ocrTableRows = normalizePdfPreviewRows(pdf?.ocr_table_preview_rows || []).slice(0, 12);
    ocrTableRows.forEach((row) => {
      pushReference(state, {
        id: toStableId('r', scannedPdfTableRowIndex),
        url: pdfUrl,
        type: 'scanned_pdf_ocr_table_row',
        content: `${row.key}: ${row.value}`,
        extractionMethod: 'scanned_pdf_ocr_table',
        keyPath: row.path || '',
        surface: row.surface || 'scanned_pdf_ocr_table'
      }, targetFields);
      scannedPdfTableRowIndex += 1;
    });
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
    const extractionMethod = methodToken === 'ldjson' || methodToken === 'json_ld'
      ? 'json_ld'
      : methodToken === 'microdata'
        ? 'microdata'
        : methodToken === 'opengraph'
          ? 'opengraph'
          : methodToken === 'microformat'
            ? 'microformat'
            : methodToken === 'rdfa'
              ? 'rdfa'
              : methodToken === 'twitter_card'
                ? 'twitter_card'
                : (methodToken === 'network_json' || methodToken === 'embedded_state' || methodToken === 'adapter_api')
                  ? 'api_fetch'
                  : methodToken === 'pdf_table'
                    ? 'pdf_table'
                    : methodToken === 'pdf_kv'
                      ? 'pdf_kv'
                      : methodToken === 'scanned_pdf_ocr_table'
                        ? 'scanned_pdf_ocr_table'
                        : methodToken === 'scanned_pdf_ocr_kv'
                          ? 'scanned_pdf_ocr_kv'
                          : methodToken === 'scanned_pdf_ocr_text'
                            ? 'scanned_pdf_ocr_text'
                      : methodToken === 'pdf'
                        ? 'pdf'
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
  const structuredStats = structuredMetadata?.stats && typeof structuredMetadata.stats === 'object'
    ? structuredMetadata.stats
    : {};
  const structuredErrors = Array.isArray(structuredMetadata?.errors)
    ? structuredMetadata.errors.map((row) => String(row || '').trim()).filter(Boolean)
    : [];
  const pdfStats = adapterExtra?.pdfStats && typeof adapterExtra.pdfStats === 'object'
    ? adapterExtra.pdfStats
    : {};

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
    visual_assets: visualAssets,
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
      text_hash: state.sources[sourceId].text_hash,
      visual_artifacts: {
        screenshot_available: screenshotByteCount > 0,
        screenshot_kind: screenshotMeta ? String(screenshotMeta.kind || 'page') : '',
        screenshot_format: screenshotMeta ? String(screenshotFormat || 'jpeg') : '',
        screenshot_uri: screenshotUri || '',
        screenshot_content_hash: screenshotHash || '',
        dom_snippet_available: Boolean(domSnippetText),
        dom_snippet_kind: domSnippetKind || '',
        dom_snippet_uri: domSnippetUri || '',
        dom_snippet_content_hash: domSnippetHash || '',
        visual_asset_count: visualAssets.length
      },
      structured_metadata: {
        available: Boolean(structuredMetadata),
        sidecar_ok: Boolean(structuredMetadata?.ok),
        sidecar_errors: structuredErrors.slice(0, 12),
        json_ld_count: Number(structuredStats?.json_ld_count || 0),
        microdata_count: Number(structuredStats?.microdata_count || 0),
        rdfa_count: Number(structuredStats?.rdfa_count || 0),
        microformats_count: Number(structuredStats?.microformats_count || 0),
        opengraph_count: Number(structuredStats?.opengraph_count || 0),
        twitter_count: Number(structuredStats?.twitter_count || 0),
        structured_candidates: Number(structuredStats?.structured_candidates || 0),
        structured_rejected_candidates: Number(structuredStats?.structured_rejected_candidates || 0)
      },
      pdf_extraction: {
        doc_count: pdfDocs.length,
        docs_discovered: Number(pdfStats?.docs_discovered || 0),
        docs_fetched: Number(pdfStats?.docs_fetched || 0),
        docs_parsed: Number(pdfStats?.docs_parsed || 0),
        docs_failed: Number(pdfStats?.docs_failed || 0),
        backend_requested: String(pdfStats?.requested_backend || ''),
        backend_selected: String(pdfStats?.backend_selected || ''),
        backend_fallback_count: Number(pdfStats?.backend_fallback_count || 0),
        pair_count: Number(pdfStats?.pair_count || 0),
        kv_pair_count: Number(pdfStats?.kv_pair_count || 0),
        table_pair_count: Number(pdfStats?.table_pair_count || 0),
        pages_scanned: Number(pdfStats?.pages_scanned || 0),
        tables_found: Number(pdfStats?.tables_found || 0),
        scanned_docs_detected: Number(pdfStats?.scanned_docs_detected || 0),
        scanned_docs_ocr_attempted: Number(pdfStats?.scanned_docs_ocr_attempted || 0),
        scanned_docs_ocr_succeeded: Number(pdfStats?.scanned_docs_ocr_succeeded || 0),
        scanned_ocr_pair_count: Number(pdfStats?.scanned_ocr_pair_count || 0),
        scanned_ocr_kv_pair_count: Number(pdfStats?.scanned_ocr_kv_pair_count || 0),
        scanned_ocr_table_pair_count: Number(pdfStats?.scanned_ocr_table_pair_count || 0),
        scanned_ocr_low_confidence_pairs: Number(pdfStats?.scanned_ocr_low_confidence_pairs || 0),
        scanned_ocr_confidence_avg: Number(pdfStats?.scanned_ocr_confidence_avg || 0),
        scanned_ocr_error_count: Number(pdfStats?.scanned_ocr_error_count || 0),
        scanned_ocr_backend_selected: String(pdfStats?.scanned_ocr_backend_selected || ''),
        error_count: Number(pdfStats?.error_count || 0),
        errors: Array.isArray(pdfStats?.errors) ? pdfStats.errors.slice(0, 12) : []
      },
      article_extraction: {
        method: String(articleExtraction?.method || ''),
        policy_mode: String(articlePolicy.mode || 'auto'),
        policy_matched_host: String(articlePolicy.matchedHost || ''),
        policy_override_applied: Boolean(articlePolicy.overrideApplied),
        title: normalizeText(String(articleExtraction?.title || '')).slice(0, 220),
        excerpt: normalizeText(String(articleExtraction?.excerpt || '')).slice(0, 360),
        preview: normalizeText(String(articleExtraction?.text || '')).slice(0, 1200),
        quality_score: Number(articleExtraction?.quality?.score || 0),
        char_count: Number(articleExtraction?.quality?.char_count || 0),
        heading_count: Number(articleExtraction?.quality?.heading_count || 0),
        duplicate_sentence_ratio: Number(articleExtraction?.quality?.duplicate_sentence_ratio || 0),
        low_quality: Boolean(articleExtraction?.low_quality),
        fallback_reason: String(articleExtraction?.fallback_reason || '')
      }
    }
  };
}
