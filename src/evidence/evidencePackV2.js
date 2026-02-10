import { normalizeWhitespace } from '../utils/common.js';

function toText(value, maxChars = 5000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  return String(text || '').slice(0, maxChars);
}

function stripHtml(html) {
  return String(html || '')
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

function pushReference(state, item) {
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
  const nextItem = {
    ...item,
    content: safeText
  };
  state.references.push(nextItem);
  state.snippets.push({
    id: nextItem.id,
    type: nextItem.type,
    text: nextItem.content,
    reference: {
      id: nextItem.id,
      url: nextItem.url,
      host: state.host,
      evidenceKey: nextItem.id
    }
  });
  state.usedChars += Math.min(serializedLength, safeText.length + 80);
}

function fieldTokens(targetFields = []) {
  return [...new Set(
    (targetFields || [])
      .flatMap((field) => String(field || '').toLowerCase().split(/[^a-z0-9]+/g))
      .filter((token) => token.length >= 3)
  )];
}

export function buildEvidencePackV2({
  source,
  pageData,
  adapterExtra,
  config,
  targetFields = []
}) {
  const maxChars = Math.max(1500, Number(config.llmMaxEvidenceChars || config.openaiMaxInputChars || 60_000));
  const host = String(source?.host || '').toLowerCase();
  const state = {
    host,
    maxChars,
    usedChars: 0,
    references: [],
    snippets: []
  };
  const tokens = fieldTokens(targetFields);

  const tableSections = extractHtmlTables(pageData?.html || '');
  tableSections.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('t', index),
      url: source.url,
      type: 'table',
      content: text
    });
  });

  const specSections = extractSpecSections(pageData?.html || '');
  specSections.forEach((text, index) => {
    pushReference(state, {
      id: toStableId('s', index),
      url: source.url,
      type: 'text',
      content: text
    });
  });

  rankNetworkJsonRows(pageData?.networkResponses || [], tokens).forEach((row, index) => {
    pushReference(state, {
      id: toStableId('j', index),
      url: row.url || source.url,
      type: 'json',
      content: toText(row.jsonFull ?? row.jsonPreview, 4000)
    });
  });

  (pageData?.ldjsonBlocks || []).slice(0, 8).forEach((block, index) => {
    pushReference(state, {
      id: toStableId('l', index),
      url: source.url,
      type: 'json',
      content: toText(block, 2800)
    });
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
      url: source.url,
      type: 'json',
      content: toText(payload, 3200)
    });
  });

  (adapterExtra?.pdfDocs || []).slice(0, 10).forEach((pdf, index) => {
    pushReference(state, {
      id: toStableId('p', index),
      url: pdf.url || source.url,
      type: 'pdf',
      content: normalizeWhitespace(String(pdf.textPreview || '')).slice(0, 3000)
    });
  });

  if (state.references.length === 0) {
    pushReference(state, {
      id: 's00',
      url: source.url,
      type: 'text',
      content: stripHtml(pageData?.html || '').slice(0, 3000)
    });
  }

  return {
    references: state.references,
    snippets: state.snippets,
    meta: {
      host,
      url: source.url,
      title: pageData?.title || '',
      reference_count: state.references.length,
      total_chars: state.usedChars,
      max_chars: maxChars,
      fingerprint: source?.fingerprint?.id || ''
    }
  };
}
