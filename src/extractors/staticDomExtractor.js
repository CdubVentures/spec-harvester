import { createHash } from 'node:crypto';
import { load as loadHtml } from 'cheerio';
import { normalizeWhitespace } from '../utils/common.js';
import { clamp01, evaluateTargetMatchText } from '../pipeline/pipelineSharedHelpers.js';
import {
  extractIdentityFromPairs,
  extractTablePairs,
  mapPairsToFieldCandidates
} from '../adapters/tableParsing.js';

const DEFAULT_CLUSTER_SELECTORS = [
  '[data-product-id]',
  '[data-product]',
  '[data-sku]',
  'article.product',
  '.product-card',
  '.compare-item',
  '.comparison-item',
  'li.product',
  '.product'
];

const IDENTITY_KEYS = ['brand', 'model', 'sku', 'mpn', 'gtin', 'variant'];

function toParserMode(value = '') {
  const token = String(value || '').trim().toLowerCase();
  return token === 'regex_fallback' ? 'regex_fallback' : 'cheerio';
}

function sha256(value = '') {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableSnippetId(seed = '') {
  return `sn_${sha256(seed).slice(0, 12)}`;
}

function buildEvidenceSnippet({
  field = '',
  quote = '',
  surface = 'static_dom',
  keyPath = '',
  clusterId = 'cluster_main_product'
} = {}) {
  const normalizedQuote = normalizeWhitespace(String(quote || ''));
  const normalizedPath = String(keyPath || '').trim();
  const snippetSeed = [field, normalizedQuote, surface, normalizedPath, clusterId].join('|');
  return {
    snippet_id: stableSnippetId(snippetSeed),
    snippet_hash: `sha256:${sha256(normalizedQuote.toLowerCase())}`,
    quote: normalizedQuote,
    surface: String(surface || 'static_dom').trim() || 'static_dom',
    key_path: normalizedPath || null,
    page_product_cluster_id: String(clusterId || 'cluster_main_product').trim() || 'cluster_main_product'
  };
}

function extractTitleFromHtml(html = '') {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(match?.[1] || '');
}


function mergeIdentity(base = {}, next = {}) {
  const out = { ...(base || {}) };
  for (const key of IDENTITY_KEYS) {
    const incoming = normalizeWhitespace(next?.[key] || '');
    if (!incoming || incoming.toLowerCase() === 'unk') {
      continue;
    }
    if (!out[key] || String(out[key]).trim().toLowerCase() === 'unk') {
      out[key] = incoming;
      continue;
    }
    if (String(incoming).length > String(out[key]).length) {
      out[key] = incoming;
    }
  }
  return out;
}

function findMetaContent($, selectors = []) {
  for (const selector of selectors) {
    const value = normalizeWhitespace($(selector).first().attr('content'));
    if (value) {
      return value;
    }
  }
  return '';
}

function extractIdentityBlock($, fallbackTitle = '') {
  const title = normalizeWhitespace(fallbackTitle || $('title').first().text());
  const h1 = normalizeWhitespace($('h1').first().text());
  const ogTitle = findMetaContent($, ['meta[property="og:title"]', 'meta[name="twitter:title"]']);
  const brandMeta = findMetaContent($, [
    'meta[name="brand"]',
    'meta[property="product:brand"]',
    'meta[itemprop="brand"]'
  ]);
  const productMeta = findMetaContent($, [
    'meta[name="product"]',
    'meta[property="og:site_name"]'
  ]);

  const identityCandidates = {};
  if (brandMeta) {
    identityCandidates.brand = brandMeta;
  }

  const modelBase = h1 || ogTitle || title || productMeta;
  if (modelBase) {
    identityCandidates.model = normalizeWhitespace(
      modelBase
        .replace(/\s+\|\s+.*$/g, '')
        .replace(/\s+-\s+.*$/g, '')
    );
  }

  const pageText = normalizeWhitespace(
    [
      h1,
      title,
      findMetaContent($, ['meta[name="description"]', 'meta[property="og:description"]'])
    ].join(' ')
  );
  const skuMatch = pageText.match(/\b(?:sku|part(?:\s*number)?|model(?:\s*no\.?)?)\s*[:#]?\s*([a-z0-9\-]{4,})/i);
  if (skuMatch?.[1]) {
    identityCandidates.sku = skuMatch[1].trim();
  }

  const snippets = [];
  if (h1) {
    snippets.push(buildEvidenceSnippet({
      quote: `h1: ${h1}`,
      surface: 'static_identity_block',
      keyPath: 'h1[0]',
      clusterId: 'cluster_main_product'
    }));
  }
  if (title) {
    snippets.push(buildEvidenceSnippet({
      quote: `title: ${title}`,
      surface: 'static_identity_block',
      keyPath: 'head.title',
      clusterId: 'cluster_main_product'
    }));
  }
  if (brandMeta) {
    snippets.push(buildEvidenceSnippet({
      quote: `brand: ${brandMeta}`,
      surface: 'static_identity_block',
      keyPath: 'meta.brand',
      clusterId: 'cluster_main_product'
    }));
  }

  return {
    identityCandidates,
    evidenceSnippets: snippets
  };
}

function extractMetadataSnippets($, limit = 6) {
  const rows = [];
  const seen = new Set();
  const selectors = [
    'section',
    'article',
    'div[id*="spec"]',
    'div[class*="spec"]',
    'div[id*="technical"]',
    'div[class*="technical"]'
  ];
  const sectionRegex = /\b(spec|technical|feature|performance|dimension|connectivity|sensor|polling)\b/i;

  for (const selector of selectors) {
    $(selector).each((index, node) => {
      if (rows.length >= limit) {
        return;
      }
      const text = normalizeWhitespace($(node).text());
      if (text.length < 80 || !sectionRegex.test(text)) {
        return;
      }
      const quote = text.slice(0, 520);
      const signature = quote.toLowerCase();
      if (seen.has(signature)) {
        return;
      }
      seen.add(signature);
      rows.push(buildEvidenceSnippet({
        quote,
        surface: 'static_metadata_block',
        keyPath: `${selector}[${index}]`,
        clusterId: 'cluster_main_product'
      }));
    });
    if (rows.length >= limit) {
      break;
    }
  }

  return rows;
}

function collectProductClusters($, html = '') {
  const nodes = [];
  const seen = new Set();
  const specSignal = /(weight|sensor|dpi|polling|spec|dimension|connectivity|button|latency)/i;

  for (const selector of DEFAULT_CLUSTER_SELECTORS) {
    $(selector).each((index, node) => {
      if (seen.has(node)) {
        return;
      }
      seen.add(node);
      const text = normalizeWhitespace($(node).text());
      const nodeHtml = String($.html(node) || '');
      if (!text || text.length < 20 || nodeHtml.length < 40) {
        return;
      }
      if (!specSignal.test(text)) {
        return;
      }
      nodes.push({
        id: `cluster_${String(nodes.length + 1).padStart(2, '0')}`,
        selector,
        index,
        html: nodeHtml,
        text
      });
    });
  }

  if (nodes.length > 0) {
    return nodes.slice(0, 12);
  }

  const bodyHtml = String($('body').html() || html || '');
  const bodyText = normalizeWhitespace($('body').text() || '');
  return [{
    id: 'cluster_main_product',
    selector: 'body',
    index: 0,
    html: bodyHtml,
    text: bodyText
  }];
}

function uniqueSnippets(snippets = [], maxSnippets = 120) {
  const out = [];
  const seen = new Set();
  for (const row of snippets || []) {
    const id = String(row?.snippet_id || '').trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(row);
    if (out.length >= maxSnippets) {
      break;
    }
  }
  return out;
}

function decorateCandidate(candidate = {}, cluster = {}) {
  const quote = normalizeWhitespace(
    String(candidate?.evidence?.quote || `${String(candidate?.field || '')}: ${String(candidate?.value || '')}`)
  );
  const surface = String(candidate?.surface || candidate?.evidence?.surface || 'static_dom').trim() || 'static_dom';
  const keyPath = normalizeWhitespace(
    `${String(cluster?.id || 'cluster_main_product')}.${String(candidate?.keyPath || candidate?.evidence?.key_path || '').trim()}`
  );
  const evidence = buildEvidenceSnippet({
    field: candidate?.field || '',
    quote,
    surface,
    keyPath,
    clusterId: cluster?.id || 'cluster_main_product'
  });

  const targetMatchScore = clamp01(cluster?.target_match_score, 0);
  const targetMatchPassed = Boolean(cluster?.target_match_passed);
  const out = {
    ...candidate,
    method: String(candidate?.method || 'dom').trim() || 'dom',
    keyPath,
    surface,
    evidence,
    page_product_cluster_id: String(cluster?.id || 'cluster_main_product').trim() || 'cluster_main_product',
    target_match_score: targetMatchScore,
    target_match_passed: targetMatchPassed
  };
  if (!targetMatchPassed) {
    out.identity_reject_reason = String(cluster?.identity_reject_reason || 'cluster_mismatch').trim() || 'cluster_mismatch';
  }
  return out;
}

export function extractStaticDomCandidates({
  html,
  title = '',
  identityTarget = {},
  mode = 'cheerio',
  htmlTableExtractorV2 = true,
  targetMatchThreshold = 0.55,
  maxEvidenceSnippets = 120
} = {}) {
  const sourceHtml = String(html || '');
  if (!sourceHtml.trim()) {
    return {
      fieldCandidates: [],
      identityCandidates: {},
      evidenceSnippets: [],
      parserStats: {
        mode: toParserMode(mode),
        cluster_count: 0,
        accepted_field_candidates: 0,
        rejected_field_candidates: 0,
        parse_error_count: 0
      }
    };
  }

  const parserMode = toParserMode(mode);
  const snippets = [];
  const accepted = [];
  const rejected = [];
  let parseErrorCount = 0;
  let identityCandidates = {};
  let clusters = [];
  let resolvedTitle = normalizeWhitespace(title || extractTitleFromHtml(sourceHtml));

  try {
    const $ = loadHtml(sourceHtml);
    resolvedTitle = normalizeWhitespace(title || extractTitleFromHtml(sourceHtml));
    const identityBlock = extractIdentityBlock($, resolvedTitle);
    identityCandidates = mergeIdentity(identityCandidates, identityBlock.identityCandidates);
    snippets.push(...identityBlock.evidenceSnippets);
    snippets.push(...extractMetadataSnippets($));

    const rawClusters = collectProductClusters($, sourceHtml);
    clusters = rawClusters.map((cluster) => ({
      ...cluster,
      ...evaluateTargetMatchText({
        text: `${cluster.text} ${resolvedTitle}`,
        identityTarget,
        threshold: targetMatchThreshold
      })
    }));

    for (const cluster of clusters) {
      const pairs = extractTablePairs(cluster.html || '', {
        mode: parserMode,
        useV2: htmlTableExtractorV2 !== false
      });
      const mapped = mapPairsToFieldCandidates(pairs, 'dom');
      const identityFromPairs = extractIdentityFromPairs(pairs);
      if (cluster.target_match_passed) {
        identityCandidates = mergeIdentity(identityCandidates, identityFromPairs);
      }

      for (const candidate of mapped) {
        const decorated = decorateCandidate(candidate, cluster);
        snippets.push(decorated.evidence);
        if (decorated.target_match_passed) {
          accepted.push(decorated);
        } else {
          rejected.push(decorated);
        }
      }
    }
  } catch {
    parseErrorCount += 1;
    const pairs = extractTablePairs(sourceHtml, {
      mode: 'regex_fallback',
      useV2: htmlTableExtractorV2 !== false
    });
    const mapped = mapPairsToFieldCandidates(pairs, 'dom');
    const match = evaluateTargetMatchText({
      text: `${sourceHtml} ${resolvedTitle}`,
      identityTarget,
      threshold: targetMatchThreshold
    });
    const fallbackCluster = {
      id: 'cluster_main_product',
      ...match
    };
    identityCandidates = mergeIdentity(identityCandidates, extractIdentityFromPairs(pairs));
    for (const candidate of mapped) {
      const decorated = decorateCandidate(candidate, fallbackCluster);
      snippets.push(decorated.evidence);
      if (decorated.target_match_passed) {
        accepted.push(decorated);
      } else {
        rejected.push(decorated);
      }
    }
  }

  return {
    fieldCandidates: accepted,
    identityCandidates,
    evidenceSnippets: uniqueSnippets(snippets, Math.max(10, Number(maxEvidenceSnippets || 120))),
    parserStats: {
      mode: parserMode,
      cluster_count: clusters.length,
      accepted_field_candidates: accepted.length,
      rejected_field_candidates: rejected.length,
      parse_error_count: parseErrorCount
    },
    auditRejectedFieldCandidates: rejected.slice(0, 250)
  };
}
