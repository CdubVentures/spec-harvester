import { normalizeWhitespace } from '../utils/common.js';

function normalizeText(value) {
  return normalizeWhitespace(String(value || '')).trim();
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase();
}

function parseNumericToken(value) {
  const token = normalizeText(value);
  const match = token.match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : '';
}

function referenceMapFromEvidencePack(evidencePack = {}) {
  const byId = new Map();
  for (const row of evidencePack?.references || []) {
    const id = normalizeText(row?.id || '');
    if (id) {
      byId.set(id, row);
    }
  }
  return byId;
}

function snippetMapFromEvidencePack(evidencePack = {}) {
  const byId = new Map();
  const raw = evidencePack?.snippets;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const id = normalizeText(row?.id || '');
      if (id) {
        byId.set(id, row);
      }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [rawId, row] of Object.entries(raw)) {
      const id = normalizeText(rawId);
      if (id) {
        byId.set(id, row);
      }
    }
  }
  return byId;
}

function isNumericLike(value) {
  const token = normalizeText(value).toLowerCase();
  if (!token) {
    return false;
  }
  if (/^[+-]?\d+(?:\.\d+)?(?:\s*[a-z%]+)?$/.test(token)) {
    return true;
  }
  return false;
}

function findSpan(haystack, needle) {
  const start = String(haystack || '').indexOf(String(needle || ''));
  if (start < 0) {
    return null;
  }
  return [start, start + String(needle || '').length];
}

export function verifyCandidateEvidence({
  candidate,
  evidencePack,
  strict = false
}) {
  const out = {
    ...(candidate || {})
  };
  const refs = Array.isArray(out.evidenceRefs)
    ? out.evidenceRefs.map((item) => normalizeText(item)).filter(Boolean)
    : [];
  if (!refs.length) {
    return {
      ok: false,
      reason: 'missing_evidence_refs'
    };
  }

  const snippetId = normalizeText(out.snippetId || refs[0]);
  const snippets = snippetMapFromEvidencePack(evidencePack);
  const references = referenceMapFromEvidencePack(evidencePack);
  const snippet = snippets.get(snippetId);
  if (!snippet) {
    if (!strict && references.has(snippetId)) {
      out.snippetId = snippetId;
      out.evidenceRefs = refs;
      return {
        ok: true,
        candidate: out
      };
    }
    return {
      ok: false,
      reason: 'snippet_not_found'
    };
  }

  const snippetHash = normalizeText(out.snippetHash || out.snippet_hash);
  const currentHash = normalizeText(snippet?.snippet_hash);
  if (snippetHash && currentHash && snippetHash !== currentHash) {
    return {
      ok: false,
      reason: 'snippet_hash_mismatch'
    };
  }

  const snippetText = normalizeText(snippet?.normalized_text || snippet?.text || '');
  const valueText = normalizeText(out.value);
  if (!valueText) {
    return {
      ok: false,
      reason: 'snippet_or_value_missing'
    };
  }
  if (!snippetText) {
    if (!strict && references.has(snippetId)) {
      out.snippetId = snippetId;
      out.evidenceRefs = refs;
      return {
        ok: true,
        candidate: out
      };
    }
    return {
      ok: false,
      reason: 'snippet_or_value_missing'
    };
  }

  const quote = normalizeText(out.quote);
  const quoteSpan = Array.isArray(out.quoteSpan) ? out.quoteSpan : (Array.isArray(out.quote_span) ? out.quote_span : null);
  if (quoteSpan && quoteSpan.length === 2) {
    const start = Number.parseInt(String(quoteSpan[0]), 10);
    const end = Number.parseInt(String(quoteSpan[1]), 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > snippetText.length) {
      return {
        ok: false,
        reason: 'quote_span_invalid'
      };
    }
    const sliced = snippetText.slice(start, end);
    if (quote && normalizeText(sliced) !== quote) {
      return {
        ok: false,
        reason: 'quote_span_mismatch'
      };
    }
  }

  if (quote) {
    if (!normalizeToken(snippetText).includes(normalizeToken(quote))) {
      return {
        ok: false,
        reason: 'quote_not_in_snippet'
      };
    }
  }

  const normalizedSnippet = normalizeToken(snippetText);
  const normalizedValue = normalizeToken(valueText);
  if (normalizedValue && !normalizedSnippet.includes(normalizedValue)) {
    if (!isNumericLike(valueText)) {
      return {
        ok: false,
        reason: 'value_not_in_snippet'
      };
    }
    const numeric = parseNumericToken(valueText);
    if (!numeric || !normalizedSnippet.includes(numeric.toLowerCase())) {
      return {
        ok: false,
        reason: 'numeric_value_not_in_snippet'
      };
    }
    if (!quote) {
      const span = findSpan(snippetText, numeric);
      if (span) {
        out.quote = numeric;
        out.quoteSpan = span;
      }
    }
  }

  if (!quote && isNumericLike(valueText)) {
    const numeric = parseNumericToken(valueText);
    if (numeric) {
      const span = findSpan(snippetText, numeric);
      if (span) {
        out.quote = numeric;
        out.quoteSpan = span;
      }
    }
  }

  out.snippetId = snippetId;
  out.snippetHash = currentHash || snippetHash;
  out.evidenceRefs = refs;

  return {
    ok: true,
    candidate: out
  };
}
