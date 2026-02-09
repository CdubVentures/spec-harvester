import { normalizeWhitespace } from '../utils/common.js';

function classificationScore(classification) {
  const token = String(classification || '').toLowerCase();
  if (token === 'specs') return 5;
  if (token === 'product_payload') return 4;
  if (token === 'variant_matrix') return 4;
  if (token === 'pricing') return 2;
  if (token === 'reviews') return 1;
  return 0;
}

function toPreview(value, maxChars = 3000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return String(text || '').slice(0, maxChars);
}

function extractHtmlTables(html) {
  const snippets = [];
  for (const match of String(html || '').matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const snippet = normalizeWhitespace(match[0].replace(/<[^>]+>/g, ' '));
    if (snippet) {
      snippets.push(snippet);
    }
    if (snippets.length >= 6) {
      break;
    }
  }
  return snippets;
}

function pushBounded({ output, references, maxChars, currentChars, item }) {
  const serialized = JSON.stringify(item);
  const remaining = maxChars - currentChars;
  if (remaining <= 0) {
    return currentChars;
  }

  if (serialized.length <= remaining) {
    output.push(item);
    references.push(item.reference);
    return currentChars + serialized.length;
  }

  const truncated = {
    ...item,
    text: String(item.text || '').slice(0, Math.max(0, remaining - 120)),
    truncated: true
  };
  output.push(truncated);
  references.push(truncated.reference);
  return maxChars;
}

export function buildEvidencePack({
  source,
  pageData,
  adapterExtra,
  config
}) {
  const maxChars = Math.max(500, Number(config.openaiMaxInputChars || 50_000));
  let usedChars = 0;
  const snippets = [];
  const references = [];

  const networkRows = [...(pageData.networkResponses || [])]
    .filter((row) => row && (row.jsonFull || row.jsonPreview))
    .sort((a, b) => classificationScore(b.classification) - classificationScore(a.classification))
    .slice(0, 14);

  networkRows.forEach((row, index) => {
    const evidenceKey = `network:${source.host}:${index}`;
    const item = {
      type: 'network',
      classification: row.classification || 'unknown',
      text: toPreview(row.jsonFull ?? row.jsonPreview, 3500),
      reference: {
        id: evidenceKey,
        url: row.url || source.url,
        host: source.host,
        evidenceKey
      }
    };
    usedChars = pushBounded({
      output: snippets,
      references,
      maxChars,
      currentChars: usedChars,
      item
    });
  });

  const tableSnippets = extractHtmlTables(pageData.html || '');
  tableSnippets.forEach((tableText, index) => {
    const evidenceKey = `html_table:${source.host}:${index}`;
    const item = {
      type: 'html_table',
      text: tableText.slice(0, 2500),
      reference: {
        id: evidenceKey,
        url: source.url,
        host: source.host,
        evidenceKey
      }
    };
    usedChars = pushBounded({
      output: snippets,
      references,
      maxChars,
      currentChars: usedChars,
      item
    });
  });

  (pageData.ldjsonBlocks || []).slice(0, 6).forEach((block, index) => {
    const evidenceKey = `ldjson:${source.host}:${index}`;
    const item = {
      type: 'ldjson',
      text: toPreview(block, 1800),
      reference: {
        id: evidenceKey,
        url: source.url,
        host: source.host,
        evidenceKey
      }
    };
    usedChars = pushBounded({
      output: snippets,
      references,
      maxChars,
      currentChars: usedChars,
      item
    });
  });

  const embeddedState = pageData.embeddedState || {};
  const embeddedPayloads = [
    embeddedState.nextData?.props?.pageProps,
    embeddedState.nextData,
    embeddedState.nuxtState,
    embeddedState.apolloState
  ].filter(Boolean);

  embeddedPayloads.slice(0, 4).forEach((payload, index) => {
    const evidenceKey = `embedded:${source.host}:${index}`;
    const item = {
      type: 'embedded_state',
      text: toPreview(payload, 2200),
      reference: {
        id: evidenceKey,
        url: source.url,
        host: source.host,
        evidenceKey
      }
    };
    usedChars = pushBounded({
      output: snippets,
      references,
      maxChars,
      currentChars: usedChars,
      item
    });
  });

  (adapterExtra?.pdfDocs || []).slice(0, 5).forEach((pdf, index) => {
    const evidenceKey = `pdf:${source.host}:${index}`;
    const item = {
      type: 'pdf_text',
      text: String(pdf.textPreview || '').slice(0, 2500),
      reference: {
        id: evidenceKey,
        url: pdf.url || source.url,
        host: source.host,
        evidenceKey
      }
    };
    usedChars = pushBounded({
      output: snippets,
      references,
      maxChars,
      currentChars: usedChars,
      item
    });
  });

  return {
    productContext: {
      url: source.url,
      host: source.host,
      title: pageData.title || ''
    },
    snippets,
    references,
    maxChars,
    usedChars
  };
}
