/**
 * Publish gate: verifies every non-unk field has a valid evidence span.
 *
 * Checks per field:
 *   1. provenance entry exists
 *   2. source URL is present
 *   3. snippet_id links to a real snippet in the evidence pack
 *   4. snippet_hash matches (if both present)
 *   5. quote is present and found inside the snippet text
 *   6. quote_span is valid [start, end] within snippet bounds
 */

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function hasKnownValue(value) {
  const token = String(value ?? '').trim().toLowerCase();
  return token !== '' && token !== 'unk' && token !== 'unknown' && token !== 'n/a';
}

function resolveSnippet(snippetId, evidencePack) {
  if (!snippetId || !evidencePack) return null;
  const raw = evidencePack.snippets;
  if (Array.isArray(raw)) {
    return raw.find((s) => normalizeText(s?.id) === snippetId) || null;
  }
  if (raw && typeof raw === 'object') {
    return raw[snippetId] || null;
  }
  return null;
}

export function verifyEvidenceSpan({
  fields = {},
  provenance = {},
  evidencePack = null,
  requiredFields = null
}) {
  const fieldNames = requiredFields
    ? requiredFields.filter((f) => hasKnownValue(fields[f]))
    : Object.keys(fields).filter((f) => hasKnownValue(fields[f]));

  const results = [];
  let passCount = 0;
  let failCount = 0;

  for (const field of fieldNames) {
    const prov = provenance[field];
    const issues = [];

    if (!prov || typeof prov !== 'object') {
      issues.push('no_provenance');
    } else {
      const url = normalizeText(prov.url || prov.source_url || '');
      if (!url) issues.push('no_source_url');

      const snippetId = normalizeText(prov.snippet_id || prov.snippetId || '');
      if (!snippetId) {
        issues.push('no_snippet_id');
      } else if (evidencePack) {
        const snippet = resolveSnippet(snippetId, evidencePack);
        if (!snippet) {
          issues.push('snippet_not_found');
        } else {
          const provHash = normalizeText(prov.snippet_hash || '');
          const snippetHash = normalizeText(snippet.snippet_hash || '');
          if (provHash && snippetHash && provHash !== snippetHash) {
            issues.push('snippet_hash_mismatch');
          }

          const snippetText = normalizeText(snippet.normalized_text || snippet.text || '');
          const quote = normalizeText(prov.quote || '');
          if (!quote) {
            issues.push('no_quote');
          } else if (snippetText && !snippetText.toLowerCase().includes(quote.toLowerCase())) {
            issues.push('quote_not_in_snippet');
          }

          const quoteSpan = prov.quote_span;
          if (quoteSpan && Array.isArray(quoteSpan) && quoteSpan.length === 2) {
            const [start, end] = quoteSpan.map((v) => Number.parseInt(String(v), 10));
            if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
              issues.push('quote_span_invalid');
            } else if (snippetText && end > snippetText.length) {
              issues.push('quote_span_out_of_bounds');
            }
          }
        }
      }
    }

    const ok = issues.length === 0;
    if (ok) passCount += 1;
    else failCount += 1;

    results.push({ field, ok, issues });
  }

  return {
    gate_passed: failCount === 0,
    total_fields: fieldNames.length,
    pass_count: passCount,
    fail_count: failCount,
    results
  };
}
